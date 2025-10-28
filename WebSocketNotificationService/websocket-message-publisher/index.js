const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const sns = new SNSClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const SEQUENCE_TABLE = process.env.SEQUENCE_TABLE;

/**
 * Get next consecutive sequence number for a scope using atomic DynamoDB counter
 * @param {string} scope - Scope identifier (e.g., "user:123:chat")
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

exports.handler = async (event) => {
    try {

        // Extract authenticated user ID from WebSocket authorizer context
        const cognitoUserId = event.requestContext?.authorizer?.cognitoUserId;
        
        if (!cognitoUserId) {
            console.error('No authenticated user found in WebSocket context');
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: 'Unauthorized - No user ID in context',
                }),
            };
        }

        let messageBody;
        try {
            messageBody = JSON.parse(event.body || '{}');
        } catch (e) {
            console.error('Failed to parse message body:', e);
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Invalid JSON format in message body',
                }),
            };
        }

        /**
         * Expected WebSocket message format:
         {
            "action": "sendMessage", // WebSocket action (handled by $default route)
            "targetChannel": "WebSocket", // WebSocket, Email, SMS, etc.
            "messageType": "fifo", // "fifo" or "standard" (optional, defaults to "standard")
            "messageGroupId": "chat-123", // Optional: for FIFO grouping (defaults to chatId)
            "generateSequence": true, // Optional: only for FIFO, generates DynamoDB sequence
            "payload": {
                "chatId": "chat-123",      // Target chat ID
                "eventType": "notification",
                "content": "Message content",
                "customSequence": { // Optional: client can provide their own sequence
                    "number": 42,
                    "scope": "chat-123"
                },
                "multiPartMetadata": { // Optional: for tracking multi-part messages
                    "groupId": "file-upload-xyz",
                    "totalParts": 5,
                    "partNumber": 1
                }
            }
         }
         */
        const { targetChannel, payload, messageType = 'standard', messageGroupId, generateSequence } = messageBody;

        if (!targetChannel || !payload) {
            console.error('Missing required parameters in body');
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Missing required parameters: targetChannel and payload are required',
                }),
            };
        }

        // Validate messageType
        if (messageType !== 'fifo' && messageType !== 'standard') {
            console.error('Invalid messageType:', messageType);
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Invalid messageType. Must be "fifo" or "standard"',
                }),
            };
        }

        console.log(`Publishing ${messageType} message from WebSocket user ${cognitoUserId} to targetChannel ${targetChannel}`);

        const publishTimestamp = new Date().toISOString();

        const messageToPublish = {
            ...payload,
            publishTimestamp: publishTimestamp,
            // Pass through generateSequence flag to processor for FIFO ordering
            ...(messageType === 'fifo' && generateSequence && { generateSequence: true }),
        };

        // Pass through multiPartMetadata if provided (for multi-part message completeness checking)
        if (payload.multiPartMetadata) {
            messageToPublish.multiPartMetadata = payload.multiPartMetadata;
        }

        // Select topic based on messageType
        const topicArn = messageType === 'fifo' 
            ? process.env.FIFO_TOPIC_ARN 
            : process.env.STANDARD_TOPIC_ARN;

        // Build publish command parameters
        const publishParams = {
            TopicArn: topicArn,
            Message: JSON.stringify(messageToPublish),
            MessageAttributes: {
                targetChannel: {
                    DataType: 'String',
                    StringValue: targetChannel,
                },
                timestamp: {
                    DataType: 'String',
                    StringValue: publishTimestamp,
                }
            },
        };

        // Add FIFO-specific parameters only for FIFO topics
        if (messageType === 'fifo') {
            // Use user-provided messageGroupId or fallback to chatId for logical grouping
            const groupId = messageGroupId || payload.chatId;
            publishParams.MessageGroupId = groupId;
            // MessageDeduplicationId is not needed due to ContentBasedDeduplication on the topic
        }

        const command = new PublishCommand(publishParams);

        const result = await sns.send(command);

        console.log('Message published successfully from WebSocket:', {
            messageId: result.MessageId,
            messageType: messageType,
            targetChannel: targetChannel,
            userId: cognitoUserId,
            messageGroupId: messageType === 'fifo' ? (messageGroupId || cognitoUserId) : undefined,
            topicArn: topicArn
        });

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Message sent successfully via WebSocket!',
                messageId: result.MessageId,
                messageType: messageType,
                targetChannel: targetChannel,
                messageGroupId: messageType === 'fifo' ? (messageGroupId || cognitoUserId) : undefined,
            })
        };
    } catch (error) {
        console.error('Error in WebSocket publish handler:', error);
        
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Failed to send message via WebSocket',
                details: error.message
            })
        };
    }
};
