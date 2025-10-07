const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const sns = new SNSClient({});

exports.handler = async (event) => {
    try {
        console.log('Received WebSocket event:', JSON.stringify(event, null, 2));

        // Extract authenticated user ID from WebSocket authorizer context
        const cognitoUserId = event.requestContext?.authorizer?.userId;
        
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
            "messageGroupId": "chat-room-456", // Optional: for FIFO grouping (defaults to userId)
            "payload": {
                "targetId": "abc123xyz",
                "targetClass": "user", // user, org, hub, project
                "eventType": "notification",
                "content": "Message content"
            }
         }
         */
        const { targetChannel, payload, messageType = 'standard', messageGroupId } = messageBody;

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
        };

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
            // Use user-provided messageGroupId or fallback to userId for safe default
            const groupId = messageGroupId || cognitoUserId;
            publishParams.MessageGroupId = groupId;
            console.log(`Using MessageGroupId: ${groupId} (${messageGroupId ? 'user-provided' : 'auto-generated from userId'})`);
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
