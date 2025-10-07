const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));
    const connectionId = event.requestContext.connectionId;
    const { cognitoUserId, userId, orgId, hubId, projectId } = event.requestContext.authorizer || {};

    const tableName = process.env.CONNECTION_TABLE;

    switch (event.requestContext.routeKey) {
      case '$connect':
        if (!cognitoUserId || !orgId || !userId || !hubId) {
          return {
            statusCode: 400,
            body: 'Missing one or more of the required query parameters: token, hubId, orgId, userId',
          };
        }
        const item = {
          connectionId,
          cognitoUserId,
          userId,
          orgId,
          hubId,
        };
        
        // Add projectId only if provided
        if (projectId) {
          item.projectId = projectId;
        }
        
        await dynamoDB.send(new PutCommand({
          TableName: tableName,
          Item: item,
        }));
        return { statusCode: 200, body: 'Connected successfully' };
      case '$disconnect':
        await dynamoDB.send(new DeleteCommand({ 
          TableName: tableName, Key: { connectionId } 
        }));
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