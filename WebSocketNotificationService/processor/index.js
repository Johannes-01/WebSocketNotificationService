const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);

const apiGateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WS_API_ENDPOINT,
});

exports.handler = async (event) => {
  console.log('Received SNS event:', JSON.stringify(event, null, 2));

  try {
    const snsRecord = event.Records[0].Sns;
    if (!snsRecord || !snsRecord.MessageAttributes) {
      console.error('Invalid SNS event structure');
      return;
    }

    const messageAttributes = snsRecord.MessageAttributes || {};
    const targetId = messageAttributes.TargetId?.Value;
    const targetClass = messageAttributes.TargetClass?.Value;
    const timestamp = messageAttributes.timestamp?.Value;
    const subject = messageAttributes.Subject?.Value;

    console.log(`Received message for target: ${targetId} with targetClass: ${targetClass}, timestamp: ${timestamp}`);

    // todo: replace with SNS message filtering.
    if (!targetClass || !targetId || !subject) {
      console.error('Missing required SNS message attributes: targetId, targetClass or subject');
      return;
    }

    const VALIDITY_WINDOW_MILLISECONDS = 10000; // 10 seconds

    let message;
    try {
      const originalMessage = JSON.parse(snsRecord.Message);
      const publishTimestamp = originalMessage.publishTimestamp;

      if (publishTimestamp) {
        const messageTime = new Date(publishTimestamp).getTime();
        
        const latency = (Date.now() - messageTime);

        console.log(JSON.stringify({
                          event_type: 'latency_measurement',
                          latency_seconds: parseFloat(latency.toFixed(5)),
                          message_id: snsRecord.MessageId,
                          timestamp: new Date().toISOString(),
                          publish_timestamp: publishTimestamp
                      }));

        if (latency > VALIDITY_WINDOW_MILLISECONDS) {
          console.warn(`Message expired. Latency (${latency.toFixed(5)}ms) exceeded validity window of ${VALIDITY_WINDOW_MILLISECONDS}ms. Discarding.`);
          return; // Stop processing
        }
      }

      message = {
        "Subject": subject,
        "Data": originalMessage,
      };
    } catch (e) {
      console.log('Message cannot be parsed', e);
      // If we can't parse the message, we can't check its timestamp, so we'll drop it.
      return;
    }
  
    let command;
    if(targetClass === "user"){
      command = new QueryCommand({
        TableName: process.env.CONNECTION_TABLE,
        IndexName: 'UserIndex',
        KeyConditionExpression: "#targetAttribute = :targetId",
        ExpressionAttributeValues: {
          ':targetId': targetId,
        },
        ExpressionAttributeNames: {
          '#targetAttribute': 'userId',
        },
      });
    } 
    else if (targetClass === "org" || targetClass === "hub") {
      const indexName = targetClass === "org" ? 'OrgIndex' : 'HubIndex';
      const attributeName = targetClass === "org" ? 'orgId' : 'hubId';
      command = new QueryCommand({
        TableName: process.env.CONNECTION_TABLE,
        IndexName: indexName,
        KeyConditionExpression: "#targetAttribute = :targetId",
        ExpressionAttributeValues: {
          ':targetId': targetId,
        },
        ExpressionAttributeNames: {
          '#targetAttribute': attributeName,
        },
      });
    } else {
      console.error(`Unsupported targetClass: ${targetClass}`);
      return;
    }
            
    const connections = await dynamoDB.send(command);
    const connectionCount = connections.Items?.length || 0;
            
    console.log(`Found ${connectionCount} connections target ${targetId} in targetClass ${targetClass}`);
        
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
        console.error(`Error sending to connection ${connectionId}:`, err.message);
        
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