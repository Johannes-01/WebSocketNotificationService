const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
  try {
  console.log('Received event:', JSON.stringify(event, null, 2));
  const connectionId = event.requestContext.connectionId;
  const { userId, chatId } = event.requestContext.authorizer || {};

  const tableName = process.env.CONNECTION_TABLE;

  switch (event.requestContext.routeKey) {
    case '$connect':
      if (!chatId || !userId) {
        return {
          statusCode: 400,
          body: 'userId and chatId are required query parameters',
        };
      }
      const putCommand = dynamoDB.put({
        TableName: tableName,
        Item: { 
          connectionId, 
          chatId,
          userId,
        },
      });
      await putCommand.promise();
      return { statusCode: 200, body: 'Connected successfully' };
    case '$disconnect':
      await dynamoDB.delete({ TableName: tableName, Key: { connectionId } }).promise();
      return { statusCode: 200, body: 'Disconnected successfully' };
  }

  return { statusCode: 404, body: 'Route not found'}; 
  } catch (error) {
    return {
      statusCode: 500,
      body: `Internal server error: ${error.message}`,
    };
  }
};