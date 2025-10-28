const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(client);

const PERMISSIONS_TABLE = process.env.PERMISSIONS_TABLE;

/**
 * Permission Management API
 * POST /permissions - Grant permission
 * DELETE /permissions - Revoke permission
 * GET /permissions - List user's permissions
 */
exports.handler = async (event) => {
  try {
    const httpMethod = event.httpMethod;
    const cognitoUserId = event.requestContext?.authorizer?.claims?.sub;

    if (!cognitoUserId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    switch (httpMethod) {
      case 'POST':
        return await grantPermission(event, cognitoUserId);
      case 'DELETE':
        return await revokePermission(event, cognitoUserId);
      case 'GET':
        return await listPermissions(event, cognitoUserId);
      default:
        return {
          statusCode: 405,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }
  } catch (error) {
    console.error('Error in permission handler:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
    };
  }
};

/**
 * Grant permission to a user for a chat
 * POST /permissions
 * Body: { targetUserId, chatId, role }
 */
async function grantPermission(event, requestorUserId) {
  const body = JSON.parse(event.body || '{}');
  const { targetUserId, chatId, role = 'member' } = body;

  if (!targetUserId || !chatId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: 'Missing required fields: targetUserId, chatId' 
      }),
    };
  }

  // Validate role
  const validRoles = ['admin', 'member', 'viewer'];
  if (!validRoles.includes(role)) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: `Invalid role. Must be one of: ${validRoles.join(', ')}` 
      }),
    };
  }

    // TODO: Verify requestor has admin permission for this chat
    // For now, we'll allow any authenticated user to grant permissions
    // In production, check if requestorUserId has 'admin' role for this chatId

  const permission = {
    userId: targetUserId,
    chatId,
    role,
    grantedAt: new Date().toISOString(),
    grantedBy: requestorUserId,
  };

  await dynamoDB.send(new PutCommand({
    TableName: PERMISSIONS_TABLE,
    Item: permission,
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      message: 'Permission granted successfully',
      permission,
    }),
  };
}

/**
 * Revoke permission from a user for a chat
 * DELETE /permissions?userId=xxx&chatId=yyy
 */
async function revokePermission(event, requestorUserId) {
  const targetUserId = event.queryStringParameters?.userId;
  const chatId = event.queryStringParameters?.chatId;

  if (!targetUserId || !chatId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: 'Missing required parameters: userId, chatId' 
      }),
    };
  }

  // TODO: Verify requestor has admin permission for this chat
  // For now, we'll allow any authenticated user to revoke permissions

  await dynamoDB.send(new DeleteCommand({
    TableName: PERMISSIONS_TABLE,
    Key: {
      userId: targetUserId,
      chatId,
    },
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      message: 'Permission revoked successfully',
    }),
  };
}

/**
 * List all permissions for the authenticated user
 * GET /permissions?userId=xxx (optional - defaults to authenticated user)
 */
async function listPermissions(event, requestorUserId) {
  // Allow querying other users' permissions (useful for admins)
  // In production, add permission checks here
  const targetUserId = event.queryStringParameters?.userId || requestorUserId;

  // TODO: add pagination
  const result = await dynamoDB.send(new QueryCommand({
    TableName: PERMISSIONS_TABLE,
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': targetUserId,
    },
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      userId: targetUserId,
      permissions: result.Items || [],
      count: result.Items?.length || 0,
    }),
  };
}
