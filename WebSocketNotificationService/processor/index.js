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
  console.log('SQS record attributes:', JSON.stringify(record.attributes));

  // 1. Parse the message body (SQS wraps SNS message)
  const snsMessage = JSON.parse(record.body);
  const message = JSON.parse(snsMessage.Message);

  // Extract SQS metadata for frontend tracking
  const sqsMetadata = {
    sequenceNumber: record.attributes?.SequenceNumber || null,      // FIFO sequence number (null for standard queue)
    messageGroupId: record.attributes?.MessageGroupId || null,      // FIFO message group (null for standard queue)
    sqsMessageId: record.messageId,                                 // SQS message ID
    approximateReceiveCount: record.attributes?.ApproximateReceiveCount || '1',
  };
  
  console.log('Extracted SQS metadata:', JSON.stringify(sqsMetadata));

  /**
   * Expected message structure from both P2P and A2P publishers:
   * {
   *   "chatId": "chat-123",          // Target chat ID
   *   "eventType": "notification",
   *   "content": "Message content",
   *   "publishTimestamp": "2025-10-03T14:00:00Z"
   * }
   */

  const {
    chatId,
    publishTimestamp,
    ...messagePayload
  } = message;

  // 2. Validate required fields
  if (!chatId || !publishTimestamp) {
    console.error('Invalid message structure. Missing required fields:', {
      chatId,
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
    latency_ms: latency, // Publisher → Processor latency in milliseconds
    message_id: snsMessage.MessageId,
    sequence_number: sqsMetadata.sequenceNumber,
    message_group_id: sqsMetadata.messageGroupId,
    timestamp: new Date().toISOString(),
    publish_timestamp: publishTimestamp,
    chat_id: chatId
  }));

  // 4. Check message expiration
  if (latency > VALIDITY_WINDOW_MILLISECONDS) {
    console.warn(`Message expired. Latency (${latency}ms) > ${VALIDITY_WINDOW_MILLISECONDS}ms. Discarding.`);
    return; // Stop processing this record
  }

  // 5. Find connections for the chat ID using ChatIdIndex GSI
  const queryCommand = new QueryCommand({
    TableName: CONNECTION_TABLE,
    IndexName: 'ChatIdIndex',
    KeyConditionExpression: 'chatId = :chatId',
    ExpressionAttributeValues: { ':chatId': chatId },
  });

  const connections = await docClient.send(queryCommand);
  if (!connections.Items || connections.Items.length === 0) {
    console.log(`No active connections found for chatId: ${chatId}.`);
    return;
  }

  console.log(`Found ${connections.Items.length} active connection(s) for chatId: ${chatId}.`);

  // 6. Send message to all found connections
  const promises = connections.Items.map(async (item) => {
    const actualConnectionId = item.actualConnectionId; // The real WebSocket connection ID
    try {
      const processorTimestamp = new Date().toISOString();
      
      // Send the full message including metadata to WebSocket client
      // Preserve custom sequenceNumber from payload (consecutive 1,2,3...) if it exists
      const dataToSend = JSON.stringify({
        ...messagePayload,
        chatId,
        publishTimestamp,
        processorTimestamp,                                // When processor sent the message (for E2E latency tracking)
        receivedTimestamp: processorTimestamp,             // Deprecated: use processorTimestamp
        latencyMs: latency,
        // SQS metadata for frontend ordering and gap detection
        // messagePayload.sequenceNumber is the CUSTOM consecutive sequence (1,2,3...) - keep it!
        sqsSequenceNumber: sqsMetadata.sequenceNumber,     // SQS sequence (non-consecutive, for ordering only)
        messageGroupId: sqsMetadata.messageGroupId,        // Scope of the sequence
        messageId: sqsMetadata.sqsMessageId,               // Unique message identifier
        retryCount: parseInt(sqsMetadata.approximateReceiveCount) - 1, // 0 for first delivery
      });

      console.log(`Sending message to connection ${actualConnectionId}:`, dataToSend);

      await apiGateway.send(new PostToConnectionCommand({
        ConnectionId: actualConnectionId,
        Data: dataToSend,
      }));
      
      console.log(`Message sent successfully to connection ${actualConnectionId}`);
    } catch (err) {
      // If the connection is gone (410 Gone), delete it from the table
      if (err.statusCode === 410 || err.$metadata?.httpStatusCode === 410) {
        console.log(`Stale connection detected (410 Gone). Deleting connection record: ${item.connectionId}`);
        await docClient.send(new DeleteCommand({
          TableName: CONNECTION_TABLE,
          Key: { connectionId: item.connectionId }, // Delete the composite key record
        }));
      } else {
        console.error(`Error sending to connection ${actualConnectionId}:`, err);
        throw err; // Re-throw to trigger SQS retry
      }
    }
  });

  await Promise.all(promises);
  console.log(`Finished processing message for chatId: ${chatId}`);
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