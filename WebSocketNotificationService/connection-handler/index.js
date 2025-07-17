const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));
    const connectionId = event.requestContext.connectionId;
    const { cognitoUserId, userId, orgId, hubId } = event.requestContext.authorizer || {};

    const tableName = process.env.CONNECTION_TABLE;

    switch (event.requestContext.routeKey) {
      case '$connect':
        if (!cognitoUserId || !orgId || !userId || !hubId) {
          return {
            statusCode: 400,
            body: 'Missing one or more of the required query parameters: token, hubId, orgId, userId',
          };
        }
        await dynamoDB.send(new PutCommand({
          TableName: tableName,
          Item: {
            connectionId,
            cognitoUserId,
            userId,
            orgId,
            hubId,
          },
        }));
        return { statusCode: 200, body: 'Connected successfully' };
      case '$disconnect':
        await dynamoDB.send(new DeleteCommand({ 
          TableName: tableName, Key: { connectionId } 
        })).promise();
        return { statusCode: 200, body: 'Disconnected successfully' };
    }

    return { statusCode: 404, body: 'Route not found'}; 
  } catch (error) {
    console.error('Error in connection handler:', error);
    return {
      statusCode: 500,
      body: `Internal server error: ${error.message}`,
    };
  }
};