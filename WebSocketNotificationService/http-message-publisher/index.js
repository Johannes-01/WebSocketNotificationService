const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const sns = new SNSClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
    try {

        const cognitoUserId = event.requestContext.authorizer.claims.sub;

        let messageBody;
        try {
            messageBody = JSON.parse(event.body || '{}');
        } 
        catch (e) {
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