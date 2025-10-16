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
        console.log('Received event:', JSON.stringify(event, null, 2));

        const cognitoUserId = event.requestContext.authorizer.claims.sub;

        let messageBody;
        try {
            messageBody = JSON.parse(event.body || '{}');
        } 
        catch (e) {
            console.log('Error while parsing body:', e);
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Request body not json',
                }),
            };
        }

        /**
         * Expected message format:
         {
            "messageId": "123456",
            "timestamp": "2025-10-03T14:00:00Z",
            "targetChannel": "WebSocket", // WebSocket, Email, SMS, etc.
            "messageType": "fifo", // "fifo" or "standard" (optional, defaults to "standard")
            "messageGroupId": "chat-123", // Optional: for FIFO grouping (defaults to chatId)
            "generateSequence": true, // Optional: only for FIFO, generates consecutive DynamoDB sequence
            "payload": {
                "chatId": "chat-123",      // Target chat ID
                "eventType": "notification",
                "content": "Neue Nachricht verfügbar",
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

        if (!targetChannel || !payload ) {
            console.error('Missing parameter in body.');
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Missing required parameters: targetChannel and payload are required.',
                }),
            };
        }

        // Validate messageType
        if (messageType !== 'fifo' && messageType !== 'standard') {
            console.error('Invalid messageType:', messageType);
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Invalid messageType. Must be "fifo" or "standard".',
                }),
            };
        }
            
        console.log(`Publishing ${messageType} message for cognito user ${cognitoUserId} to targetChannel ${targetChannel}`);

        const publishTimestamp = new Date().toISOString();

        const messageToPublish = {
            ...payload,
            publishTimestamp: publishTimestamp,
        };

        // Handle custom sequence numbers (only for FIFO messages)
        if (messageType === 'fifo') {
            // Option 1: Client provides their own sequence (pass through)
            if (payload.customSequence) {
                messageToPublish.customSequence = payload.customSequence;
                console.log(`Using client-provided sequence: ${payload.customSequence.number} for scope ${payload.customSequence.scope}`);
            }
            // Option 2: Client requests Lambda to generate sequence (opt-in)
            else if (generateSequence) {
                const scope = payload.chatId; // Use chatId as scope
                try {
                    const customSeq = await getNextSequence(scope);
                    messageToPublish.sequenceNumber = customSeq;
                    console.log(`Generated sequence ${customSeq} for chatId ${scope}`);
                } catch (error) {
                    console.error('Failed to generate sequence, continuing without it:', error);
                    // Continue without sequence - non-critical
                }
            }
            // Option 3: No sequence (fastest, default)
        }

        // Pass through multiPartMetadata if provided (for multi-part message completeness checking)
        if (payload.multiPartMetadata) {
            messageToPublish.multiPartMetadata = payload.multiPartMetadata;
            console.log(`Multi-part message: ${payload.multiPartMetadata.groupId} (part ${payload.multiPartMetadata.partNumber}/${payload.multiPartMetadata.totalParts})`);
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
            console.log(`Using MessageGroupId: ${groupId} (${messageGroupId ? 'user-provided' : 'auto-generated from chatId'})`);
            // MessageDeduplicationId is not needed due to ContentBasedDeduplication on the topic
        }

        const command = new PublishCommand(publishParams);

        const result = await sns.send(command);

        console.log('Message published successfully:', {
            messageId: result.MessageId,
            messageType: messageType,
            targetChannel: targetChannel,
            messageGroupId: messageType === 'fifo' ? (messageGroupId || cognitoUserId) : undefined,
            topicArn: topicArn
        });
            
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
               message: 'Message sent successfully!',
               messageId: result.MessageId,
               messageType: messageType,
               targetChannel: targetChannel,
               messageGroupId: messageType === 'fifo' ? (messageGroupId || cognitoUserId) : undefined,
            })
        };    
    } catch (error) {
        console.error('Error in publish handler:', error);
            
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
                error: 'Failed to send message',
                details: error.message
            })
        };
    }
};