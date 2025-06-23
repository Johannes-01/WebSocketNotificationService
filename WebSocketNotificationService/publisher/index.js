const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);
const sns = new SNSClient({});

async function checkChatAccess(userId, chatId) {
    // todo: optionally check access using cognito claim to check if user is part of chat
    // then differentiate between access to chat 403 and connections (not) found 404
    const userIdString = String(userId);
    const chatIdString = String(chatId);
    try {
        
        const queryCommand = new QueryCommand({
            TableName: process.env.CONNECTION_TABLE,
            IndexName: 'ChatUserIndex',
            KeyConditionExpression: 'chatId = :chatId AND userId = :userId',
            ExpressionAttributeValues: {
                ':chatId': chatIdString,
                ':userId': userIdString,
            },
            Limit: 1,
        });
    const result = await dynamoDB.send(queryCommand);
    
    console.log('Query result:', JSON.stringify(result, null, 2));
    
    const hasAccess = !!(result.Items && result.Items.length > 0);

    // if no connections found, against the logic of reliable messaging!!!
    console.log(`User ${userIdString} has access to chat ${chatIdString}:`, hasAccess);
     
    return hasAccess;
  } catch (error) {
        console.error('checkChatAccess failed:', {
            error: error.message,
            stack: error.stack,
            userId: userIdString,
            chatId: chatIdString
        });
    return false;
  }
}

exports.handler = async (event) => {
    try {
        console.log('Received event:', JSON.stringify(event, null, 2));

        const userId = event.requestContext.authorizer.claims.sub;
        const chatId = event.queryStringParameters?.chatId;

        if (!userId || !chatId) {
            console.error('Missing userId or chatId in request');
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Missing chatId in request as query parameter',
                }),
            };
        }
            
        console.log(`Publishing message for user ${userId} in chat ${chatId}`);

        const authorized = await checkChatAccess(userId, chatId);
        if(!authorized) {
            return {
                statusCode: 403,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'User not authorized for this chat or no connections found',
                }),
            };
        }
        
        let messageBody;
        let isJson = true;
        try {
            messageBody = JSON.parse(event.body || '{}');
        } 
        catch (e) {
            isJson = false;
            messageBody = event.body || 'Default message';
        }
            
        const command = new PublishCommand({
            TopicArn: process.env.TOPIC_ARN,
            Message: isJson ? messageBody.message : messageBody,
            MessageAttributes: {
                chatId: {
                  DataType: 'String',
                  StringValue: chatId,
                },
                userId: {
                  DataType: 'String',
                  StringValue: userId,
                },
                timestamp: {
                  DataType: 'String',
                  StringValue: new Date().toISOString(),
                }
            },
        });

        if (isJson) {
            command.MessageAttributes.messageType = messageBody.messageType || "info";
        }
            
        const result = await sns.send(command);

        console.log('Message published successfully:', result);
            
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({
               message: 'Message sent successfully!',
               messageId: result.MessageId,
               chatId: chatId,
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