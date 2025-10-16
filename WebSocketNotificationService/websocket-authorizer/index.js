const { URL } = require('url');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(client);

let jwksClient;

async function getJwksClient() {
  if (!jwksClient) {
    const jwksUrl = new URL(process.env.JWKS_URI);
    jwksClient = createRemoteJWKSet(jwksUrl);
  }
  return jwksClient;
}

async function verifyToken(token) {
  try {
    const jwks = await getJwksClient();
    
    // Try with audience first (for id token)
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: process.env.JWKS_URI.replace('/.well-known/jwks.json', ''),
        audience: process.env.USER_POOL_CLIENT_ID,
      });
      return payload;
    } catch (audError) {
      console.log('Audience validation failed, trying without audience (likely access token):', audError.message);
      
      // Try without audience (for access token)
      const { payload } = await jwtVerify(token, jwks, {
        issuer: process.env.JWKS_URI.replace('/.well-known/jwks.json', ''),
      });
      return payload;
    }
  } catch (error) {
    console.error('Token verification failed:', error);
    throw error;
  }
}

/**
 * Check if user has permission to access a specific chat
 */
async function hasPermission(userId, chatId) {
  const permissionsTable = process.env.PERMISSIONS_TABLE;
  
  if (!permissionsTable) {
    console.warn('PERMISSIONS_TABLE not configured - skipping authorization check');
    return true; // Fail open if table not configured
  }

  try {
    const result = await dynamoDB.send(new GetCommand({
      TableName: permissionsTable,
      Key: {
        userId,
        chatId,
      },
    }));

    return !!result.Item; // User has permission if record exists
  } catch (error) {
    console.error(`Error checking permission for user ${userId}, chat ${chatId}:`, error);
    return false; // Fail closed on error
  }
}

exports.handler = async (event, context) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));
  
  const token = event.queryStringParameters?.token;
  const chatIds = event.queryStringParameters?.chatIds; // Comma-separated chat IDs

  if (!token || !chatIds) {
    console.log('Missing required query parameters: token and chatIds');
    return generateDeny('user', event.methodArn);
  }

  try {
    const decodedToken = await verifyToken(token);
    if (!decodedToken) {
      console.log('Invalid token');
      return generateDeny('user', event.methodArn);
    }

    const cognitoUserId = decodedToken.sub;

    console.log(`Decoded token for cognito user ${cognitoUserId}:`, JSON.stringify(decodedToken, null, 2));
    
    // Authorization: Verify user has permission for each requested chatId
    const requestedChatIds = chatIds.split(',').map(id => id.trim()).filter(id => id.length > 0);
    
    if (requestedChatIds.length === 0) {
      console.log('No valid chatIds provided');
      return generateDeny('user', event.methodArn);
    }

    // Check permissions for each chatId
    const permissionChecks = await Promise.all(
      requestedChatIds.map(chatId => hasPermission(cognitoUserId, chatId))
    );

    const authorizedChatIds = requestedChatIds.filter((chatId, index) => permissionChecks[index]);
    const unauthorizedChatIds = requestedChatIds.filter((chatId, index) => !permissionChecks[index]);

    if (unauthorizedChatIds.length > 0) {
      console.log(`User ${cognitoUserId} denied access to chatIds: ${unauthorizedChatIds.join(', ')}`);
      return generateDeny(cognitoUserId, event.methodArn);
    }

    if (authorizedChatIds.length === 0) {
      console.log(`User ${cognitoUserId} has no authorized chatIds`);
      return generateDeny(cognitoUserId, event.methodArn);
    }

    console.log(`User ${cognitoUserId} authorized for chatIds: ${authorizedChatIds.join(', ')}`);
    
    const authContext = {
        cognitoUserId: cognitoUserId,
        chatIds: authorizedChatIds.join(','), // Only pass authorized chatIds
        username: decodedToken['cognito:username'] || decodedToken.username
    };

    return generateAllow(cognitoUserId, event.methodArn, authContext);
  } catch (error) {
    console.error('Authorization error:', error);
    return generateDeny('user', event.methodArn);
  }
};

// generate an IAM policy
var generatePolicy = function(principalId, effect, resource, context) {
  console.log('Generating Policy with effect:', effect);
   var authResponse = {};
    authResponse.principalId = principalId;
   if (effect && resource) {
       var policyDocument = {};
        policyDocument.Version = '2012-10-17'; // default version
       policyDocument.Statement = [];
       var statementOne = {};
        statementOne.Action = 'execute-api:Invoke'; // default action
       statementOne.Effect = effect;
        statementOne.Resource = resource;
        policyDocument.Statement[0] = statementOne;
        authResponse.policyDocument = policyDocument;
    }
  
    if(context) {
        authResponse.context = context;
    }
    console.log('Generated authResponse:', JSON.stringify(authResponse, null, 2));
   return authResponse;
}

var generateAllow = function(principalId, resource, context) {
   return generatePolicy(principalId, 'Allow', resource, context);
}
    
var generateDeny = function(principalId, resource) {
   return generatePolicy(principalId, 'Deny', resource);
}