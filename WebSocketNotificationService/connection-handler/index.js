const AWS = require('aws-sdk');
const dynamoDB = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
  try {
   
  const connectionId = event.requestContext.connectionId;
  const { projectId, userId } = event.queryStringParameters || {};
  
  /*const userId = event.requestContext.authorizer?.userId || "";

  if (!userId) {
    return {
      statusCode: 401,
      body: 'Unauthorized',
    };
  }*/

  const tableName = process.env.CONNECTION_TABLE;

  switch (event.requestContext.routeKey) {
    case '$connect':
      if (!projectId || !userId) {
        return {
          statusCode: 400,
          body: 'userId and projectId are required query parameters',
        };
      }
      const putCommand = dynamoDB.put({
        TableName: tableName,
        Item: { 
          connectionId, 
          projectId,
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