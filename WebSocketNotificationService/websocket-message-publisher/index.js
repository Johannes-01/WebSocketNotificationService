const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

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
        const connectionId = event.requestContext?.connectionId;
        const domainName = event.requestContext?.domainName;
        const stage = event.requestContext?.stage;
        
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

        const { targetChannel, payload, messageType = 'standard', messageGroupId, generateSequence, requestAck, ackId } = messageBody;

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

        // Send ACK if requested
        if (requestAck && ackId && connectionId) {
            try {
                const apiGatewayClient = new ApiGatewayManagementApiClient({
                    endpoint: `https://${domainName}/${stage}`
                });

                const ackMessage = {
                    type: 'ack',
                    ackId: ackId,
                    status: 'success',
                    messageId: result.MessageId,
                    messageType: messageType,
                    timestamp: new Date().toISOString(),
                    snsMessageId: result.MessageId,
                    sequenceNumber: result.SequenceNumber || null
                };

                const postCommand = new PostToConnectionCommand({
                    ConnectionId: connectionId,
                    Data: JSON.stringify(ackMessage)
                });

                await apiGatewayClient.send(postCommand);
                
                console.log('ACK sent successfully:', {
                    connectionId,
                    ackId,
                    messageId: result.MessageId,
                });
            } catch (ackError) {
                console.error('Failed to send ACK to client (message still published):', ackError);
                // Don't fail the entire request if ACK sending fails
                // The message was already published successfully
            }
        }

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
