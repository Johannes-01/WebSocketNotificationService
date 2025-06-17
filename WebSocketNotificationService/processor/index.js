const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

const apiGateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WS_API_ENDPOINT,
});

exports.handler = async (event) => {
  console.log('Received SNS event:', JSON.stringify(event, null, 2));
  
  try {
    let message;
    try {
      message = JSON.parse(event.Records[0].Sns.Message || '{}');
    } catch (e) {
      message = event.Records[0].Sns.Message || 'Empty message';
    }

    console.log('message:', message);
    
    const projectId = event.Records[0].Sns.MessageAttributes.projectId.Value;
    const userId = event.Records[0].Sns.MessageAttributes.userId.Value;
    const timestamp = event.Records[0].Sns.MessageAttributes.timestamp.Value;
    console.log(`Received message from userId: ${userId} for projectId: ${projectId}, timestamp: ${timestamp}`);

    if (!projectId || !userId) {
      console.error('Missing projectId or userId in SNS message attributes');
      return;
    }

    // Get all connections for this project to send targeted notifications
    const queryCommand = new QueryCommand({
      TableName: process.env.CONNECTION_TABLE,
      IndexName: 'ProjectUserIndex',
      KeyConditionExpression: 'projectId = :projectId',
      ExpressionAttributeValues: {
        ':projectId': projectId,
      },
    });
            
    const connections = await dynamoDB.send(queryCommand);
    const connectionCount = connections.Items?.length || 0;
            
    console.log(`Found ${connectionCount} connections for project ${projectId}`);
        
    if (!connections.Items || connections.Items.length === 0) {
      console.log('No connections found');
      return;
    }

    const promises = connections.Items.map(async ({ connectionId }) => {
      try {
        console.log(`Sending message to connection: ${connectionId}`);
        
        const postCommand = new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify(message),
        });
        
        await apiGateway.send(postCommand);
        console.log(`Message sent successfully to ${connectionId}`);
        
      } catch (err) {
        console.error(`Error sending to connection ${connectionId}:`, err);
        
        // Delete stale connection if it's gone (410 = Gone)
        if (err.statusCode === 410 || err.$metadata?.httpStatusCode === 410) {
          console.log(`Deleting stale connection: ${connectionId}`);
          
          const deleteCommand = new DeleteCommand({
            TableName: process.env.CONNECTION_TABLE,
            Key: { connectionId },
          });
          
          await dynamoDB.send(deleteCommand);
        }
      }
    });
    
    await Promise.all(promises);
    console.log('Finished processing all connections');
    
  } catch (error) {
    console.error('Error processing SNS message:', error);
    throw error; // Re-throw to trigger retry/DLQ
  }
};