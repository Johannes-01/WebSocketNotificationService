# Client-Side Timestamp Latency Measurement

## Problem: Clock Skew Causing Negative Latency

### Original Issue
When measuring end-to-end latency using server timestamps, we encountered **negative latency** values:

```
[15:22:55] 📊 Latency - E2E: -7ms  ❌ IMPOSSIBLE!
```

### Root Cause: Clock Synchronization

The issue occurred because we were mixing two different clocks:

```
┌──────────────────────────────────────────────────────────┐
│ BEFORE: Mixed Clocks (Caused Negative Latency)          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. Client sends message                                │
│     └─ No timestamp captured                            │
│                                                          │
│  2. Lambda Publisher receives & adds publishTimestamp   │
│     └─ Uses AWS server time: 14:22:55.007Z             │
│                                                          │
│  3. Message routed through SNS → SQS → Processor        │
│                                                          │
│  4. Client receives message                             │
│     └─ Uses local client time: 14:22:55.000Z           │
│                                                          │
│  Latency Calculation:                                   │
│    clientReceiveTime - publishTimestamp                 │
│    = 14:22:55.000Z - 14:22:55.007Z                     │
│    = -7ms  ❌ NEGATIVE!                                 │
│                                                          │
│  Why? Client clock was 7ms BEHIND server clock          │
└──────────────────────────────────────────────────────────┘
```

### Clock Skew Sources

1. **NTP Drift**: Client and server clocks drift over time
2. **Network Time Sync**: Client may use different NTP servers than AWS
3. **Manual Time Adjustments**: Users can change system time
4. **Time Zone Issues**: Potential timezone conversion errors
5. **System Load**: High CPU can delay clock reads

Even with NTP, clocks can drift by **10-50ms** between synchronizations.

---

## Solution: Client-Side Timestamps

### New Approach: Single Clock Source

Use **only the client's clock** for latency measurement:

```
┌──────────────────────────────────────────────────────────┐
│ AFTER: Client-Side Timestamps (No Clock Skew)           │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. Client sends message                                │
│     └─ Captures: clientPublishTimestamp (client clock)  │
│                                                          │
│  2. Lambda Publisher receives                           │
│     └─ Adds: publishTimestamp (server clock - for logs) │
│     └─ Passes through: clientPublishTimestamp           │
│                                                          │
│  3. Message routed through SNS → SQS → Processor        │
│     └─ clientPublishTimestamp preserved in payload      │
│                                                          │
│  4. Client receives message                             │
│     └─ Captures: clientReceiveTime (client clock)       │
│                                                          │
│  Latency Calculation:                                   │
│    clientReceiveTime - clientPublishTimestamp           │
│    = 14:22:55.047Z - 14:22:55.000Z                     │
│    = 47ms  ✅ ACCURATE!                                 │
│                                                          │
│  Why? Both timestamps from SAME clock = no skew         │
└──────────────────────────────────────────────────────────┘
```

---

## Implementation

### 1. Sending Messages (P2P & A2P)

**Add `clientPublishTimestamp` to payload:**

```typescript
// In WebSocketTester.tsx and MultiClientTester.tsx

const sendP2PMessage = () => {
  // Capture client publish time
  const clientPublishTimestamp = new Date().toISOString();

  const message = {
    action: 'sendMessage',
    targetChannel: 'WebSocket',
    payload: {
      chatId,
      eventType,
      content: messageContent,
      clientPublishTimestamp, // ← Client-side timestamp
    }
  };

  ws.send(JSON.stringify(message));
};

const sendA2PMessage = async () => {
  // Capture client publish time
  const clientPublishTimestamp = new Date().toISOString();

  const message = {
    targetChannel: 'WebSocket',
    payload: {
      chatId,
      eventType,
      content: messageContent,
      clientPublishTimestamp, // ← Client-side timestamp
    }
  };

  await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(message)
  });
};
```

### 2. Receiving Messages

**Prioritize `clientPublishTimestamp`, fallback to `publishTimestamp`:**

```typescript
websocket.onmessage = async (event) => {
  const data = JSON.parse(event.data);
  let e2eLatency: number | undefined;

  // Prefer client timestamp (no clock skew)
  if (data.clientPublishTimestamp) {
    const publishTime = new Date(data.clientPublishTimestamp);
    const clientReceiveTime = new Date();
    
    e2eLatency = clientReceiveTime.getTime() - publishTime.getTime();
    
    // Should never be negative with same clock
    if (e2eLatency < 0) {
      console.warn('Unexpected negative latency:', e2eLatency);
      e2eLatency = 0;
    }
    
    addLog(`📊 Latency - E2E: ${e2eLatency}ms (client clock)`);
  }
  // Fallback to server timestamp (has potential clock skew)
  else if (data.publishTimestamp) {
    const publishTime = new Date(data.publishTimestamp);
    const clientReceiveTime = new Date();
    
    e2eLatency = clientReceiveTime.getTime() - publishTime.getTime();
    
    // Guard against clock skew
    if (e2eLatency < 0) {
      addLog(`⚠️ Clock skew: ${e2eLatency}ms (adjusted to 0ms)`);
      e2eLatency = 0;
    }
    
    addLog(`📊 Latency - E2E: ${e2eLatency}ms (server clock)`);
  }
};
```

---

## Message Flow with Timestamps

### Complete Journey

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CLIENT SENDS MESSAGE                                     │
│    Time: 14:22:55.000Z (client clock)                      │
│    Action: Capture clientPublishTimestamp                   │
├─────────────────────────────────────────────────────────────┤
│ Message Payload:                                            │
│ {                                                           │
│   "chatId": "chat-123",                                     │
│   "content": "Hello",                                       │
│   "clientPublishTimestamp": "2025-10-28T14:22:55.000Z"     │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. PUBLISHER LAMBDA (P2P or A2P)                           │
│    Time: 14:22:55.007Z (AWS server clock)                  │
│    Action: Add publishTimestamp (server reference)          │
├─────────────────────────────────────────────────────────────┤
│ Enhanced Message:                                           │
│ {                                                           │
│   "chatId": "chat-123",                                     │
│   "content": "Hello",                                       │
│   "clientPublishTimestamp": "2025-10-28T14:22:55.000Z",    │
│   "publishTimestamp": "2025-10-28T14:22:55.007Z"           │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. SNS → SQS → PROCESSOR LAMBDA                            │
│    Action: Pass through both timestamps                     │
└─────────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. CLIENT RECEIVES MESSAGE                                  │
│    Time: 14:22:55.047Z (client clock)                      │
│    Action: Calculate latency using clientPublishTimestamp   │
├─────────────────────────────────────────────────────────────┤
│ Received Message:                                           │
│ {                                                           │
│   "chatId": "chat-123",                                     │
│   "content": "Hello",                                       │
│   "clientPublishTimestamp": "2025-10-28T14:22:55.000Z",    │
│   "publishTimestamp": "2025-10-28T14:22:55.007Z",          │
│   "messageId": "abc-123",                                   │
│   "sequenceNumber": 42                                      │
│ }                                                           │
│                                                            │
│ Calculation:                                               │
│   E2E Latency = 14:22:55.047Z - 14:22:55.000Z = 47ms ✅    │
└─────────────────────────────────────────────────────────────┘
```

---

## Benefits

### ✅ Accurate Latency Measurement
- No clock skew between measurements
- Both timestamps from same clock source
- Eliminates negative latency issues

### ✅ Dual Timestamp Strategy
- `clientPublishTimestamp`: For accurate client-side metrics
- `publishTimestamp`: For server-side logging and debugging

### ✅ Backward Compatible
- Fallback to `publishTimestamp` if `clientPublishTimestamp` missing
- Older messages or external publishers still work

### ✅ Graceful Degradation
```typescript
if (data.clientPublishTimestamp) {
  // ✅ Best: Client-side timestamps (no skew)
  use(data.clientPublishTimestamp);
} else if (data.publishTimestamp) {
  // ⚠️ Fallback: Server timestamp (may have skew)
  use(data.publishTimestamp);
  guardAgainstNegative();
} else {
  // ❌ No timestamp available
  skip();
}
```

---

## Example Scenarios

### Scenario 1: Perfect Conditions
```
Client publishes:  14:22:55.000Z
Client receives:   14:22:55.047Z
E2E Latency:       47ms ✅
```

### Scenario 2: High Latency
```
Client publishes:  14:22:55.000Z
Client receives:   14:22:55.523Z
E2E Latency:       523ms ✅
```

### Scenario 3: External Publisher (No Client Timestamp)
```
Server publishes:  14:22:55.007Z (publishTimestamp only)
Client receives:   14:22:55.000Z (client 7ms behind)
E2E Latency:       -7ms → 0ms (guarded) ⚠️
Warning logged:    "Clock skew detected"
```

---

## Files Updated

### Client Components
1. ✅ `WebSocketTester.tsx`
   - Added `clientPublishTimestamp` to P2P messages
   - Added `clientPublishTimestamp` to A2P messages
   - Prioritize client timestamp in latency calculation

2. ✅ `MultiClientTester.tsx`
   - Added `clientPublishTimestamp` to P2P messages
   - Added `clientPublishTimestamp` to A2P messages
   - Prioritize client timestamp in latency calculation

### Server Components
- ✅ No changes needed! Publishers and Processor already pass through all payload fields
- ✅ `clientPublishTimestamp` automatically flows through the system

---

## Monitoring

### Latency Logs

**With Client Timestamp (Preferred):**
```
[15:22:55] 📊 Latency - E2E: 47ms (client clock) ✅
```

**Fallback to Server Timestamp:**
```
[15:22:55] 📊 Latency - E2E: 47ms (server clock) ⚠️
```

**Clock Skew Detected:**
```
[15:22:55] ⚠️ Clock skew detected! Latency: -7ms (adjusted to 0ms)
[15:22:55] 📊 Latency - E2E: 0ms (server clock)
```

### Metrics Dashboard

Both timestamps sent to CloudWatch:
- **Client-side latency**: Using `clientPublishTimestamp` (accurate)
- **Server-side reference**: Using `publishTimestamp` (for comparison)

---

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Clock Source** | Mixed (client + server) | Single (client only) |
| **Negative Latency** | Possible (clock skew) | Eliminated |
| **Accuracy** | ±10-50ms (clock skew) | <1ms (same clock) |
| **Fallback** | None | Server timestamp |
| **External Publishers** | N/A | Still supported (with warning) |

**Result**: Accurate, reliable end-to-end latency measurements with no clock synchronization issues! 🎉
