const { URL } = require('url');
const { createRemoteJWKSet, jwtVerify } = require('jose');

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

exports.handler = async (event, context) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));
  
  const token = event.queryStringParameters?.token;
  const hubId = event.queryStringParameters?.hubId;
  const orgId = event.queryStringParameters?.orgId;
  const userId = event.queryStringParameters?.userId;
  const projectId = event.queryStringParameters?.projectId; // Optional

  if (!token || !hubId || !orgId || !userId) {
    console.log('Missing one or more of the required query parameters: token, hubId, orgId, userId');
    generateDeny('user', event.methodArn);
  }

  try {
    const decodedToken = await verifyToken(token);
    if (!decodedToken) {
      console.log('Invalid token');
      generateDeny('user', event.methodArn);
    }

    const cognitoUserId = decodedToken.sub;

    console.log(`Decoded token for cognito user ${cognitoUserId}:`, JSON.stringify(decodedToken, null, 2));
    const authContext = {
        cognitoUserId: cognitoUserId,
        userId: userId,
        hubId: hubId,
        orgId: orgId,
        username: decodedToken['cognito:username'] || decodedToken.username
    };
    
    // Add projectId only if provided
    if (projectId) {
      authContext.projectId = projectId;
    }

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