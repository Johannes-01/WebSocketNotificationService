# AI Agent Instructions for WebSocket Notification Service

## Project Overview
This is a WebSocket-based notification service built on AWS, designed for real-time message broadcasting. The system uses AWS API Gateway WebSocket APIs, SNS for pub/sub messaging, and DynamoDB for connection management.

## Key Architecture Components

### Service Flow
1. **WebSocket Connections**: 
   - Authenticated via Cognito tokens in query parameters
   - Connection IDs stored in DynamoDB with user metadata
   - See `connection-handler/index.js` for connection lifecycle management

2. **Message Publishing**:
   - Two SNS topics: FIFO (ordered) and Standard (high throughput)
   - FIFO Messages flow: SNS → SQS → Processor → WebSocket API
    - Standard Messages flow: SNS → Processor → WebSocket API
   - Standard message format in `processor/index.js`:
   ```javascript
   {
     "messageId": "123456",
     "timestamp": "2025-10-03T14:00:00Z",
     "targetChannel": "WebSocket",
     "payload": {
       "targetId": "abc123xyz",
       "targetClass": "user", // user, org, hub
       "eventType": "notification",
       "content": "Message content",
       "priority": "high"
     }
   }
   ```

3. **Connection Management**:
   - DynamoDB table with GSIs for user/org/hub lookups
   - Stale connections auto-cleaned on 410 Gone responses
   - See `WebSocketNotificationServiceStack.ts` for table structure

## Development Workflows

### Local Development
1. Install dependencies in each component directory:
   ```bash
   cd WebSocketNotificationService/cdk && npm install
   cd ../client && npm install
   # Repeat for other component directories
   ```

2. Deploy infrastructure:
   ```bash
   cd WebSocketNotificationService/cdk
   npm run build
   npx cdk deploy
   ```

3. Start client for testing:
   ```bash
   cd WebSocketNotificationService/client
   npm run dev
   ```

### Monitoring & Debugging
- CloudWatch dashboard at "WebSocketNotificationService-Latency"
- Key metrics:
  - Message latency (p50, p95, p99)
  - High latency messages (>3s)
  - Error rates
- Alarm thresholds defined in `WebSocketNotificationServiceStack.ts`

## Project Conventions

### Message Targeting
- Messages must specify `targetClass` ("user", "org", or "hub")
- DynamoDB GSIs automatically route messages to correct connections
- Connection table schema:
  - Primary key: connectionId
  - GSIs: UserIndex, OrgIndex, HubIndex

### Error Handling
- Dead Letter Queue (DLQ) for failed notifications
- SQS partial batch failures supported
- Processor retries: 3 attempts before DLQ
- Automatic stale connection cleanup

## Integration Points

### Authentication
- Cognito User Pool for REST API auth
- WebSocket connections authenticated via token query parameter
- JWT validation in `websocket-authorizer/index.js`

## Integration Examples

### Rest API Publish Example
```bash
curl -X POST https://api.example.com/dvl/publish \

```

### WebSocket API Publish Example
```bash
wscat -c "wss://api.example.com/dvl
```

### Client SDK Usage
```javascript
// Example WebSocket connection with auth
const ws = new WebSocket(`wss://api.example.com/dvl?token=${cognitoToken}`);

// Example message publish via REST API
await fetch('/api/publish', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${cognitoToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    targetId: 'user123',
    targetClass: 'user',
    content: 'New notification'
  })
});
```

### Sending Messages via WebSocket default route
```javascriptws.send(JSON.stringify({
  action: 'sendMessage',
  data: {
    targetId: 'user123',
    targetClass: 'user',
    content: 'Hello via WebSocket!'
  }
}));
```

## Performance Considerations
- Use FIFO topics for ordered delivery (higher latency)
- Use Standard topics for best-effort delivery (lower latency)
- Connection table designed for high-throughput lookups
- Processor lambda configured with reserved concurrency of 10