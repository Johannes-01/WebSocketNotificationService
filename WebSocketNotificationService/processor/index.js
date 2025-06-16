const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

const apiGateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WS_API_ENDPOINT,
});

exports.handler = async (event) => {
  console.log('Received SNS event:', JSON.stringify(event, null, 2));
  
  try {
    // todo: check if the sns message is a json string. if so, parse it
    const message = event.Records[0].Sns.Message;
    console.log('message:', message);
    
    // Get all connections from Connection Table
    const scanCommand = new ScanCommand({ 
      TableName: process.env.CONNECTION_TABLE 
    });
    const connections = await dynamoDB.send(scanCommand);
    
    console.log(`Found ${connections.Items?.length || 0} connections`);
    
    if (!connections.Items || connections.Items.length === 0) {
      console.log('No connections found');
      return;
    }

    // Send message to all connected clients
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