const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
        
const sns = new SNSClient({});
        
exports.handler = async (event) => {
    console.log('Publish handler event:', JSON.stringify(event, null, 2));
    
    try {
        // Get user context from authorizer
        // const userId = event.requestContext.authorizer.userId;
        // const username = event.requestContext.authorizer.username;

        const userId = event.queryStringParameters?.userId;
        const projectId = event.queryStringParameters?.projectId;
            
        // console.log(`Publishing message for user ${userId} (${username}) in project ${projectId}`);

        let messageBody;
        try {
            messageBody = JSON.parse(event.body || '{}');
        } catch (e) {
          messageBody = event.body || 'Default message';
        }
            
        const command = new PublishCommand({
            TopicArn: process.env.TOPIC_ARN,
            Message: messageBody,
            MessageAttributes: {
                projectId: {
                  DataType: 'String',
                  StringValue: projectId,
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
               projectId: projectId,
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