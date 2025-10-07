const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const sns = new SNSClient({});

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
            "messageGroupId": "chat-room-456", // Optional: for FIFO grouping (defaults to userId)
            "payload": {
                "targetId": "abc123xyz",
                "targetClass": "user", // user, org, hub, project
                "eventType": "notification",
                "content": "Neue Nachricht verfügbar"
            }
            }
         */
        const { targetChannel, payload, messageType = 'standard', messageGroupId } = messageBody;

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