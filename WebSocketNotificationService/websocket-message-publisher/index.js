const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

const snsClient = new SNSClient({});
const TOPIC_ARN = process.env.TOPIC_ARN;

exports.handler = async (event, context) => {
  try {
    console.log("Received event:", JSON.stringify(event, null, 2));

    let messageBody;
    try {
      messageBody = JSON.parse(event.body);
    } catch (e) {
      console.error("Failed to parse message body:", e);
      return { statusCode: 400, body: 'Invalid JSON format in message body.' };
    }

    const user_id = context['congitoUserId'];
    console.log("Cognito User ID from context:", user_id);

    const { targetChannel, payload } = messageBody;

    if (!targetChannel || !payload || !user_id) {
      console.error('Missing parameter in body.');
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing parameter in body.',
        }),
      };
    }

    const publishTimestamp = new Date().toISOString();

    const messageToPublish = {
      ...payload,
      publishTimestamp: publishTimestamp,
    };

    const command = new PublishCommand({
      TopicArn: process.env.TOPIC_ARN,
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
      MessageGroupId: cognitoUserId // For FIFO topics, ensure messages with same userId are ordered
    });

    const result = await snsClient.send(command);

    console.log('Message published successfully:', result);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Message sent successfully!',
        messageId: result.MessageId,
      })
    };
   } catch (error) {
        console.error('Error in publish handler:', error);
            
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Failed to send message',
                details: error.message
            })
        };
    }
};
