# P2P WebSocket Message Publisher - Usage Guide

## Overview
The P2P (Person-to-Person) WebSocket Publisher enables authenticated users to send messages directly through their WebSocket connection to the notification service. This approach offers **lower latency** compared to HTTP REST API because it eliminates HTTP framing overhead and reuses the persistent WebSocket connection.

## Architecture Flow
```
WebSocket Client → $default route → P2P WebSocket Publisher Lambda → SNS Topic (FIFO/Standard) → SQS Queue → Processor Lambda → Target WebSocket Connections
```

## Key Benefits
- **Lower Latency**: No HTTP request/response overhead, uses persistent WebSocket connection
- **Real-time**: Messages flow through existing authenticated connection
- **Bidirectional**: Same connection used for both sending and receiving
- **Authenticated**: User identity automatically extracted from WebSocket authorizer context

## Message Format

### WebSocket Message Structure
```json
{
  "action": "sendMessage",
  "targetChannel": "WebSocket",
  "messageType": "fifo",
  "messageGroupId": "optional-group-id",
  "payload": {
    "targetId": "user-123",
    "targetClass": "user",
    "eventType": "notification",
    "content": "Your message content here"
  }
}
```

### Parameters

#### Required
- **`targetChannel`** (string): Delivery channel - `"WebSocket"`, `"Email"`, `"SMS"`, etc.
- **`payload`** (object): Message payload containing:
  - **`targetId`** (string): ID of the target recipient
  - **`targetClass`** (string): Target type - `"user"`, `"org"`, `"hub"`, or `"project"`
  - **`eventType`** (string): Event type (e.g., `"notification"`, `"message"`, `"alert"`)
  - **`content`** (string): Message content

#### Optional
- **`messageType`** (string): `"fifo"` for ordered delivery or `"standard"` for high-throughput (default: `"standard"`)
- **`messageGroupId`** (string): FIFO grouping key (only for FIFO messages, defaults to authenticated userId)

## Usage Examples

### JavaScript/TypeScript Client

#### Basic Message (Standard Topic - High Throughput)
```javascript
const ws = new WebSocket(`wss://your-api.execute-api.region.amazonaws.com/dvl?token=${cognitoToken}&userId=${userId}&hubId=${hubId}&orgId=${orgId}`);

ws.onopen = () => {
  ws.send(JSON.stringify({
    action: "sendMessage",
    targetChannel: "WebSocket",
    messageType: "standard", // Optional, this is the default
    payload: {
      targetId: "user-456",
      targetClass: "user",
      eventType: "notification",
      content: "Hello from P2P WebSocket!"
    }
  }));
};

ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log('Response:', response);
  // { message: "Message sent successfully via WebSocket!", messageId: "..." }
};
```

#### Ordered Message (FIFO Topic - Guaranteed Order)
```javascript
ws.send(JSON.stringify({
  action: "sendMessage",
  targetChannel: "WebSocket",
  messageType: "fifo",
  messageGroupId: "chat-room-789", // Optional: groups messages for ordering
  payload: {
    targetId: "user-456",
    targetClass: "user",
    eventType: "chat",
    content: "This message will be delivered in order"
  }
}));
```

#### Organization Broadcast
```javascript
ws.send(JSON.stringify({
  action: "sendMessage",
  targetChannel: "WebSocket",
  messageType: "standard",
  payload: {
    targetId: "org-123",
    targetClass: "org",
    eventType: "announcement",
    content: "Important organization update"
  }
}));
```

### React Hook Example
```typescript
import { useEffect, useRef } from 'react';

export function useWebSocketPublisher(wsUrl: string, token: string, userId: string, hubId: string, orgId: string) {
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    ws.current = new WebSocket(`${wsUrl}?token=${token}&userId=${userId}&hubId=${hubId}&orgId=${orgId}`);
    
    ws.current.onopen = () => console.log('WebSocket connected');
    ws.current.onerror = (error) => console.error('WebSocket error:', error);
    
    return () => ws.current?.close();
  }, [wsUrl, token, userId, hubId, orgId]);

  const sendMessage = (message: {
    targetChannel: string;
    messageType?: 'fifo' | 'standard';
    messageGroupId?: string;
    payload: {
      targetId: string;
      targetClass: 'user' | 'org' | 'hub' | 'project';
      eventType: string;
      content: string;
    };
  }) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        action: 'sendMessage',
        ...message
      }));
    } else {
      console.error('WebSocket not connected');
    }
  };

  return { sendMessage };
}
```

## Response Format

### Success Response
```json
{
  "message": "Message sent successfully via WebSocket!",
  "messageId": "abc123-def456-ghi789",
  "messageType": "fifo",
  "targetChannel": "WebSocket",
  "messageGroupId": "chat-room-789"
}
```

### Error Responses

#### Unauthorized (401)
```json
{
  "error": "Unauthorized - No user ID in context"
}
```

#### Invalid Request (400)
```json
{
  "error": "Missing required parameters: targetChannel and payload are required"
}
```

#### Invalid Message Type (400)
```json
{
  "error": "Invalid messageType. Must be \"fifo\" or \"standard\""
}
```

#### Server Error (500)
```json
{
  "error": "Failed to send message via WebSocket",
  "details": "Error details here"
}
```

## Message Type Selection

### Standard Topic (Default)
- **Use Case**: High-throughput, best-effort delivery
- **Latency**: Lower latency (~100-300ms)
- **Ordering**: No guarantees
- **Deduplication**: None
- **Example**: Real-time notifications, status updates

### FIFO Topic
- **Use Case**: Ordered, exactly-once delivery
- **Latency**: Higher latency (~300-500ms)
- **Ordering**: Strict ordering within `MessageGroupId`
- **Deduplication**: Content-based deduplication enabled
- **Example**: Chat messages, transaction sequences

## Authentication Flow

1. User authenticates with Cognito and receives JWT token
2. WebSocket connection established with token as query parameter
3. WebSocket Authorizer validates token and extracts user identity
4. User ID stored in connection context for all subsequent messages
5. P2P Publisher automatically uses authenticated user ID from context

## Comparison: P2P vs A2P

| Feature | P2P (WebSocket) | A2P (HTTP REST) |
|---------|-----------------|-----------------|
| **Latency** | Lower (~50-200ms saved) | Higher (HTTP overhead) |
| **Connection** | Persistent | Per-request |
| **Auth** | Token in connection | Token per request |
| **Use Case** | Real-time P2P messaging | Backend service integration |
| **Framing** | WebSocket frames only | HTTP + WebSocket frames |

## Error Handling

The P2P publisher implements comprehensive error handling:

1. **Authentication Errors**: Returns 401 if no user ID in context
2. **Validation Errors**: Returns 400 for missing/invalid parameters
3. **Publishing Errors**: Returns 500 with detailed error message
4. **Automatic Retry**: SQS handles retries (3 attempts) before DLQ

## Monitoring

Monitor P2P message flow through:
- **CloudWatch Logs**: Lambda execution logs with structured JSON
- **CloudWatch Metrics**: 
  - Message latency (p50, p95, p99)
  - Error rates
  - High latency messages (>3s)
- **Dashboard**: `WebSocketNotificationService-Latency`

## Best Practices

1. **Message Type Selection**: Use `standard` for notifications, `fifo` for ordered sequences
2. **Error Handling**: Always implement `onerror` and `onclose` handlers
3. **Reconnection**: Implement exponential backoff for reconnection attempts
4. **Message Grouping**: Use meaningful `messageGroupId` for FIFO messages
5. **Payload Size**: Keep messages under 256KB (SNS limit)
6. **Connection Pooling**: Reuse WebSocket connections when possible

## Troubleshooting

### Issue: "Unauthorized - No user ID in context"
- **Cause**: Token not validated or authorizer not passing context
- **Solution**: Verify token is valid and query parameters include all required fields

### Issue: Messages not delivered
- **Cause**: Invalid `targetId` or `targetClass`
- **Solution**: Verify target exists and connection is active in DynamoDB

### Issue: High latency
- **Cause**: FIFO topic or processor overload
- **Solution**: Use standard topic for non-ordered messages, check dashboard metrics

### Issue: Duplicate messages
- **Cause**: Client retries or network issues
- **Solution**: Use FIFO topic with content-based deduplication
