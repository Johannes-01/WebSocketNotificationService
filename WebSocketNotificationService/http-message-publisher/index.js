const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const sns = new SNSClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Check if user has permission to access a specific chat
 */
async function hasPermission(userId, chatId) {
  const permissionsTable = process.env.PERMISSIONS_TABLE;
  
  if (!permissionsTable) {
    console.warn('PERMISSIONS_TABLE not configured - skipping authorization check');
    return true; // Fail open if table not configured
  }

  try {
    const result = await docClient.send(new GetCommand({
      TableName: permissionsTable,
      Key: {
        userId,
        chatId,
      },
    }));

    return !!result.Item; // User has permission if record exists
  } catch (error) {
    console.error(`Error checking permission for user ${userId}, chat ${chatId}:`, error);
    return false; // Fail closed on error
  }
}

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

        // Check if chatId is provided in payload
        if (!payload.chatId) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Missing required parameter: payload.chatId is required.',
                }),
            };
        }

        // Authorization: Check if user has permission to send to this chat
        const authorized = await hasPermission(cognitoUserId, payload.chatId);
        if (!authorized) {
            console.log(`User ${cognitoUserId} denied access to chatId: ${payload.chatId}`);
            return {
                statusCode: 403,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Forbidden: You do not have permission to send messages to this chat.',
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