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
      fifoThroughputScope: sns.FifoThroughputScope.MESSAGE_GROUP, // high throughput within message groups, as scope of deduplication is within each individual message group instead of the entire topic
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
      retentionPeriod: cdk.Duration.days(14), // Max retention period
    });

    // DLQ for failed WebSocket Standard notifications
    const webSocketStandardDlq = new sqs.Queue(this, 'WebSocketStandardDLQ', {
      queueName: `${stackName}-WebSocketStandardDLQ`,
      retentionPeriod: cdk.Duration.days(14), // Max retention period
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
      // deduplicationScope: sqs.DeduplicationScope.MESSAGE_GROUP,
      fifoThroughputLimit: sqs.FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
      retentionPeriod: cdk.Duration.days(13),
      // contentBasedDeduplication: true,
    });

    // SQS Standard Queue to buffer WebSocket messages for the processor (high-throughput, reliable)
    const webSocketStandardQueue = new sqs.Queue(this, 'WebSocketStandardQueue', {
      queueName: `${stackName}-WebSocketStandardQueue`,
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: webSocketStandardDlq,
      },
      retentionPeriod: cdk.Duration.days(13),
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

    // Subscribe storage queue to BOTH SNS topics (all messages regardless of type standard or fifo)
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
      sortKey: { name: 'publishedAt', type: dynamodb.AttributeType.STRING },
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
      },
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
    });

    // add provisioned concurrency to reduce cold starts
    const p2pWebSocketPublisherVersion = p2pWebSocketPublisher.currentVersion;
    const p2pWebSocketPublisherAlias = new lambda.Alias(this, 'P2PWebSocketPublisherAlias', {
      aliasName: 'live',
      version: p2pWebSocketPublisherVersion,
      provisionedConcurrentExecutions: 1,
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
    webSocketApi.grantManageConnections(p2pWebSocketPublisher); // Grant permissions for ACK messages

    const WebSocketApiStage = new apigatewayv2.WebSocketStage(this, 'DevelopmentStage', {
      webSocketApi,
      stageName: 'dvl',
      autoDeploy: true,
    });

    // Add WebSocket API endpoint to p2pWebSocketPublisher for ACK functionality
    p2pWebSocketPublisher.addEnvironment('WEBSOCKET_API_ENDPOINT', WebSocketApiStage.url.replace('wss://', 'https://'));

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
          'origin',
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
      PERMISSIONS_TABLE: userChatPermissionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
    });

    // add provisioned concurrency to reduce cold starts
    const a2pHttpPublisherVersion = a2pHttpPublisher.currentVersion;
    const a2pHttpPublisherAlias = new lambda.Alias(this, 'A2PHttpPublisherAlias', {
      aliasName: 'live',
      version: a2pHttpPublisherVersion,
      provisionedConcurrentExecutions: 1,
    });

    notificationFifoTopic.grantPublish(a2pHttpPublisher);
    notificationTopic.grantPublish(a2pHttpPublisher);
    userChatPermissionsTable.grantReadData(a2pHttpPublisher);
    
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'CognitoNotificationApiAuthorizer',
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: cdk.Duration.hours(1), // max. 1 hour caching
    });

    const a2pHttpPublishIntegration = new apigateway.LambdaIntegration(a2pHttpPublisher, {
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
              'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
              'method.response.header.Access-Control-Allow-Methods': "'GET,POST,DELETE,OPTIONS'",
            },
          },
        ],
    });

    publishResource.addMethod('POST', a2pHttpPublishIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      methodResponses: [{
        statusCode: '200',
        responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Headers': true,
          'method.response.header.Access-Control-Allow-Methods': true,
        },
      }],
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
        SEQUENCE_TABLE: sequenceTable.tableName, // Sequence generation moved to processor (after FIFO ordering)
        // Convert WebSocket URL to HTTPS URL for management API
        WS_API_ENDPOINT: WebSocketApiStage.url.replace('wss://', 'https://'),
      },
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
    });

    // add provisioned concurrency to reduce cold starts
    const processorVersion = processorLambda.currentVersion;
    const processorAlias = new lambda.Alias(this, 'ProcessorAlias', {
      aliasName: 'live',
      version: processorVersion,
      provisionedConcurrentExecutions: 1,
    });

    // SQS event source for FIFO messages (ordered, deduplicated)
    processorLambda.addEventSource(new SqsEventSource(webSocketFifoQueue, {
      batchSize: 1, // ensures strict ordering by processing one message at a time
      reportBatchItemFailures: true,
    }));

    // SQS event source for Standard messages (high-throughput, reliable)
    processorLambda.addEventSource(new SqsEventSource(webSocketStandardQueue, {
      batchSize: 10, // Process up to 10 messages per batch
      maxBatchingWindow: cdk.Duration.seconds(0), // Don't wait - process immediately for low latency!
      reportBatchItemFailures: true,
    }));

    connectionTable.grantReadWriteData(processorLambda);
    sequenceTable.grantReadWriteData(processorLambda); // Grant sequence generation access

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
    // Collects client-side END-TO-END LATENCY metrics only
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

    // Extracts latency from client-side metric submissions
    const endToEndLatencyFilter = metricCollectorLambda.logGroup.addMetricFilter('EndToEndLatencyFilter', {
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.exists('$.event_type'),
        logs.FilterPattern.stringValue('$.event_type', '=', 'end_to_end_latency'),
        logs.FilterPattern.exists('$.latency_ms')
      ),
      metricName: 'EndToEndLatency',
      metricNamespace: 'NotificationService',
      metricValue: '$.latency_ms',
      unit: cloudwatch.Unit.MILLISECONDS,
    });

    // High Latency Message Counter (messages exceeding 1 second)
    const highLatencyFilter = metricCollectorLambda.logGroup.addMetricFilter('HighLatencyFilter', {
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.exists('$.event_type'),
        logs.FilterPattern.stringValue('$.event_type', '=', 'end_to_end_latency'),
        logs.FilterPattern.numberValue('$.latency_ms', '>', 1000)
      ),
      metricName: 'HighLatencyMessageCount',
      metricNamespace: 'NotificationService',
      metricValue: '1',
      unit: cloudwatch.Unit.COUNT,
    });

    const latencyDashboard = new cloudwatch.Dashboard(this, 'LatencyDashboard', {
      dashboardName: 'NotificationService-E2E-Latency',
    });

    const e2eMetric = endToEndLatencyFilter.metric({
      period: cdk.Duration.minutes(1),
    });

    const highLatencyMetric = highLatencyFilter.metric({
      period: cdk.Duration.minutes(1),
    });

    latencyDashboard.addWidgets(
      // Widget 1: Percentiles over time (P50, P90, P95, P99)
      new cloudwatch.GraphWidget({
        title: 'End-to-End Latency - Percentiles (Publisher → Client)',
        left: [
          e2eMetric.with({ statistic: 'p50', label: 'P50 (Median)', color: '#2CA02C' }),
          e2eMetric.with({ statistic: 'p90', label: 'P90', color: '#FF7F0E' }),
          e2eMetric.with({ statistic: 'p95', label: 'P95', color: '#D62728' }),
          e2eMetric.with({ statistic: 'p99', label: 'P99', color: '#9467BD' }),
        ],
        width: 24,
        height: 6,
        leftYAxis: {
          label: 'Milliseconds',
          min: 0,
        },
        view: cloudwatch.GraphWidgetView.TIME_SERIES,
      }),

      // Widget 2: Average, Min, Max
      new cloudwatch.GraphWidget({
        title: 'End-to-End Latency - Average & Extremes',
        left: [
          e2eMetric.with({ statistic: 'Average', label: 'Average', color: '#1F77B4' }),
          e2eMetric.with({ statistic: 'Minimum', label: 'Minimum', color: '#2CA02C' }),
          e2eMetric.with({ statistic: 'Maximum', label: 'Maximum', color: '#D62728' }),
        ],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Milliseconds',
          min: 0,
        },
      }),

      // Widget 3: Message count and high latency count
      new cloudwatch.GraphWidget({
        title: 'Message Throughput & High Latency Count (>1s)',
        left: [
          e2eMetric.with({ statistic: 'SampleCount', label: 'Total Messages', color: '#1F77B4' }),
        ],
        right: [
          highLatencyMetric.with({ statistic: 'SampleCount', label: 'High Latency Messages (>1000ms)', color: '#D62728' }),
        ],
        width: 12,
        height: 6,
        leftYAxis: {
          min: 0,
          label: 'Message Count',
        },
        rightYAxis: {
          min: 0,
          label: 'High Latency Count',
        },
      }),

      // Widget 4: Single value - Current average
      new cloudwatch.SingleValueWidget({
        title: 'Current Average E2E Latency',
        metrics: [
          e2eMetric.with({ statistic: 'Average', label: 'Avg Latency' }),
        ],
        width: 6,
        height: 4,
      }),

      // Widget 5: Single value - Current P95
      new cloudwatch.SingleValueWidget({
        title: 'Current P95 Latency',
        metrics: [
          e2eMetric.with({ statistic: 'p95', label: 'P95 Latency' }),
        ],
        width: 6,
        height: 4,
      }),

      // Widget 6: Single value - Message count
      new cloudwatch.SingleValueWidget({
        title: 'Total Messages (1 min)',
        metrics: [
          e2eMetric.with({ statistic: 'SampleCount', label: 'Messages' }),
        ],
        width: 6,
        height: 4,
      }),

      // Widget 7: Single value - High latency count
      new cloudwatch.SingleValueWidget({
        title: 'High Latency Messages (1 min)',
        metrics: [
          highLatencyMetric.with({ statistic: 'Sum', label: 'High Latency' }),
        ],
        width: 6,
        height: 4,
      }),
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
