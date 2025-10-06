const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
/*const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const dynamoClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);
*/

const sns = new SNSClient({});

/*async function checkConnectionAvailability(targetId) 
{
    // const targetAttribute = targetClass === "org" ? "orgId" : targetClass === "hub" ? "hubId" : "userId";
    try {    
            const queryCommand = new QueryCommand({
                TableName: process.env.CONNECTION_TABLE,
                IndexName: 'UserIndex',
                KeyConditionExpression: "#targetAttribute = :targetId",
                ExpressionAttributeValues: {
                    ':targetId': targetId
                },
                ExpressionAttributeNames: {
                    '#targetAttribute': targetAttribute,
                },
                Select: 'COUNT',
            });
                
            const result = await dynamoDB.send(queryCommand);
            return result.Count > 0;
        
        // For hub/org, check that at least one connection exists
        const indexName = targetClass === "org" ? "OrgIndex" : "HubIndex";
        const queryCommand = new QueryCommand({
            TableName: process.env.CONNECTION_TABLE,
            IndexName: indexName,
            KeyConditionExpression: "#targetAttribute = :targetId",
            ExpressionAttributeValues: {
                ':targetId': targetId
            },
            ExpressionAttributeNames: {
                '#targetAttribute': targetAttribute,
            },
            Select: 'COUNT',
        });

        const result = await dynamoDB.send(queryCommand);
        console.log(`Found ${result.Count} connections for targetClass ${targetClass} with targetId ${targetId}`);
        return result.Count > 0;
    } catch (error) {
        console.error('checkConnectionAvailability failed:', {
            error: error.message,
            stack: error.stack,
            targetClass: targetClass,
            targetId: targetId
        });
        return false;
  }
}*/

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
         * 
         {
            "messageId": "123456",
            "timestamp": "2025-10-03T14:00:00Z",
            "targetChannel": "WebSocket",
            "payload": {
                "targetId": "abc123xyz",
                "targetClass": "user", // user, org, hub
                "eventType": "notification",
                "content": "Neue Nachricht verfügbar",
                "priority": "high"
            }
            }
         */
        const { targetChannel, payload } = messageBody;

        if (!targetChannel || !payload ) {
            console.error('Missing parameter in body.');
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: 'Missing parameter in body.',
                }),
            };
        }
            
        console.log(`Publishing message for cognito user ${cognitoUserId} to targetChannel ${targetChannel}`);

        /*const authorized = await checkConnectionAvailability(targetId);
        if(!authorized) {
            return {
                statusCode: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: `No available target "${targetId}" found`,
                }),
            };
        }*/
           
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