const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const apiGateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WS_API_ENDPOINT,
});

const CONNECTION_TABLE = process.env.CONNECTION_TABLE;
const VALIDITY_WINDOW_MILLISECONDS = 10000; // 10 seconds

// Processes a single message from the SQS queue
const processRecord = async (record) => {
  console.log('Processing SQS record:', record.messageId);

  // 1. Parse the message body (SQS wraps SNS message)
  const snsMessage = JSON.parse(record.body);
  const message = JSON.parse(snsMessage.Message);

  /**
   * Expected message structure from both P2P and A2P publishers:
   * {
   *   "targetId": "abc123xyz",
   *   "targetClass": "user", // user, org, hub, project
   *   "eventType": "notification",
   *   "content": "Message content",
   *   "publishTimestamp": "2025-10-03T14:00:00Z"
   * }
   */

  const {
    targetId,
    targetClass,
    publishTimestamp,
    ...messagePayload
  } = message;

  // 2. Validate required fields
  if (!targetId || !targetClass || !publishTimestamp) {
    console.error('Invalid message structure. Missing required fields:', {
      targetId,
      targetClass,
      publishTimestamp,
      message
    });
    return;
  }

  // 3. Calculate and log latency metric for CloudWatch
  const messageTime = new Date(publishTimestamp).getTime();
  const latency = Date.now() - messageTime;

  console.log(JSON.stringify({
    event_type: 'latency_measurement',
    latency_seconds: parseFloat((latency / 1000).toFixed(5)),
    message_id: snsMessage.MessageId,
    timestamp: new Date().toISOString(),
    publish_timestamp: publishTimestamp,
    target_class: targetClass,
    target_id: targetId
  }));

  // 4. Check message expiration
  if (latency > VALIDITY_WINDOW_MILLISECONDS) {
    console.warn(`Message expired. Latency (${latency}ms) > ${VALIDITY_WINDOW_MILLISECONDS}ms. Discarding.`);
    return; // Stop processing this record
  }

  // 5. Find connections for the target
  const indexNameMap = { 
    user: 'UserIndex', 
    org: 'OrgIndex', 
    hub: 'HubIndex',
    project: 'ProjectIndex'
  };
  const indexName = indexNameMap[targetClass];
  const attributeName = targetClass === 'user' ? 'userId' : `${targetClass}Id`;
  
  if (!indexName) {
    console.error(`Unsupported targetClass: ${targetClass}. Must be 'user', 'org', 'hub', or 'project'.`);
    return;
  }

  const queryCommand = new QueryCommand({
    TableName: CONNECTION_TABLE,
    IndexName: indexName,
    KeyConditionExpression: `#attrName = :attrValue`,
    ExpressionAttributeNames: { '#attrName': attributeName },
    ExpressionAttributeValues: { ':attrValue': targetId },
  });

  const connections = await docClient.send(queryCommand);
  if (!connections.Items || connections.Items.length === 0) {
    console.log(`No active connections found for ${targetClass}:${targetId}.`);
    return;
  }

  console.log(`Found ${connections.Items.length} active connection(s) for ${targetClass}:${targetId}.`);

  // 6. Send message to all found connections
  const promises = connections.Items.map(async ({ connectionId }) => {
    try {
      // Send the full message including metadata to WebSocket client
      const dataToSend = JSON.stringify({
        ...messagePayload,
        targetId,
        targetClass,
        publishTimestamp,
        receivedTimestamp: new Date().toISOString(),
        latencyMs: latency
      });

      await apiGateway.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: dataToSend,
      }));
      
      console.log(`Message sent successfully to connection ${connectionId}`);
    } catch (err) {
      // If the connection is gone (410 Gone), delete it from the table
      if (err.statusCode === 410 || err.$metadata?.httpStatusCode === 410) {
        console.log(`Stale connection detected (410 Gone). Deleting connection: ${connectionId}`);
        await docClient.send(new DeleteCommand({
          TableName: CONNECTION_TABLE,
          Key: { connectionId },
        }));
      } else {
        console.error(`Error sending to connection ${connectionId}:`, err);
        throw err; // Re-throw to trigger SQS retry
      }
    }
  });

  await Promise.all(promises);
  console.log(`Finished processing message for ${targetClass}:${targetId}`);
};

exports.handler = async (event) => {
  console.log(`Received SQS event with ${event.Records.length} records.`);
  const batchItemFailures = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error('Fatal error processing record:', record.messageId, error);
      // Add the failed record's ID to the batchItemFailures list
      batchItemFailures.push({
        itemIdentifier: record.messageId,
      });
    }
  }

  // Return failures to SQS to re-process only the failed messages
  console.log('Batch processing finished. Failures:', batchItemFailures.length);
  return { batchItemFailures };
};