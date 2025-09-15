const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(dynamoClient);
const sns = new SNSClient({});

async function checkConnectionAvailability(targetClass, targetId) 
{
    const targetAttribute = targetClass === "org" ? "orgId" : targetClass === "hub" ? "hubId" : "userId";
    try {    
        // For user, check user existence
        if (targetClass === "user") {
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
        }
        
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

        const { TargetClass, TargetId, Subject, Data } = messageBody;

        if (!TargetClass || !TargetId || !Subject || !Data ) {
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
            
        console.log(`Publishing message for cognito user ${cognitoUserId} with target ${TargetId} in targetclass ${TargetClass}`);

        // todo: optionally check if cognito user is allowed to publish to this target
        const authorized = await checkConnectionAvailability(TargetClass, TargetId);
        if(!authorized) {
            return {
                statusCode: 404,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({
                    error: `No available target "${TargetId}" for targetClass "${TargetClass}" found`,
                }),
            };
        }
           
        const publishTimestamp = new Date().toISOString();

        const messageToPublish = {
            ...Data,
            publishTimestamp: publishTimestamp,
        };

        const command = new PublishCommand({
            TopicArn: process.env.TOPIC_ARN,
            Message: JSON.stringify(messageToPublish),
            MessageAttributes: {
                TargetClass: {
                  DataType: 'String',
                  StringValue: TargetClass,
                },
                TargetId: {
                    DataType: 'String',
                    StringValue: TargetId,
                },
                Subject: {
                    DataType: 'String',
                    StringValue: Subject,
                },
                timestamp: {
                  DataType: 'String',
                  StringValue: publishTimestamp,
                }
            },
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