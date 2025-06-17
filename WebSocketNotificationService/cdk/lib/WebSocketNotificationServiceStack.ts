import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as subscription from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as congnito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class WebSocketNotificationService extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const userPool = new congnito.UserPool(this, 'UserPool', {
      userPoolName: 'websocket-user-pool',
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in production
    });

    const userPoolClient = new congnito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      generateSecret: false, // Set to true for server-side applications
      authFlows: {
        userPassword: true,
        userSrp: true, // Secure Remote Password (SRP) flow
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    })

    // SNS Topic for WebSocket Notifications
    const notificationTopic = new sns.Topic(this, 'WebSocketNotificationTopic', {
      displayName: 'WebSocketNotificationTopic',
    });

    // optional: DLQ for failed notifications
    const dlq = new sqs.Queue(this, 'NotificationDLQ');

    const connectionTable = new dynamodb.Table(this, 'ConnectionTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in production
    });

    /*const authorizerFunction = new lambda.Function(this, 'AuthorizerFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../authorizer'),
      environment: {
        CONNECTION_TABLE: connectionTable.tableName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        AWS_REGION: cdk.Aws.REGION,
      },
      timeout: cdk.Duration.seconds(30),
    });

    const customAuthorizer = new apigateway.TokenAuthorizer(this, 'WebSocketAuthorizer', {
      handler: authorizerFunction,
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    connectionTable.grantReadData(authorizerFunction);*/

    // Add GSI for querying by userId and projectId
    connectionTable.addGlobalSecondaryIndex({
      indexName: 'ProjectUserIndex',
      partitionKey: {
        name: 'projectId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // WebSocket API for real-time notifications
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi');

    // lambda function to handle WebSocket connections
    const connectionHandler = new lambda.Function(this, 'ConnectionHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../connection-handler'),
      environment: {
        CONNECTION_TABLE: connectionTable.tableName,
      },
    });

    connectionTable.grantWriteData(connectionHandler);

    const LambdaIntegration = new integrations.WebSocketLambdaIntegration(
      'ConnectionHandlerIntegration',
       connectionHandler
    );

    // TODO: build websocket authorizer (https://loginov-rocks.medium.com/authorize-access-to-websocket-api-gateway-with-cognito-d7c0d35e7e89)
      webSocketApi.addRoute('$connect', { 
      integration: LambdaIntegration,
    });
    
    webSocketApi.addRoute('$disconnect', { 
      integration: LambdaIntegration,
    });

    webSocketApi.grantManageConnections(connectionHandler);

    const WebSocketApiStage = new apigatewayv2.WebSocketStage(this, 'DevelopmentStage', {
      webSocketApi,
      stageName: 'dvl',
      autoDeploy: true,
    });

    connectionHandler.addPermission('WebSocketApiPermission', {
      action: 'lambda:InvokeFunction',
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:${cdk.Aws.PARTITION}:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${webSocketApi.apiId}/*/*`,
    });

    new cdk.CfnOutput(this, 'WebSocketApiUrl', {
      value: WebSocketApiStage.url,
    });

    // REST Api to publish SNS messages
    const notificationApi = new apigateway.RestApi(this, 'NotificationApi', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST'],
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
        allowCredentials: true,
      }
    });

    const publishResource = notificationApi.root.addResource('publish');

    const publishHandler = new lambda.Function(this, 'PublishHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../publisher'),
      environment: {
      TOPIC_ARN: notificationTopic.topicArn,
      },
    });

    notificationTopic.grantPublish(publishHandler);
    
    const publishIntegration = new apigateway.LambdaIntegration(publishHandler);
    publishResource.addMethod('POST', publishIntegration);
    
    /*publishResource.addMethod('POST', publishIntegration, {
      // to check if the user is authenticated and authorized to publish messages (userId part of project)
      authorizer: customAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    });*/

    // receives SNS notifications and processes them
    const processorLambda = new lambda.Function(this, 'ProcessorLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../processor'),
      environment: {
        CONNECTION_TABLE: connectionTable.tableName,
        // Convert WebSocket URL to HTTPS URL for management API
        WS_API_ENDPOINT: WebSocketApiStage.url.replace('wss://', 'https://'),
      },
      timeout: cdk.Duration.seconds(60),
    });

    connectionTable.grantReadWriteData(processorLambda);

    // Grant permissions to manage WebSocket connections
    processorLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:${cdk.Aws.PARTITION}:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${webSocketApi.apiId}/*/*/@connections/*`
      ],
    }));

    notificationTopic.addSubscription(new subscription.LambdaSubscription(processorLambda, {
      deadLetterQueue: dlq,
    }));

  }
}
