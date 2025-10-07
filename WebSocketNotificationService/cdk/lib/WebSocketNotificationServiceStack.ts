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
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export class WebSocketNotificationService extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stackName = process.env.STACK_NAME || 'NotificationServiceStack';
    this.node.setContext('stackName', stackName);

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
      generateSecret: false,
      authFlows: {
        userSrp: true,        // Enable Secure Remote Password protocol
        userPassword: true,    // Keep this for backward compatibility
      },
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    })

    // for reliable order, higher latency
    const notificationFifoTopic = new sns.Topic(this, 'NotificationFifoTopic', {
      displayName: 'NotificationFifoTopic',
      topicName: `${stackName}-Notifications.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
    });

    // standard topic, lower latency
    const notificationTopic = new sns.Topic(this, 'NotificationTopic', {
      displayName: 'NotificationTopic',
      topicName: `${stackName}-Notification`,
    });
  
    // DLQ for failed WebSocket FIFO notifications
    const webSocketFifoDlq = new sqs.Queue(this, 'WebSocketFifoDLQ', {
      queueName: `${stackName}-WebSocketFifoDLQ.fifo`,
      fifo: true,
    });

    // DLQ for failed WebSocket Standard notifications
    const webSocketStandardDlq = new sqs.Queue(this, 'WebSocketStandardDLQ', {
      queueName: `${stackName}-WebSocketStandardDLQ`,
    });

    // SQS FIFO Queue to buffer WebSocket messages for the processor
    const webSocketFifoQueue = new sqs.Queue(this, 'WebSocketFifoQueue', {
      queueName: `${stackName}-WebSocketFifoQueue.fifo`,
      fifo: true,
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: webSocketFifoDlq,
      },
    });

    // SQS Standard Queue to buffer WebSocket messages for the processor (high-throughput, reliable)
    const webSocketStandardQueue = new sqs.Queue(this, 'WebSocketStandardQueue', {
      queueName: `${stackName}-WebSocketStandardQueue`,
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: webSocketStandardDlq,
      },
    });

    // Subscribe the SQS FIFO queue to the SNS FIFO topic with targetChannel filter
    notificationFifoTopic.addSubscription(new subscription.SqsSubscription(webSocketFifoQueue, {
      filterPolicy: {
        targetChannel: sns.SubscriptionFilter.stringFilter({
          allowlist: ['WebSocket'],
        }),
      },
    }));

    // Subscribe the SQS Standard queue to the SNS Standard topic with targetChannel filter
    notificationTopic.addSubscription(new subscription.SqsSubscription(webSocketStandardQueue, {
      filterPolicy: {
        targetChannel: sns.SubscriptionFilter.stringFilter({
          allowlist: ['WebSocket'],
        }),
      },
    }));

    const connectionTable = new dynamodb.Table(this, 'ConnectionTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in production
    });

    const webSocketAuthFunction = new lambda.Function(this, 'WebSocketAuthorizerFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../websocket-authorizer'),
      environment: {
        CONNECTION_TABLE: connectionTable.tableName,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        JWKS_URI: `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${userPool.userPoolId}/.well-known/jwks.json`,
      },
      timeout: cdk.Duration.seconds(10),
    });

    // this is a lambda request authorizer for WebSocket API
   const websocketLambdaAuthorizer = new cdk.aws_apigatewayv2_authorizers.WebSocketLambdaAuthorizer('WebSocketAuthorizer', webSocketAuthFunction, {
      authorizerName: 'WebSocketAuthorizer',
      // Token as query string parameter because of WebSocket Protocol Limitation. Optional todo: Encrypt token
      identitySource: ['route.request.querystring.token'],
    });

    // WebSocket API for real-time notifications
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi');

    // lambda function to handle WebSocket connections
    const connectionHandler = new lambda.Function(this, 'ConnectionHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../connection-handler'),
      environment: {
        CONNECTION_TABLE: connectionTable.tableName,
      },
    });

    connectionTable.addGlobalSecondaryIndex({
      indexName: 'UserIndex',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    connectionTable.addGlobalSecondaryIndex({
      indexName: 'OrgIndex',
      partitionKey: {
        name: 'orgId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    connectionTable.addGlobalSecondaryIndex({
      indexName: 'HubIndex',
      partitionKey: {
        name: 'hubId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    connectionTable.addGlobalSecondaryIndex({
      indexName: 'ProjectIndex',
      partitionKey: {
        name: 'projectId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    connectionTable.grantWriteData(connectionHandler);

    const LambdaIntegration = new integrations.WebSocketLambdaIntegration(
      'ConnectionHandlerIntegration',
       connectionHandler
    );

    webSocketApi.addRoute('$connect', { 
      integration: LambdaIntegration,
      authorizer: websocketLambdaAuthorizer,
    });
    
    webSocketApi.addRoute('$disconnect', { 
      integration: LambdaIntegration,
    });

    // ============================================
    // P2P (Person-to-Person) - WebSocket $default route
    // Authenticated users publish messages via WebSocket
    // ============================================
    const p2pWebSocketPublisher = new lambda.Function(this, 'P2PWebSocketPublisher', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../websocket-message-publisher'),
      environment: {
        FIFO_TOPIC_ARN: notificationFifoTopic.topicArn,
        STANDARD_TOPIC_ARN: notificationTopic.topicArn,
      },
      timeout: cdk.Duration.seconds(10),
    });

    notificationFifoTopic.grantPublish(p2pWebSocketPublisher);
    notificationTopic.grantPublish(p2pWebSocketPublisher);

    webSocketApi.addRoute('$default', {
      integration: new integrations.WebSocketLambdaIntegration(
        'P2PWebSocketIntegration',
        p2pWebSocketPublisher
      ),
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
      description: 'WebSocket API endpoint URL',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    // ============================================
    // A2P (Application-to-Person) - HTTP REST API
    // External services publish messages via HTTPS
    // ============================================
    const notificationApi = new apigateway.RestApi(this, 'NotificationApi', {
      restApiName: `${stackName}-NotificationApi`,
      description: 'HTTP API for publishing notifications (A2P)',
      deployOptions: {
        stageName: 'dvl',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: false,
      }
    });

    const publishResource = notificationApi.root.addResource('publish');

    // A2P Publisher Lambda - Handles HTTP requests from external services
    const a2pHttpPublisher = new lambda.Function(this, 'A2PHttpPublisher', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../http-message-publisher'),
      environment: {
      FIFO_TOPIC_ARN: notificationFifoTopic.topicArn,
      STANDARD_TOPIC_ARN: notificationTopic.topicArn,
      },
      timeout: cdk.Duration.seconds(10),
    });

    notificationFifoTopic.grantPublish(a2pHttpPublisher);
    notificationTopic.grantPublish(a2pHttpPublisher);
    
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'CognitoNotificationApiAuthorizer',
      identitySource: 'method.request.header.Authorization',
    });

    const a2pHttpPublishIntegration = new apigateway.LambdaIntegration(a2pHttpPublisher);
    publishResource.addMethod('POST', a2pHttpPublishIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Output the REST API URL
    new cdk.CfnOutput(this, 'NotificationApiUrl', {
      value: notificationApi.url + 'publish',
      description: 'HTTP REST API endpoint for A2P message publishing',
    });

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
      reservedConcurrentExecutions: 10,
    });

    // SQS event source for FIFO messages (ordered, deduplicated)
    processorLambda.addEventSource(new SqsEventSource(webSocketFifoQueue, {
      batchSize: 5,
      reportBatchItemFailures: true,
    }));

    // SQS event source for Standard messages (high-throughput, reliable)
    processorLambda.addEventSource(new SqsEventSource(webSocketStandardQueue, {
      batchSize: 10, // Higher batch size for standard queue for better throughput
      reportBatchItemFailures: true,
    }));

    connectionTable.grantReadWriteData(processorLambda);

    // Grant permissions to manage WebSocket connections
    processorLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [
        // first * is the stage, second * is the route, third * is the connectionId
        `arn:${cdk.Aws.PARTITION}:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${webSocketApi.apiId}/*/*/@connections/*`
      ],
    }));

    // CloudWatch Alarm for ProcessorLambda Errors
    const processorErrorAlarm = new cloudwatch.Alarm(this, 'ProcessorErrorAlarm', {
      metric: processorLambda.metricErrors({
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if the ProcessorLambda fails one or more times in a 1 minute period.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // CloudWatch Alarm for ProcessorLambda Duration (P90)
    const p95LatencyAlarm = new cloudwatch.Alarm(this, 'P95LatencyAlarm', {
      metric: processorLambda.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: 'p95',
      }),
      threshold: 500, // 0.5 seconds for p95
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if the 95th percentile latency exceeds 500 Milliseconds over a 5 minute period.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // High Latency Count Alarm (count of messages over threshold)
    const highLatencyCountFilter = processorLambda.logGroup.addMetricFilter('HighLatencyCountFilter', {
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.exists('$.event_type'),
        logs.FilterPattern.stringValue('$.event_type', '=', 'latency_measurement'),
        logs.FilterPattern.numberValue('$.latency_seconds', '>', 3)
      ), // Messages over 3 seconds
      metricName: 'HighLatencyMessageCount',
      metricNamespace: 'NotificationService',
      metricValue: '1', // Count each occurrence
      unit: cloudwatch.Unit.COUNT,
    });

    const highLatencyCountAlarm = new cloudwatch.Alarm(this, 'HighLatencyCountAlarm', {
      metric: highLatencyCountFilter.metric({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10, // Alert if more than 10 high-latency messages in 5 minutes
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if more than 10 messages exceed 3 seconds latency in a 5 minute period.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Metric Filter to extract latency from structured JSON logs
    const latencyMetricFilter = processorLambda.logGroup.addMetricFilter('LatencyMetricFilter', {
      // Filter only logs that contain latency measurements
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.exists('$.event_type'),
        logs.FilterPattern.stringValue('$.event_type', '=', 'latency_measurement'),
        logs.FilterPattern.exists('$.latency_seconds')
      ),
      metricName: 'MessageLatency',
      metricNamespace: 'NotificationService',
      metricValue: '$.latency_seconds',
      unit: cloudwatch.Unit.MILLISECONDS,
      defaultValue: 0, // Important: provides default value when no logs match
    });

    // CloudWatch Alarm for Average Latency
    const averageLatencyAlarm = new cloudwatch.Alarm(this, 'AverageLatencyAlarm', {
      metric: latencyMetricFilter.metric({
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 2, // 2 seconds
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if the average message latency exceeds 2 seconds over consecutive 5 minute periods.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Action for the alarms: notify the SNS topic
    const snsAction = new cloudwatch_actions.SnsAction(notificationFifoTopic);
    processorErrorAlarm.addAlarmAction(snsAction);
    p95LatencyAlarm.addAlarmAction(snsAction);
    averageLatencyAlarm.addAlarmAction(snsAction);
    highLatencyCountAlarm.addAlarmAction(snsAction);


    const latencyDashboard = new cloudwatch.Dashboard(this, 'LatencyDashboard', {
      dashboardName: 'NotificationService-Latency',
    })

    const latencyMetric = latencyMetricFilter.metric({
      period: cdk.Duration.minutes(1),
    });

      latencyDashboard.addWidgets(
        // Average latency over time
        new cloudwatch.GraphWidget({
          title: 'Message Latency - Average',
          left: [latencyMetric.with({ statistic: 'Average' })],
          period: cdk.Duration.minutes(1),
          width: 12,
          height: 6,
          leftYAxis: {
            min: 0,
            label: 'Seconds',
          },
          view: cloudwatch.GraphWidgetView.TIME_SERIES,
        }),
    
        // Latency percentiles
        new cloudwatch.GraphWidget({
          title: 'Message Latency - Percentiles',
          left: [
            latencyMetric.with({ statistic: 'p50', label: 'p50' }),
            latencyMetric.with({ statistic: 'p95', label: 'p95' }),
            latencyMetric.with({ statistic: 'p99', label: 'p99' }),
            latencyMetric.with({ statistic: 'Maximum', label: 'Max' }),
          ],
          period: cdk.Duration.minutes(1),
          width: 12,
          height: 6,
          leftYAxis: {
            min: 0,
            label: 'Seconds',
          },
        }),
    
      // Message throughput and high latency count
      new cloudwatch.GraphWidget({
        title: 'Message Throughput & High Latency Count',
        left: [latencyMetric.with({ statistic: 'SampleCount', label: 'Total Messages' })],
        right: [highLatencyCountFilter.metric().with({ statistic: 'Sum', label: 'High Latency Messages' })],
        period: cdk.Duration.minutes(1),
        width: 12,
        height: 6,
        leftYAxis: {
          min: 0,
          label: 'Count',
        },
        rightYAxis: {
          min: 0,
          label: 'High Latency Count',
        },
      }),
    
      // Alarm status
      new cloudwatch.SingleValueWidget({
        title: 'Alarm Status',
        metrics: [
          averageLatencyAlarm.metric,
          p95LatencyAlarm.metric,
          highLatencyCountAlarm.metric,
        ],
        width: 12,
        height: 3,
      })
    );
  }
}
