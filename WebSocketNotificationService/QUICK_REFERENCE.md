# Quick Reference: P2P vs A2P

## 🚀 When to Use What?

### Use P2P (WebSocket) 🔗
```
✅ User-to-user chat
✅ Already have WebSocket connection  
✅ Need lowest latency
✅ Interactive real-time features
```

### Use A2P (HTTP REST) 🌐
```
✅ Backend service integration
✅ Scheduled notifications
✅ No WebSocket connection
✅ Batch operations
```

---

## 📨 Message Examples

### P2P via WebSocket
```javascript
// Send via existing WebSocket connection
ws.send(JSON.stringify({
  action: 'sendMessage',
  targetChannel: 'WebSocket',
  messageType: 'standard',      // or 'fifo'
  payload: {
    targetId: 'user-456',
    targetClass: 'user',         // or 'org', 'hub', 'project'
    eventType: 'chat',
    content: 'Hello!'
  }
}));
```

### A2P via HTTP
```bash
curl -X POST https://api.example.com/dvl/publish \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "targetChannel": "WebSocket",
    "messageType": "fifo",
    "payload": {
      "targetId": "user-123",
      "targetClass": "user",
      "eventType": "notification",
      "content": "Alert!"
    }
  }'
```

---

## 🏗️ Stack Resources

| Resource | P2P | A2P |
|----------|-----|-----|
| **Lambda** | `p2pWebSocketPublisher` | `a2pHttpPublisher` |
| **Route** | WebSocket `$default` | `POST /publish` |
| **Auth** | WebSocket authorizer | Cognito JWT |
| **Latency** | ~100-300ms | ~200-500ms |

---

## 📦 Shared Infrastructure

Both use the same:
- ✅ SNS Topics (FIFO + Standard)
- ✅ SQS Queues 
- ✅ Processor Lambda
- ✅ DynamoDB connection table
- ✅ CloudWatch monitoring

---

## 🎯 Message Types

### Standard (Default)
- High throughput
- Lower latency (~100-300ms)
- No ordering guarantees
- Use for: notifications, alerts

### FIFO
- Ordered delivery
- Higher latency (~300-500ms)  
- Content deduplication
- Use for: chat, sequences

---

## 🔐 Authentication

### P2P
```javascript
// Token in connection URL
wss://api.example.com/dvl?token=${JWT}&userId=${ID}&...
// User ID auto-extracted from context
```

### A2P  
```javascript
// Token per request
Authorization: Bearer ${JWT}
// User ID from token claims
```

---

## 📊 Response Format

### Success
```json
{
  "message": "Message sent successfully!",
  "messageId": "abc-123",
  "messageType": "fifo",
  "targetChannel": "WebSocket"
}
```

### Error
```json
{
  "error": "Error description",
  "details": "Additional context"
}
```

---

## 🛠️ Common Patterns

### P2P Chat Message
```javascript
ws.send(JSON.stringify({
  action: 'sendMessage',
  targetChannel: 'WebSocket',
  messageType: 'fifo',
  messageGroupId: 'chat-room-123',
  payload: {
    targetId: 'user-456',
    targetClass: 'user',
    eventType: 'chat',
    content: 'Hello!'
  }
}));
```

### A2P System Alert
```javascript
await fetch('/api/publish', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    targetChannel: 'WebSocket',
    messageType: 'standard',
    payload: {
      targetId: 'org-789',
      targetClass: 'org',
      eventType: 'alert',
      content: 'System maintenance in 1 hour'
    }
  })
});
```

---

## 📈 Monitoring

**CloudWatch Dashboard**: `WebSocketNotificationService-Latency`

**Key Metrics**:
- Message latency (p50, p95, p99)
- Error rates
- High latency messages (>3s)
- Throughput

---

## 🔗 Documentation Links

- [P2P Usage Guide](websocket-message-publisher/USAGE.md)
- [A2P Usage Guide](publisher/USAGE.md)  
- [Architecture Overview](ARCHITECTURE_OVERVIEW.md)
- [Stack Improvements](STACK_NAMING_IMPROVEMENTS.md)
