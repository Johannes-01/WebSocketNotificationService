const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, DeleteCommand, BatchWriteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient();
const dynamoDB = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    console.log('Received event:', JSON.stringify(event, null, 2));
    const connectionId = event.requestContext.connectionId;
    const { cognitoUserId, chatIds } = event.requestContext.authorizer || {};

    const tableName = process.env.CONNECTION_TABLE;

    switch (event.requestContext.routeKey) {
      case '$connect':
        if (!cognitoUserId || !chatIds) {
          return {
            statusCode: 400,
            body: 'Missing required parameters: token and chatIds',
          };
        }

        // Parse chatIds (comma-separated string to array)
        const chatIdArray = chatIds.split(',').map(id => id.trim()).filter(id => id.length > 0);
        
        if (chatIdArray.length === 0) {
          return {
            statusCode: 400,
            body: 'At least one chatId must be provided',
          };
        }

        console.log(`Connection ${connectionId} subscribing to chats:`, chatIdArray);

        // Create one connection record per chatId for efficient GSI queries
        // This denormalized approach allows fast lookups via ChatIdIndex
        const putRequests = chatIdArray.map(chatId => ({
          PutRequest: {
            Item: {
              connectionId: `${connectionId}#${chatId}`, // Composite key to prevent duplicates
              chatId,
              cognitoUserId,
              actualConnectionId: connectionId, // Store actual WebSocket connection ID
              connectedAt: new Date().toISOString(),
            }
          }
        }));

        // Batch write all chat subscriptions
        // Note: DynamoDB limits batch writes to 25 items
        const batchSize = 25;
        for (let i = 0; i < putRequests.length; i += batchSize) {
          const batch = putRequests.slice(i, i + batchSize);
          await dynamoDB.send(new BatchWriteCommand({
            RequestItems: {
              [tableName]: batch
            }
          }));
        }

        return { statusCode: 200, body: 'Connected successfully' };

      case '$disconnect':
        // Delete all connection records for this connectionId
        // Since we use composite keys (connectionId#chatId), we need to find all records
        // that belong to this connection and delete them
        
        console.log(`Connection ${connectionId} disconnecting - cleaning up all chat subscriptions`);
        
        try {
          // Scan for all records with this actualConnectionId
          // Note: In high-volume scenarios, consider adding a GSI on actualConnectionId
          const scanParams = {
            TableName: tableName,
            FilterExpression: 'actualConnectionId = :connId',
            ExpressionAttributeValues: {
              ':connId': connectionId
            }
          };
          
          const scanResult = await dynamoDB.send(new ScanCommand(scanParams));
          console.log(`Found ${scanResult.Items?.length || 0} connection records to delete`);
          
          if (scanResult.Items && scanResult.Items.length > 0) {
            // Batch delete all found records
            const deleteRequests = scanResult.Items.map(item => ({
              DeleteRequest: {
                Key: {
                  connectionId: item.connectionId
                }
              }
            }));
            
            // DynamoDB limits batch writes to 25 items
            const batchSize = 25;
            for (let i = 0; i < deleteRequests.length; i += batchSize) {
              const batch = deleteRequests.slice(i, i + batchSize);
              await dynamoDB.send(new BatchWriteCommand({
                RequestItems: {
                  [tableName]: batch
                }
              }));
            }
            
            console.log(`Successfully deleted ${scanResult.Items.length} connection records for ${connectionId}`);
          }
        } catch (scanError) {
          console.error('Error during disconnect cleanup:', scanError);
          // Don't fail the disconnect - just log the error
          // Stale connections will be cleaned up by the processor on 410 Gone
        }
        
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