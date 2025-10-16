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
      deduplicationScope: sqs.DeduplicationScope.MESSAGE_GROUP,
      fifoThroughputLimit: sqs.FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
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

    // ============================================
    // Message Storage Queue & Lambda
    // Stores all messages persistently for later retrieval
    // ============================================
    const messageStorageQueue = new sqs.Queue(this, 'MessageStorageQueue', {
      queueName: `${stackName}-MessageStorageQueue`,
      visibilityTimeout: cdk.Duration.seconds(60),
    });

    // Subscribe storage queue to BOTH SNS topics (all messages regardless of type)
    notificationFifoTopic.addSubscription(new subscription.SqsSubscription(messageStorageQueue, {
      filterPolicy: {
        targetChannel: sns.SubscriptionFilter.stringFilter({
          allowlist: ['WebSocket'],
        }),
      },
      rawMessageDelivery: false, // Keep SNS envelope for metadata
    }));

    notificationTopic.addSubscription(new subscription.SqsSubscription(messageStorageQueue, {
      filterPolicy: {
        targetChannel: sns.SubscriptionFilter.stringFilter({
          allowlist: ['WebSocket'],
        }),
      },
      rawMessageDelivery: false,
    }));

    const connectionTable = new dynamodb.Table(this, 'ConnectionTable', {
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in production
    });

    // GSI for Chat-ID based routing (supports multiple chat IDs per connection)
    connectionTable.addGlobalSecondaryIndex({
      indexName: 'ChatIdIndex',
      partitionKey: {
        name: 'chatId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Sequence counter table for custom consecutive sequence numbers
    const sequenceTable = new dynamodb.Table(this, 'SequenceCounterTable', {
      partitionKey: { name: 'scope', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in production
    });

    // Message Storage Table for persistent message history (30 days retention)
    const messageStorageTable = new dynamodb.Table(this, 'MessageStorageTable', {
      partitionKey: { name: 'chatId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in production
    });

    // GSI for sequence-based queries (optional - for efficient gap detection)
    messageStorageTable.addGlobalSecondaryIndex({
      indexName: 'SequenceIndex',
      partitionKey: { name: 'chatId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sequenceNumber', type: dynamodb.AttributeType.NUMBER },
    });

    // ============================================
    // User Chat Permissions Table
    // Stores user permissions for chat access
    // ============================================
    const userChatPermissionsTable = new dynamodb.Table(this, 'UserChatPermissionsTable', {
      tableName: `${stackName}-UserChatPermissions`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'chatId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in production
    });

    // GSI for reverse lookup: which users have access to a chat
    userChatPermissionsTable.addGlobalSecondaryIndex({
      indexName: 'ChatIdIndex',
      partitionKey: { name: 'chatId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });

    const webSocketAuthFunction = new lambda.Function(this, 'WebSocketAuthorizerFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../websocket-authorizer'),
      environment: {
        CONNECTION_TABLE: connectionTable.tableName,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        JWKS_URI: `https://cognito-idp.${cdk.Aws.REGION}.amazonaws.com/${userPool.userPoolId}/.well-known/jwks.json`,
        PERMISSIONS_TABLE: userChatPermissionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
    });

    // Grant read permissions to check user access
    userChatPermissionsTable.grantReadData(webSocketAuthFunction);

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

    // Grant read+write permissions for connect (write) and disconnect (scan+delete)
    connectionTable.grantReadWriteData(connectionHandler);

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
        SEQUENCE_TABLE: sequenceTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      reservedConcurrentExecutions: 1,
      tracing: lambda.Tracing.ACTIVE,
    });

    notificationFifoTopic.grantPublish(p2pWebSocketPublisher);
    notificationTopic.grantPublish(p2pWebSocketPublisher);
    sequenceTable.grantReadWriteData(p2pWebSocketPublisher);

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
        tracingEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
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
      SEQUENCE_TABLE: sequenceTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      reservedConcurrentExecutions: 1,
      tracing: lambda.Tracing.ACTIVE,
    });

    notificationFifoTopic.grantPublish(a2pHttpPublisher);
    notificationTopic.grantPublish(a2pHttpPublisher);
    sequenceTable.grantReadWriteData(a2pHttpPublisher);
    
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
      reservedConcurrentExecutions: 1,
      tracing: lambda.Tracing.ACTIVE,
    });

    // SQS event source for FIFO messages (ordered, deduplicated)
    processorLambda.addEventSource(new SqsEventSource(webSocketFifoQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));

    // SQS event source for Standard messages (high-throughput, reliable)
    processorLambda.addEventSource(new SqsEventSource(webSocketStandardQueue, {
      batchSize: 1, // Higher batch size for standard queue for better throughput
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

    // ============================================
    // Message Storage Lambda
    // Stores messages in DynamoDB for later retrieval
    // ============================================
    const messageStorageLambda = new lambda.Function(this, 'MessageStorageLambda', {
      functionName: `${stackName}-MessageStorage`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../message-storage-handler'),
      environment: {
        MESSAGE_STORAGE_TABLE: messageStorageTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      reservedConcurrentExecutions: 5,
    });

    // SQS event source for message storage
    messageStorageLambda.addEventSource(new SqsEventSource(messageStorageQueue, {
      batchSize: 10,
      reportBatchItemFailures: true,
    }));

    messageStorageTable.grantWriteData(messageStorageLambda);

    // ============================================
    // Message Retrieval API
    // REST endpoint for clients to fetch message history
    // ============================================
    const messageRetrievalLambda = new lambda.Function(this, 'MessageRetrievalLambda', {
      functionName: `${stackName}-MessageRetrieval`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../message-retrieval-handler'),
      environment: {
        MESSAGE_STORAGE_TABLE: messageStorageTable.tableName,
        PERMISSIONS_TABLE: userChatPermissionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
    });

    messageStorageTable.grantReadData(messageRetrievalLambda);
    userChatPermissionsTable.grantReadData(messageRetrievalLambda);

    // Add /messages endpoint to REST API
    const messagesResource = notificationApi.root.addResource('messages');
    messagesResource.addMethod('GET',
      new apigateway.LambdaIntegration(messageRetrievalLambda),
      {
        authorizer: cognitoAuthorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.chatId': true,
          'method.request.querystring.limit': false,
          'method.request.querystring.startKey': false,
          'method.request.querystring.fromTimestamp': false,
          'method.request.querystring.toTimestamp': false,
        },
      }
    );

    // ============================================
    // Permission Management API
    // REST endpoints for managing chat permissions
    // ============================================
    const chatPermissionLambda = new lambda.Function(this, 'ChatPermissionLambda', {
      functionName: `${stackName}-ChatPermission`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../chat-permission-handler'),
      environment: {
        PERMISSIONS_TABLE: userChatPermissionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
    });

    userChatPermissionsTable.grantReadWriteData(chatPermissionLambda);

    // Add /permissions endpoint to REST API
    const permissionsResource = notificationApi.root.addResource('permissions');
    
    // POST /permissions - Grant permission
    permissionsResource.addMethod('POST',
      new apigateway.LambdaIntegration(chatPermissionLambda),
      {
        authorizer: cognitoAuthorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // DELETE /permissions - Revoke permission
    permissionsResource.addMethod('DELETE',
      new apigateway.LambdaIntegration(chatPermissionLambda),
      {
        authorizer: cognitoAuthorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.userId': true,
          'method.request.querystring.chatId': true,
        },
      }
    );

    // GET /permissions - List permissions
    permissionsResource.addMethod('GET',
      new apigateway.LambdaIntegration(chatPermissionLambda),
      {
        authorizer: cognitoAuthorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
        requestParameters: {
          'method.request.querystring.userId': false,
        },
      }
    );

    // ===========================================================
    // ===== Metric Collector Lambda =====
    // Collects client-side metrics for end-to-end latency tracking
    // ===========================================================
    const metricCollectorLambda = new lambda.Function(this, 'MetricCollectorLambda', {
      functionName: `${stackName}-MetricCollector`,
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset('../metric-collector'),
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Add /metrics endpoint to REST API
    const metricsResource = notificationApi.root.addResource('metrics');
    metricsResource.addMethod('POST', 
      new apigateway.LambdaIntegration(metricCollectorLambda),
      {
        authorizer: cognitoAuthorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      }
    );

    // CloudWatch Alarm for ProcessorLambda Duration (P90)
    /*const p95LatencyAlarm = new cloudwatch.Alarm(this, 'P95LatencyAlarm', {
      metric: processorLambda.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: 'p95',
      }),
      threshold: 500, // 0.5 seconds for p95
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if the 95th percentile latency exceeds 500 Milliseconds over a 5 minute period.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });*/

    // High Latency Count Alarm (count of messages over threshold)
    const highLatencyCountFilter = processorLambda.logGroup.addMetricFilter('HighLatencyCountFilter', {
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.exists('$.event_type'),
        logs.FilterPattern.stringValue('$.event_type', '=', 'latency_measurement'),
        logs.FilterPattern.numberValue('$.latency_ms', '>', 1000)
      ), // Messages over 1000ms (1 second)
      metricName: 'HighLatencyMessageCount',
      metricNamespace: 'NotificationService',
      metricValue: '1', // Count each occurrence
      unit: cloudwatch.Unit.COUNT,
    });

    /*const highLatencyCountAlarm = new cloudwatch.Alarm(this, 'HighLatencyCountAlarm', {
      metric: highLatencyCountFilter.metric({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10, // Alert if more than 10 high-latency messages in 5 minutes
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm if more than 10 messages exceed 3 seconds latency in a 5 minute period.',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });*/

    // Metric Filter to extract Publisher → Processor latency from structured JSON logs
    // This measures the time from when a message is published until it reaches the processor Lambda
    const latencyMetricFilter = processorLambda.logGroup.addMetricFilter('PublisherToProcessorLatencyFilter', {
      // Filter only logs that contain latency measurements
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.exists('$.event_type'),
        logs.FilterPattern.stringValue('$.event_type', '=', 'latency_measurement'),
        logs.FilterPattern.exists('$.latency_ms')
      ),
      metricName: 'PublisherToProcessorLatency',
      metricNamespace: 'NotificationService',
      metricValue: '$.latency_ms',
      unit: cloudwatch.Unit.MILLISECONDS,
      defaultValue: 0, // Important: provides default value when no logs match
    });

    // CloudWatch Alarm for Average Latency
    /*const averageLatencyAlarm = new cloudwatch.Alarm(this, 'AverageLatencyAlarm', {
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
    });*/

    // Action for the alarms: notify the SNS topic
    // const snsAction = new cloudwatch_actions.SnsAction(notificationFifoTopic);
    // processorErrorAlarm.addAlarmAction(snsAction);
    // p95LatencyAlarm.addAlarmAction(snsAction);
    // averageLatencyAlarm.addAlarmAction(snsAction);
    // highLatencyCountAlarm.addAlarmAction(snsAction);


    // ===== CloudWatch Dashboard =====
    const latencyDashboard = new cloudwatch.Dashboard(this, 'LatencyDashboard', {
      dashboardName: 'NotificationService-Latency',
    })

    const latencyMetric = latencyMetricFilter.metric({
      period: cdk.Duration.minutes(1),
    });

    // Client-side metric filters
    const clientE2ELatencyFilter = metricCollectorLambda.logGroup.addMetricFilter('ClientE2ELatencyFilter', {
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.exists('$.metric_name'),
        logs.FilterPattern.stringValue('$.metric_name', '=', 'EndToEndLatency'),
      ),
      metricName: 'ClientEndToEndLatency',
      metricNamespace: 'NotificationService/Client',
      metricValue: '$.metric_value',
      unit: cloudwatch.Unit.MILLISECONDS,
    });

    const clientNetworkLatencyFilter = metricCollectorLambda.logGroup.addMetricFilter('ClientNetworkLatencyFilter', {
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.exists('$.metric_name'),
        logs.FilterPattern.stringValue('$.metric_name', '=', 'NetworkLatency'),
      ),
      metricName: 'ClientNetworkLatency',
      metricNamespace: 'NotificationService/Client',
      metricValue: '$.metric_value',
      unit: cloudwatch.Unit.MILLISECONDS,
    });

    const clientJitterFilter = metricCollectorLambda.logGroup.addMetricFilter('ClientJitterFilter', {
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.exists('$.metric_name'),
        logs.FilterPattern.stringValue('$.metric_name', '=', 'Jitter'),
      ),
      metricName: 'ClientJitter',
      metricNamespace: 'NotificationService/Client',
      metricValue: '$.metric_value',
      unit: cloudwatch.Unit.MILLISECONDS,
    });

    latencyDashboard.addWidgets(
      // PRIMARY: End-to-End Latency Percentiles (Publisher → Client)
      // This is the most important metric for user experience
      new cloudwatch.GraphWidget({
        title: 'End-to-End Latency (Publisher → Client) - Percentiles',
        left: [
          clientE2ELatencyFilter.metric().with({ statistic: 'p50', label: 'P50 (Median)', color: '#2CA02C' }),
          clientE2ELatencyFilter.metric().with({ statistic: 'p90', label: 'P90', color: '#FF7F0E' }),
          clientE2ELatencyFilter.metric().with({ statistic: 'p95', label: 'P95', color: '#D62728' }),
          clientE2ELatencyFilter.metric().with({ statistic: 'p99', label: 'P99', color: '#9467BD' }),
        ],
        width: 24,
        height: 6,
        leftYAxis: {
          label: 'Milliseconds',
          min: 0,
        },
        view: cloudwatch.GraphWidgetView.TIME_SERIES,
      }),

      // Latency Breakdown: Component Comparison
      new cloudwatch.GraphWidget({
        title: 'Latency Breakdown: Publisher→Processor vs Processor→Client',
        left: [
          latencyMetric.with({ 
            statistic: 'Average', 
            label: 'Publisher→Processor (Avg)',
            color: '#FF9900',
          }),
          clientNetworkLatencyFilter.metric().with({ 
            statistic: 'Average', 
            label: 'Processor→Client (Avg)',
            color: '#1F77B4',
          }),
          clientE2ELatencyFilter.metric().with({ 
            statistic: 'Average', 
            label: 'Total E2E (Avg)',
            color: '#2CA02C',
          }),
        ],
        period: cdk.Duration.minutes(1),
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Milliseconds',
          min: 0,
        },
      }),

      // E2E Latency Statistics (Avg, Min, Max)
      new cloudwatch.GraphWidget({
        title: 'End-to-End Latency - Average & Extremes',
        left: [
          clientE2ELatencyFilter.metric().with({ statistic: 'Average', label: 'Average', color: '#1F77B4' }),
          clientE2ELatencyFilter.metric().with({ statistic: 'Minimum', label: 'Minimum', color: '#2CA02C' }),
          clientE2ELatencyFilter.metric().with({ statistic: 'Maximum', label: 'Maximum', color: '#D62728' }),
        ],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Milliseconds',
          min: 0,
        },
      }),

      // Publisher → Processor Latency Percentiles (for debugging)
      new cloudwatch.GraphWidget({
        title: 'Publisher → Processor Latency - Percentiles',
        left: [
          latencyMetric.with({ statistic: 'p50', label: 'P50', color: '#2CA02C' }),
          latencyMetric.with({ statistic: 'p90', label: 'P90', color: '#FF7F0E' }),
          latencyMetric.with({ statistic: 'p95', label: 'P95', color: '#D62728' }),
          latencyMetric.with({ statistic: 'p99', label: 'P99', color: '#9467BD' }),
        ],
        period: cdk.Duration.minutes(1),
        width: 12,
        height: 6,
        leftYAxis: {
          min: 0,
          label: 'Milliseconds',
        },
      }),

      // Network Latency Percentiles (Processor → Client)
      new cloudwatch.GraphWidget({
        title: 'Network Latency (Processor → Client) - Percentiles',
        left: [
          clientNetworkLatencyFilter.metric().with({ statistic: 'p50', label: 'P50', color: '#2CA02C' }),
          clientNetworkLatencyFilter.metric().with({ statistic: 'p90', label: 'P90', color: '#FF7F0E' }),
          clientNetworkLatencyFilter.metric().with({ statistic: 'p95', label: 'P95', color: '#D62728' }),
          clientNetworkLatencyFilter.metric().with({ statistic: 'p99', label: 'P99', color: '#9467BD' }),
        ],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Milliseconds',
          min: 0,
        },
      }),

      // Jitter
      new cloudwatch.GraphWidget({
        title: 'Latency Jitter - Percentiles',
        left: [
          clientJitterFilter.metric().with({ statistic: 'p50', label: 'P50 Jitter', color: '#2CA02C' }),
          clientJitterFilter.metric().with({ statistic: 'p90', label: 'P90 Jitter', color: '#FF7F0E' }),
          clientJitterFilter.metric().with({ statistic: 'p95', label: 'P95 Jitter', color: '#D62728' }),
        ],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Milliseconds',
          min: 0,
          showUnits: true,
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
          showUnits: true,
        },
        rightYAxis: {
          min: 0,
          label: 'High Latency Count',
          showUnits: true,
        },
      }),
    
      // Alarm status
      /*new cloudwatch.SingleValueWidget({
        title: 'Alarm Status',
        metrics: [
          averageLatencyAlarm.metric,
          p95LatencyAlarm.metric,
          highLatencyCountAlarm.metric,
        ],
        width: 12,
        height: 3,
      })*/
    );

    // ============================================
    // CloudFormation Outputs
    // ============================================
    new cdk.CfnOutput(this, 'PermissionsTableName', {
      value: userChatPermissionsTable.tableName,
      description: 'DynamoDB table for user chat permissions',
    });

    new cdk.CfnOutput(this, 'PermissionsApiUrl', {
      value: notificationApi.url + 'permissions',
      description: 'REST API endpoint for permission management',
    });

    new cdk.CfnOutput(this, 'MessageRetrievalApiUrl', {
      value: notificationApi.url + 'messages',
      description: 'REST API endpoint for message retrieval',
    });
  }
}
