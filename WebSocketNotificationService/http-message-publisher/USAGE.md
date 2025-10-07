# SNS Publisher - Usage Guide

## Overview
The HTTP Publisher Lambda allows you to publish messages to either FIFO or Standard SNS topics with configurable target channels.

## Request Format

### Endpoint
```
POST /publish
Authorization: Bearer <cognito-token>
```

### Request Body

```json
{
  "targetChannel": "WebSocket",
  "messageType": "fifo",
  "messageGroupId": "chat-room-456",
  "payload": {
    "targetId": "user123",
    "targetClass": "user",
    "eventType": "notification",
    "content": "Your notification message"
  }
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `targetChannel` | string | **Yes** | - | Destination channel: `WebSocket`, `Email`, `SMS`, etc. |
| `messageType` | string | No | `standard` | Topic type: `fifo` or `standard` |
| `messageGroupId` | string | No | `{userId}` | FIFO grouping ID - only used for FIFO messages. Defaults to authenticated user ID |
| `payload` | object | **Yes** | - | Message payload to be delivered |

### Payload Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetId` | string | **Yes** | ID of the target (user ID, org ID, hub ID, project ID) |
| `targetClass` | string | **Yes** | Type of target: `user`, `org`, `hub`, or `project` |
| `eventType` | string | **Yes** | Event type identifier |
| `content` | any | **Yes** | The actual message content |

## Message Types

### FIFO Messages (`messageType: "fifo"`)
**Use when:**
- Message order matters
- Duplicate messages should be prevented
- Processing guarantees are required

**Characteristics:**
- ✅ Guaranteed ordering within message group
- ✅ Automatic deduplication
- ✅ Reliable delivery via SQS
- ⚠️ Slightly higher latency (~70-150ms)
- ⚠️ Lower throughput (3,000 msg/sec max)

**Example:**
```json
{
  "targetChannel": "WebSocket",
  "messageType": "fifo",
  "messageGroupId": "chat-room-456",
  "payload": {
    "targetId": "room456",
    "targetClass": "hub",
    "eventType": "chat_message",
    "content": "Hello, this is message #5",
    "sequenceNumber": 5
  }
}
```

### Standard Messages (`messageType: "standard"`)
**Use when:**
- High throughput is needed
- Order doesn't matter
- Occasional duplicates are acceptable

**Characteristics:**
- ✅ Very high throughput
- ✅ Low latency (~50-120ms)
- ✅ Reliable delivery via SQS
- ⚠️ No ordering guarantee
- ⚠️ Possible duplicates (rare)

**Example:**
```json
{
  "targetChannel": "WebSocket",
  "messageType": "standard",
  "payload": {
    "targetId": "user123",
    "targetClass": "user",
    "eventType": "notification",
    "content": "You have a new follower!"
  }
}
```

## Target Channels

### Currently Supported
- **WebSocket** - Real-time browser notifications via WebSocket connections

### Future Channels
- **Email** - Email notifications
- **SMS** - Text message notifications
- **Push** - Mobile push notifications

Each channel will have its own filtered SQS queues and processor lambdas.

## Examples

### Example 1: Real-time WebSocket Notification (Standard)
```bash
curl -X POST https://api.example.com/publish \
  -H "Authorization: Bearer ${COGNITO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "targetChannel": "WebSocket",
    "messageType": "standard",
    "payload": {
      "targetId": "user123",
      "targetClass": "user",
      "eventType": "notification",
      "content": "Your order has been shipped!"
    }
  }'
```

### Example 2: Ordered Chat Messages (FIFO)
```bash
curl -X POST https://api.example.com/publish \
  -H "Authorization: Bearer ${COGNITO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "targetChannel": "WebSocket",
    "messageType": "fifo",
    "messageGroupId": "chat-room-456",
    "payload": {
      "targetId": "room456",
      "targetClass": "hub",
      "eventType": "chat_message",
      "content": "Hello everyone!",
      "sender": "Alice",
      "timestamp": "2025-10-07T10:30:00Z"
    }
  }'
```

### Example 3: Future Email Channel
```bash
curl -X POST https://api.example.com/publish \
  -H "Authorization: Bearer ${COGNITO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "targetChannel": "Email",
    "messageType": "standard",
    "payload": {
      "targetId": "user123",
      "targetClass": "user",
      "eventType": "welcome_email",
      "content": {
        "subject": "Welcome to our platform!",
        "body": "Thank you for signing up..."
      }
    }
  }'
```

## Response Format

### Success Response (200 OK)
```json
{
  "message": "Message sent successfully!",
  "messageId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "messageType": "fifo",
  "targetChannel": "WebSocket",
  "messageGroupId": "chat-room-456"
}
```

**Note:** `messageGroupId` is only included in the response for FIFO messages.

### Error Responses

**400 Bad Request - Missing Parameters**
```json
{
  "error": "Missing required parameters: targetChannel and payload are required."
}
```

**400 Bad Request - Invalid Message Type**
```json
{
  "error": "Invalid messageType. Must be \"fifo\" or \"standard\"."
}
```

**500 Internal Server Error**
```json
{
  "error": "Failed to send message",
  "details": "Error message details"
}
```

## Architecture Flow

### FIFO Path
```
HTTP Request → Publisher Lambda → SNS FIFO Topic 
  → [Filter: targetChannel] → WebSocketFifoQueue 
  → Processor Lambda → WebSocket API
```

### Standard Path
```
HTTP Request → Publisher Lambda → SNS Standard Topic 
  → [Filter: targetChannel] → WebSocketStandardQueue 
  → Processor Lambda → WebSocket API
```

## Best Practices

1. **Use FIFO for:**
   - Chat messages
   - Transaction updates
   - Sequential notifications
   - Data consistency requirements

2. **Use Standard for:**
   - General notifications
   - Broadcast messages
   - Non-critical updates
   - High-volume events

3. **Always include:**
   - Meaningful `eventType` for message routing
   - Proper `targetClass` for connection lookup
   - Valid `targetId` for the recipient

4. **Message Grouping Strategy (FIFO only):**
   
   The `messageGroupId` determines which messages are ordered together. Choose your grouping strategy based on your use case:

   ### Grouping Patterns

   **Chat Room Messages** (Recommended)
   ```json
   {
     "messageType": "fifo",
     "messageGroupId": "chat-room-{roomId}",
     "payload": { ... }
   }
   ```
   - ✅ Messages within the same room are ordered
   - ✅ Different rooms process in parallel
   - ✅ Best performance for multi-room chats

   **Transaction/Order Updates** (Recommended)
   ```json
   {
     "messageType": "fifo",
     "messageGroupId": "order-{orderId}",
     "payload": { ... }
   }
   ```
   - ✅ Updates for same order are ordered
   - ✅ Different orders process in parallel
   - ✅ Prevents race conditions

   **User-Specific Notifications** (Auto-Default)
   ```json
   {
     "messageType": "fifo",
     // messageGroupId omitted - defaults to userId
     "payload": { ... }
   }
   ```
   - ✅ All messages to same user are ordered
   - ⚠️ May create bottleneck if user has many unrelated messages
   - ⚠️ Use only when all user messages need ordering

   **Document Collaboration**
   ```json
   {
     "messageType": "fifo",
     "messageGroupId": "document-{docId}",
     "payload": { ... }
   }
   ```
   - ✅ Changes to same document are ordered
   - ✅ Different documents process in parallel

   ### Anti-Patterns ❌

   **Don't use same groupId for unrelated messages:**
   ```json
   // BAD: All messages ordered sequentially (performance bottleneck)
   { "messageGroupId": "global" }
   ```

   **Don't use random groupIds:**
   ```json
   // BAD: No ordering guarantee at all
   { "messageGroupId": Math.random().toString() }
   ```

   ### Performance Impact

   | Grouping Strategy | Parallelization | Ordering Scope | Performance |
   |-------------------|----------------|----------------|-------------|
   | Per Room/Resource | ✅ High | Within resource | ⚡ Excellent |
   | Per User (default) | ⚠️ Medium | All user messages | 👍 Good |
   | Global groupId | ❌ None | All messages | 🐌 Poor |

5. **Choosing Between FIFO and Standard:**

   Ask yourself:
   - **Does message order matter?** → Use FIFO with specific `messageGroupId`
   - **Can duplicates be tolerated?** → Use Standard for better performance
   - **Is it a chat/transaction?** → Use FIFO with resource-specific groupId
   - **Is it a notification?** → Use Standard unless order matters
