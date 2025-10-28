const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const apiGateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WS_API_ENDPOINT,
});

const CONNECTION_TABLE = process.env.CONNECTION_TABLE;
const SEQUENCE_TABLE = process.env.SEQUENCE_TABLE;
// const VALIDITY_WINDOW_MILLISECONDS = 10000; // 10 seconds

/**
 * Get next consecutive sequence number for a scope using atomic DynamoDB counter
 * Sequences are assigned AFTER FIFO ordering to ensure correct order
 * @param {string} scope - Scope identifier (e.g., "chat-123")
 * @returns {Promise<number>} Next sequence number
 */
async function getNextSequence(scope) {
  const command = new UpdateCommand({
    TableName: SEQUENCE_TABLE,
    Key: { scope },
    UpdateExpression: 'ADD #seq :inc',
    ExpressionAttributeNames: { '#seq': 'sequence' },
    ExpressionAttributeValues: { ':inc': 1 },
    ReturnValues: 'UPDATED_NEW',
  });

  const result = await docClient.send(command);
  return result.Attributes.sequence;
}

// Processes a single message from the SQS queue
const processRecord = async (record) => {
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

  // 3. Calculate latency metric
  /*const messageTime = new Date(publishTimestamp).getTime();
  const latency = Date.now() - messageTime;

  // 4. Check message expiration
  if (latency > VALIDITY_WINDOW_MILLISECONDS) {
    console.warn(`Message expired. Latency (${latency}ms) > ${VALIDITY_WINDOW_MILLISECONDS}ms. Discarding.`);
    return; // Stop processing this record
  }*/

  // Generate sequence number if requested (AFTER FIFO ordering, for client side checking)
  // This ensures consecutive numbering in the order messages are processed
  let customSequenceNumber;

  if (messagePayload.generateSequence && sqsMetadata.messageGroupId) {
    const scope = chatId; // Use chatId as scope
    try {
      customSequenceNumber = await getNextSequence(scope);
    } catch (error) {
      console.error(`Failed to generate sequence for chatId ${chatId}:`, error);
      // Continue without sequence - non-critical
    }
  }

  // Find connections for the chat ID using ChatIdIndex GSI
  const queryCommand = new QueryCommand({
    TableName: CONNECTION_TABLE,
    IndexName: 'ChatIdIndex',
    KeyConditionExpression: 'chatId = :chatId',
    ExpressionAttributeValues: { ':chatId': chatId },
  });

  const connections = await docClient.send(queryCommand);
  if (!connections.Items || connections.Items.length === 0) {
    return;
  }

  // Send the full message including metadata to WebSocket client
  const dataToSend = JSON.stringify({
    ...messagePayload,
    chatId,
    publishTimestamp,
    // Custom consecutive sequence (1,2,3...) - for client-side ordering checks and gap detection!
    ...(customSequenceNumber !== undefined && { sequenceNumber: customSequenceNumber }),
    // SQS metadata for client-side ordering; (non-consecutive, for ordering only)
    sqsSequenceNumber: sqsMetadata.sequenceNumber,     // SQS sequence 
    messageGroupId: sqsMetadata.messageGroupId,        // Scope of the sequence
    messageId: sqsMetadata.sqsMessageId,               // Unique message identifier
    retryCount: parseInt(sqsMetadata.approximateReceiveCount) - 1, // 0 for delivery
  });

  // TODO: Implement asynchronous handling for standard queue and synchronous for FIFO queue
  // Send message to all found connections
  const promises = connections.Items.map(async (item) => {
    const actualConnectionId = item.actualConnectionId; // The real WebSocket connection ID
    try {


      await apiGateway.send(new PostToConnectionCommand({
        ConnectionId: actualConnectionId,
        Data: dataToSend,
      }));

    } catch (err) {
      // If the connection is gone (410 Gone), delete it from the table
      if (err.statusCode === 410 || err.$metadata?.httpStatusCode === 410) {
        await docClient.send(new DeleteCommand({
          TableName: CONNECTION_TABLE,
          Key: { connectionId: item.connectionId }, // Delete the composite key record
        }));
      } else {
        console.error(`Error sending to connection ${actualConnectionId}:`, err.name, err.message);
        throw err; // Re-throw to trigger SQS retry
      }
    }
  });

  await Promise.all(promises);
};

exports.handler = async (event) => {
  const batchItemFailures = [];

  // Process all records in parallel for standard queue
  const results = await Promise.allSettled(
    event.Records.map(async (record) => {
      try {
        await processRecord(record);
        return { success: true, record };
      } catch (error) {
        console.error('Error processing record:', record.messageId, error.name, error.message);
        return { success: false, record };
      }
    })
  );

  // Collect failures for SQS retry
  results.forEach((result) => {
    if (result.status === 'fulfilled' && !result.value.success) {
      batchItemFailures.push({
        itemIdentifier: result.value.record.messageId,
      });
    }
  });

  return { batchItemFailures };
};