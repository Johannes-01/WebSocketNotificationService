// const {DynamoDBClient, QueryCommand} = require('@aws-sdk/client-dynamodb');
const { URL } = require('url');
const { createRemoteJWKSet, jwtVerify } = require('jose');

// const ddb = new DynamoDBClient();
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
      
      // Try without audience (for ID tokens)
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

async function checkChatAccess(userId, chatId) {
  try {
    // todo: implement. Use cognito claim to check if user is part of chat

    /*const queryCommand = new QueryCommand({
      TableName: process.env.CONNECTION_TABLE,
      IndexName: 'ChatUserIndex',
      KeyConditionExpression: 'chatId = :chatId AND userId = :userId',
      ExpressionAttributeValues: {
        ':chatId': chatId,
        ':userId': userId,
      },
      Limit: 1,
    });
    
    const result = await ddb.send(queryCommand);
        
    if (!result.Items || result.Items.length === 0) {
      throw new Error(`User ${userId} not authorized for chat ${chatId}`);
    }
     
    return !!result.Items.length;*/
    return true;
  } catch (error) {
    console.error('checkChatAccess failed', error);
    throw error;
  }
}

exports.handler = async (event, context) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));
  
  const token = event.queryStringParameters?.token;
  const chatId = event.queryStringParameters?.chatId;

  if (!token || !chatId) {
    console.log('Missing token or chatId query parameter');
    generateDeny('user', event.methodArn);
  }

  try {
    const decodedToken = await verifyToken(token);
    if (!decodedToken) {
      console.log('Invalid token');
      generateDeny('user', event.methodArn);
    }

    const userId = decodedToken.sub;

    const hasAccess = await checkChatAccess(userId, chatId);

    console.log(`Decoded token for user ${userId}:`, JSON.stringify(decodedToken, null, 2));
    console.log(`User ${userId} has access to chat ${chatId}: ${hasAccess}`);
    const context = {
        userId: userId,
        chatId: chatId,
        username: decodedToken['cognito:username'] || decodedToken.username
    }

    return hasAccess ? generateAllow(userId, event.methodArn, context) : generateDeny(userId, event.methodArn);
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