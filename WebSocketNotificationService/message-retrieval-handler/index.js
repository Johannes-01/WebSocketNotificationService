const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const MESSAGE_STORAGE_TABLE = process.env.MESSAGE_STORAGE_TABLE;
const PERMISSIONS_TABLE = process.env.PERMISSIONS_TABLE;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

async function hasPermission(userId, chatId) {
  if (!PERMISSIONS_TABLE) {
    console.warn('PERMISSIONS_TABLE not configured - skipping authorization check');
    return true;
  }

  try {
    const result = await docClient.send(new GetCommand({
      TableName: PERMISSIONS_TABLE,
      Key: {
        userId,
        chatId,
      },
    }));

    return !!result.Item;
  } catch (error) {
    console.error(`Error checking permission for user ${userId}, chat ${chatId}:`, error);
    return false;
  }
}

// TODO: filterung nach sequence number hinzufügen
exports.handler = async (event) => {
  console.log('Received message retrieval request:', JSON.stringify(event, null, 2));

  try {
    const chatId = event.queryStringParameters?.chatId;
    const limit = Math.min(
      parseInt(event.queryStringParameters?.limit || DEFAULT_LIMIT),
      MAX_LIMIT
    );
    
    let startKey;
    if (event.queryStringParameters?.startKey) {
      try {
        startKey = JSON.parse(decodeURIComponent(event.queryStringParameters.startKey));
      } catch (parseError) {
        console.error('Invalid startKey format:', parseError);
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: 'Invalid startKey format' }),
        };
      }
    }
    
    const fromTimestamp = event.queryStringParameters?.fromTimestamp;
    const toTimestamp = event.queryStringParameters?.toTimestamp;

    if (!chatId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing required parameter: chatId' }),
      };
    }

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

    const authorized = await hasPermission(cognitoUserId, chatId);
    
    if (!authorized) {
      console.log(`User ${cognitoUserId} denied access to chatId: ${chatId}`);
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Forbidden: You do not have permission to access this chat' }),
      };
    }

    const queryParams = {
      TableName: MESSAGE_STORAGE_TABLE,
      KeyConditionExpression: 'chatId = :chatId',
      ExpressionAttributeValues: {
        ':chatId': chatId,
      },
      Limit: limit,
      ScanIndexForward: false,
    };

    if (fromTimestamp || toTimestamp) {
      let filterExpression = [];
      
      if (fromTimestamp) {
        queryParams.ExpressionAttributeValues[':fromTs'] = fromTimestamp;
        filterExpression.push('#ts >= :fromTs');
      }
      
      if (toTimestamp) {
        queryParams.ExpressionAttributeValues[':toTs'] = toTimestamp;
        filterExpression.push('#ts <= :toTs');
      }

      if (filterExpression.length > 0) {
        queryParams.FilterExpression = filterExpression.join(' AND ');
        queryParams.ExpressionAttributeNames = { '#ts': 'publishedAt' };
      }
    }

    if (startKey) {
      queryParams.ExclusiveStartKey = startKey;
    }

    const result = await docClient.send(new QueryCommand(queryParams));

    const response = {
      chatId,
      messages: result.Items || [],
      count: result.Items?.length || 0,
      scannedCount: result.ScannedCount || 0,
    };

    if (result.LastEvaluatedKey) {
      response.nextStartKey = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error retrieving messages:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal server error', message: error.message }),
    };
  }
};
