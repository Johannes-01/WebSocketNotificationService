# WebSocket Message Acknowledgment (ACK) Feature

## Overview
The WebSocket message publisher now supports optional acknowledgment messages, allowing clients to wait for confirmation that their message was successfully published to SNS.

## How It Works

### 1. Client Sends Message with ACK Request
Include `requestAck: true` and a unique `ackId` in your message:

```javascript
const ackId = `ack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

ws.send(JSON.stringify({
    action: 'sendMessage',
    targetChannel: 'WebSocket',
    messageType: 'fifo',
    requestAck: true,      // Request acknowledgment
    ackId: ackId,          // Unique ID to correlate the ACK response
    payload: {
        chatId: 'chat-123',
        eventType: 'chat',
        content: 'Hello World!'
    }
}));
```

### 2. Server Publishes to SNS and Sends ACK
After successfully publishing to SNS, the server sends an ACK message back to the client via WebSocket:

```javascript
{
    "type": "ack",
    "ackId": "ack-1729700000-abc123",
    "status": "success",
    "messageId": "sns-message-id-12345",
    "messageType": "fifo",
    "timestamp": "2025-10-23T14:30:00.000Z",
    "snsMessageId": "sns-message-id-12345",
    "sequenceNumber": "12345678901234567890"  // Only for FIFO messages
}
```

### 3. Client Handles ACK Response
Listen for ACK messages and match them to pending requests:

```javascript
const pendingAcks = new Map();

// When sending a message
function sendMessageWithAck(message) {
    const ackId = `ack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
        // Store the promise resolver
        pendingAcks.set(ackId, { resolve, reject, timestamp: Date.now() });
        
        // Set timeout (e.g., 5 seconds)
        setTimeout(() => {
            if (pendingAcks.has(ackId)) {
                pendingAcks.delete(ackId);
                reject(new Error('ACK timeout'));
            }
        }, 5000);
        
        // Send the message
        ws.send(JSON.stringify({
            action: 'sendMessage',
            targetChannel: 'WebSocket',
            messageType: 'fifo',
            requestAck: true,
            ackId: ackId,
            payload: message
        }));
    });
}

// When receiving messages
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    
    if (data.type === 'ack') {
        const pending = pendingAcks.get(data.ackId);
        if (pending) {
            pendingAcks.delete(data.ackId);
            pending.resolve(data);
        }
    } else {
        // Handle normal messages
        handleMessage(data);
    }
};

// Usage example
try {
    const ack = await sendMessageWithAck({
        chatId: 'chat-123',
        eventType: 'chat',
        content: 'Hello!'
    });
    console.log('Message confirmed:', ack.messageId);
} catch (error) {
    console.error('Message failed:', error);
}
```

## Message Format

### Request Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `requestAck` | boolean | No (default: false) | Request acknowledgment for this message |
| `ackId` | string | Required if `requestAck=true` | Unique identifier to correlate the ACK response |

### ACK Response Format
| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always "ack" |
| `ackId` | string | The client-provided ackId from the request |
| `status` | string | "success" (errors result in no ACK) |
| `messageId` | string | SNS message ID |
| `messageType` | string | "fifo" or "standard" |
| `timestamp` | string | ISO 8601 timestamp when ACK was sent |
| `snsMessageId` | string | Same as messageId (for clarity) |
| `sequenceNumber` | string/null | FIFO sequence number (null for standard) |

## Error Handling

### No ACK Received
If the ACK is not received, possible reasons:
1. **Message publishing failed**: Check CloudWatch logs for errors
2. **WebSocket connection dropped**: Client should reconnect
3. **ACK delivery failed**: Message was published but ACK couldn't be sent (check logs)

Note: If ACK sending fails, the message is still published successfully. The ACK failure is logged but doesn't affect the message delivery.

### ACK Timeout
Implement client-side timeouts (recommended 5-10 seconds) to detect lost ACKs:

```javascript
const ACK_TIMEOUT = 5000; // 5 seconds

setTimeout(() => {
    if (pendingAcks.has(ackId)) {
        pendingAcks.delete(ackId);
        reject(new Error('ACK timeout - message may still be delivered'));
    }
}, ACK_TIMEOUT);
```

## Best Practices

1. **Generate Unique ACK IDs**: Use timestamps + random strings to ensure uniqueness
   ```javascript
   const ackId = `ack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
   ```

2. **Implement Timeouts**: Always set a timeout for ACK responses (5-10 seconds recommended)

3. **Clean Up**: Remove pending ACK handlers on timeout or success to prevent memory leaks

4. **Handle Duplicates**: If you retry on timeout, the original message may already be published

5. **Optional Usage**: Only request ACKs when needed (e.g., critical messages) to reduce overhead

6. **Log ACK Metrics**: Track ACK latency and success rates for monitoring

## Performance Considerations

- **Overhead**: Each ACK requires an additional API Gateway Management API call
- **Latency**: ACK delivery adds ~10-50ms to response time
- **Cost**: PostToConnection API calls are billed separately
- **Use Cases**: Best for critical messages where confirmation is important

## When to Use ACKs

✅ **Good Use Cases**:
- Critical transactional messages
- User-initiated actions requiring confirmation
- Messages where client-side retry logic is needed
- Debugging and testing

❌ **Avoid for**:
- High-frequency bulk messages
- Non-critical notifications
- Messages where eventual delivery is acceptable

## Comparison with Standard Response

### Without ACK (Default)
- Client sends message → receives Lambda response via API Gateway
- Fast but no WebSocket-level confirmation
- Good for fire-and-forget messages

### With ACK
- Client sends message → receives both:
  1. Lambda response via API Gateway (HTTP-like response)
  2. ACK message via WebSocket (asynchronous confirmation)
- Provides WebSocket-native confirmation
- Useful for tracking in message streams

## Example Implementation

See `/client/websocket-tester/` for a complete implementation example with ACK support.

## Debugging

Enable debug logging in the Lambda function to track ACK delivery:
```javascript
console.log('ACK sent successfully:', {
    connectionId,
    ackId,
    messageId: result.MessageId,
});
```

Check CloudWatch logs for:
- `ACK sent successfully` - ACK was delivered
- `Failed to send ACK to client` - ACK delivery failed (message still published)
