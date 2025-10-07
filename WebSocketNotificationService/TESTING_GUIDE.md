# WebSocket Notification Service - Testing Guide

## 🎯 Quick Start

Your WebSocket notification service is deployed and ready for testing!

### Deployed Endpoints

- **WebSocket API**: `wss://1gsi4bgu1k.execute-api.eu-central-1.amazonaws.com/dvl`
- **HTTP API (A2P)**: `https://6dvx3pj0w3.execute-api.eu-central-1.amazonaws.com/prod`
- **Cognito User Pool**: `eu-central-1_Fv5fjvyjH`
- **Cognito Client ID**: `1lf9sv60pmbvfbasjmu5ab7dcv`
- **Region**: `eu-central-1`

---

## 📋 Testing Methods

### Method 1: Web UI Testing Client (Recommended)

1. **Navigate to the test client**:
   ```bash
   cd WebSocketNotificationService/client/websocket-tester
   ```

2. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Open in browser**:
   ```
   http://localhost:3000
   ```

5. **Test Flow**:
   - Sign up with a new user (email + password)
   - Verify email (check your inbox)
   - Sign in
   - Connect to WebSocket
   - Send messages (P2P via WebSocket)
   - Publish notifications (A2P via HTTP)
   - Monitor received messages in real-time

---

### Method 2: Command Line Testing

#### Step 1: Create a Test User

```bash
aws cognito-idp sign-up \
  --client-id 1lf9sv60pmbvfbasjmu5ab7dcv \
  --username test@example.com \
  --password TestPassword123! \
  --profile sandbox \
  --region eu-central-1
```

#### Step 2: Confirm the User (Admin)

```bash
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id eu-central-1_Fv5fjvyjH \
  --username test@example.com \
  --profile sandbox \
  --region eu-central-1
```

#### Step 3: Get Authentication Token

```bash
aws cognito-idp initiate-auth \
  --client-id 1lf9sv60pmbvfbasjmu5ab7dcv \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME=test@example.com,PASSWORD=TestPassword123! \
  --profile sandbox \
  --region eu-central-1 \
  --query 'AuthenticationResult.IdToken' \
  --output text
```

Save the token to an environment variable:
```bash
export TOKEN="<paste-your-token-here>"
```

#### Step 4: Test A2P HTTP Publishing

```bash
curl -X POST https://6dvx3pj0w3.execute-api.eu-central-1.amazonaws.com/prod/publish \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "targetChannel": "WebSocket",
    "messageType": "standard",
    "payload": {
      "targetId": "user123",
      "targetClass": "user",
      "eventType": "notification",
      "content": "Test message from HTTP API",
      "priority": "high"
    }
  }'
```

#### Step 5: Test WebSocket Connection (Using wscat)

Install wscat if needed:
```bash
npm install -g wscat
```

Connect to WebSocket with auth token:
```bash
wscat -c "wss://1gsi4bgu1k.execute-api.eu-central-1.amazonaws.com/dvl?token=${TOKEN}&userId=user123&hubId=hub1&orgId=org1"
```

Send a P2P message via WebSocket:
```json
{
  "action": "sendMessage",
  "targetChannel": "WebSocket",
  "messageType": "standard",
  "payload": {
    "targetId": "user456",
    "targetClass": "user",
    "eventType": "chat",
    "content": "Hello from P2P WebSocket!",
    "priority": "normal"
  }
}
```

---

### Method 3: Node.js Testing Script

Create a test script `test-websocket.js`:

```javascript
const WebSocket = require('ws');
const AWS = require('aws-sdk');

// Configure AWS SDK
AWS.config.update({
  region: 'eu-central-1',
  credentials: new AWS.SharedIniFileCredentials({ profile: 'sandbox' })
});

const cognito = new AWS.CognitoIdentityServiceProvider();

async function getAuthToken(username, password) {
  const params = {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: '1lf9sv60pmbvfbasjmu5ab7dcv',
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password
    }
  };
  
  const result = await cognito.initiateAuth(params).promise();
  return result.AuthenticationResult.IdToken;
}

async function testWebSocket() {
  // Get auth token
  const token = await getAuthToken('test@example.com', 'TestPassword123!');
  console.log('✅ Got auth token');
  
  // Connect to WebSocket
  const wsUrl = `wss://1gsi4bgu1k.execute-api.eu-central-1.amazonaws.com/dvl?token=${token}&userId=testuser1&hubId=hub1&orgId=org1`;
  const ws = new WebSocket(wsUrl);
  
  ws.on('open', () => {
    console.log('✅ WebSocket connected');
    
    // Send a test message
    ws.send(JSON.stringify({
      action: 'sendMessage',
      targetChannel: 'WebSocket',
      messageType: 'standard',
      payload: {
        targetId: 'testuser1',
        targetClass: 'user',
        eventType: 'test',
        content: 'Test message from Node.js',
        timestamp: new Date().toISOString()
      }
    }));
    console.log('📤 Sent test message');
  });
  
  ws.on('message', (data) => {
    console.log('📨 Received message:', data.toString());
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket disconnected');
  });
}

testWebSocket().catch(console.error);
```

Run it:
```bash
npm install ws aws-sdk
node test-websocket.js
```

---

## 🧪 Test Scenarios

### Scenario 1: User-to-User Messaging (P2P)

1. Open two browser windows with the web client
2. Sign in as two different users
3. Connect both to WebSocket
4. Send a message from User A targeting User B's userId
5. Verify User B receives the message in real-time

### Scenario 2: Application-to-User Notification (A2P)

1. Connect a user via the web client
2. Use curl or Postman to POST to the HTTP API
3. Target the connected user's userId
4. Verify the user receives the notification

### Scenario 3: Organization Broadcast

1. Connect multiple users with the same `orgId`
2. Send a message with `targetClass: "org"` and `targetId: "<orgId>"`
3. Verify all users in that organization receive the message

### Scenario 4: FIFO vs Standard Messages

**FIFO (Ordered)**:
```bash
curl -X POST https://6dvx3pj0w3.execute-api.eu-central-1.amazonaws.com/prod/publish \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "targetChannel": "WebSocket",
    "messageType": "fifo",
    "payload": {
      "targetId": "user123",
      "targetClass": "user",
      "eventType": "order_update",
      "content": "Order processed",
      "sequenceNumber": 1
    }
  }'
```

**Standard (Low Latency)**:
```bash
curl -X POST https://6dvx3pj0w3.execute-api.eu-central-1.amazonaws.com/prod/publish \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "targetChannel": "WebSocket",
    "messageType": "standard",
    "payload": {
      "targetId": "user123",
      "targetClass": "user",
      "eventType": "alert",
      "content": "High priority alert!"
    }
  }'
```

---

## 📊 Monitoring & Debugging

### CloudWatch Dashboard

View real-time metrics:
```bash
aws cloudwatch get-dashboard \
  --dashboard-name WebSocketNotificationService-Latency \
  --profile sandbox \
  --region eu-central-1
```

### Check Logs

**Connection Handler Logs**:
```bash
aws logs tail /aws/lambda/NotificationServiceStack-ConnectionHandler --follow --profile sandbox --region eu-central-1
```

**Processor Logs**:
```bash
aws logs tail /aws/lambda/NotificationServiceStack-ProcessorLambda --follow --profile sandbox --region eu-central-1
```

**P2P Publisher Logs**:
```bash
aws logs tail /aws/lambda/NotificationServiceStack-P2PWebSocketPublisher --follow --profile sandbox --region eu-central-1
```

### Check DynamoDB Connections

```bash
aws dynamodb scan \
  --table-name NotificationServiceStack-ConnectionTable \
  --profile sandbox \
  --region eu-central-1 \
  --max-items 10
```

### Check SQS Queue Status

```bash
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name NotificationServiceStack-WebSocketStandardQueue --profile sandbox --region eu-central-1 --query 'QueueUrl' --output text) \
  --attribute-names All \
  --profile sandbox \
  --region eu-central-1
```

---

## 🔍 Troubleshooting

### Issue: WebSocket Connection Fails

**Check**:
1. Token is valid and not expired
2. Query parameters include: `token`, `userId`, `hubId`, `orgId`
3. Token is from the correct user pool

**Debug**:
```bash
# Check authorizer logs
aws logs tail /aws/lambda/NotificationServiceStack-WebSocketAuthorizerFunction --follow --profile sandbox --region eu-central-1
```

### Issue: Messages Not Received

**Check**:
1. Target user is connected (check DynamoDB)
2. `targetClass` and `targetId` match connection metadata
3. Message has `targetChannel: "WebSocket"`

**Debug**:
```bash
# Check processor logs for delivery attempts
aws logs tail /aws/lambda/NotificationServiceStack-ProcessorLambda --follow --profile sandbox --region eu-central-1
```

### Issue: High Latency

**Check CloudWatch Metrics**:
```bash
aws cloudwatch get-metric-statistics \
  --namespace NotificationService \
  --metric-name MessageLatency \
  --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum \
  --profile sandbox \
  --region eu-central-1
```

---

## 🎨 Advanced Testing

### Load Testing with Artillery

Create `load-test.yml`:
```yaml
config:
  target: "wss://1gsi4bgu1k.execute-api.eu-central-1.amazonaws.com"
  phases:
    - duration: 60
      arrivalRate: 10
  engines:
    ws:
      query: "token={{ $processEnvironment.TOKEN }}&userId=user{{ $randomNumber(1, 100) }}&hubId=hub1&orgId=org1"

scenarios:
  - name: "WebSocket Connection Test"
    engine: ws
    flow:
      - send:
          payload:
            action: "sendMessage"
            targetChannel: "WebSocket"
            messageType: "standard"
            payload:
              targetId: "broadcast"
              targetClass: "hub"
              eventType: "test"
              content: "Load test message"
```

Run:
```bash
npm install -g artillery
export TOKEN="<your-token>"
artillery run load-test.yml
```

---

## 📚 Message Format Reference

### Standard Message Structure

```json
{
  "messageId": "uuid-v4",
  "timestamp": "2025-10-07T14:30:00Z",
  "targetChannel": "WebSocket",
  "payload": {
    "targetId": "user123",
    "targetClass": "user|org|hub|project",
    "eventType": "notification|chat|alert|update",
    "content": "Message content",
    "priority": "low|normal|high",
    "metadata": {
      "custom": "fields"
    }
  }
}
```

### Target Classes

- `user`: Individual user targeting
- `org`: Organization-wide broadcast
- `hub`: Hub-wide broadcast
- `project`: Project-specific messages

---

## ✅ Success Indicators

- ✅ User can sign up and sign in
- ✅ WebSocket connection establishes successfully
- ✅ Messages sent via P2P appear in connected clients
- ✅ Messages sent via A2P HTTP API are delivered
- ✅ CloudWatch shows low latency (<500ms p95)
- ✅ No messages in DLQ
- ✅ Connection count in DynamoDB updates correctly

Happy testing! 🚀
