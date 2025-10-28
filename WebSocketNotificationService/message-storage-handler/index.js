const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const MESSAGE_STORAGE_TABLE = process.env.MESSAGE_STORAGE_TABLE;
const TTL_DAYS = 30; // Message retention period

/**
 * Stores messages in DynamoDB for later retrieval
 * Processes SQS events from SNS topics (both FIFO and Standard)
 */
const processRecord = async (record) => {
  try {
    // Parse SNS message
    const snsMessage = JSON.parse(record.body);
    const message = JSON.parse(snsMessage.Message);

    const {
      chatId,
      publishTimestamp,
      sequenceNumber, // Optional: custom consecutive sequence
      ...messageData
    } = message;

    // Validate required fields
    if (!chatId || !publishTimestamp) {
      console.error('Invalid message structure. Missing chatId or publishTimestamp:', message);
      return; // Skip this message
    }

    // Calculate TTL (30 days from now)
    const ttl = Math.floor(Date.now() / 1000) + (TTL_DAYS * 24 * 60 * 60);

    // Store message in DynamoDB
    // Note: Only include sequenceNumber if it exists (GSI requirement - no null values)
    const item = {
      chatId,
      timestamp: publishTimestamp, // Using 'timestamp' as the sort key (not 'publishedAt')
      messageId: record.messageId,
      ...(sequenceNumber !== undefined && sequenceNumber !== null && { sequenceNumber }), // Only include if exists
      messageData,
      ttl,
    };

    await docClient.send(new PutCommand({
      TableName: MESSAGE_STORAGE_TABLE,
      Item: item,
    }));

  } catch (error) {
    console.error('Error storing message:', error.message);
    throw error; // Re-throw to trigger SQS retry
  }
};

exports.handler = async (event) => {
  const batchItemFailures = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error(`Failed to store record ${record.messageId}:`, error.message);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
