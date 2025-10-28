# Message Format Reference

This document describes all supported message structures for publishing to the WebSocket Notification Service.

## Table of Contents
1. [Base Message Structure](#base-message-structure)
2. [Publishing Methods](#publishing-methods)
3. [Message Types](#message-types)
4. [Optional Features](#optional-features)
5. [Complete Examples](#complete-examples)
6. [Target Classes](#target-classes)
7. [Validation Rules](#validation-rules)

---

## Base Message Structure

All messages share a common structure with required and optional fields.

### Required Fields

```typescript
{
  "targetChannel": string,     // "WebSocket", "Email", "SMS" (currently only WebSocket is processed)
  "payload": {
    "chatId": string,          // Chat ID (required for permission checking)
    "eventType": string,       // Application-defined event type
    "content": any             // Message content (string, object, array)
  }
}
```

**Note**: The `chatId` field is now **required** in the payload for permission verification. Users must have permission to send messages to the specified chat.

### Optional Fields (Top-Level)

```typescript
{
  "messageType": "fifo" | "standard",        // Default: "standard"
  "messageGroupId": string,                  // FIFO only: custom ordering group
  // Note: FIFO messages automatically request sequence numbers
}
```

### Optional Fields (In Payload)

```typescript
{
  "payload": {
    // ... required fields ...
    
    "customSequence": {                      // Client-provided sequence (FIFO only)
      "number": number,
      "scope": string
    },
    
    "multiPartMetadata": {                   // Multi-part message tracking
      "groupId": string,
      "totalParts": number,
      "partNumber": number
    }
  }
}
```

---

## Publishing Methods

### P2P (Person-to-Person) - WebSocket

**Route**: WebSocket `$default` route  
**Lambda**: `p2pWebSocketPublisher`

```javascript
// WebSocket message format
{
  "action": "sendMessage",                   // Required: WebSocket action
  "targetChannel": "WebSocket",              // Required
  "messageType": "standard",                 // Optional: "standard" or "fifo"
  "messageGroupId": "chat-room-123",         // Optional: FIFO grouping
  "generateSequence": true,                  // Optional: FIFO only - generates DynamoDB sequence
  "payload": {
    "chatId": "chat-123",                    // Required: Chat ID for routing and permissions
    "eventType": "chat",
    "content": "Hello!"
  }
}
```

**Authentication**: User ID extracted from WebSocket authorizer context  
**Authorization**: User must have permission to send to the specified `chatId`

---

### A2P (Application-to-Person) - HTTP REST

**Endpoint**: `POST /publish`  
**Lambda**: `a2pHttpPublisher`

```json
{
  "targetChannel": "WebSocket",              // Required
  "messageType": "fifo",                     // Optional: "standard" or "fifo"
  "messageGroupId": "notification-group",    // Optional: FIFO grouping
  "generateSequence": true,                  // Optional: FIFO only - generates DynamoDB sequence
  "payload": {
    "chatId": "chat-123",                    // Required: Chat ID for routing and permissions
    "eventType": "notification",
    "content": "Your order has shipped!"
  }
}
```

**Authentication**: `Authorization: Bearer ${COGNITO_JWT_TOKEN}`  
**Authorization**: User must have permission to send to the specified `chatId`

---

## Message Types

### Standard Messages (Default)

**Characteristics**:
- High throughput
- Best-effort delivery
- No ordering guarantees
- Lower latency (~100-300ms)
- No sequence numbers

**Use Cases**: Alerts, notifications, non-critical updates

```json
{
  "targetChannel": "WebSocket",
  "messageType": "standard",
  "payload": {
    "chatId": "chat-123",
    "eventType": "notification",
    "content": "New message in your inbox"
  }
}
```

---

### FIFO Messages (Ordered Processing)

**Characteristics**:
- **Ordered processing** (per messageGroupId) - messages processed sequentially by Lambda
- **Delivery order usually preserved** - but not guaranteed (network variance ~5-15ms)
- Content-based deduplication
- Higher latency (~300-500ms)
- Supports sequence numbers for client-side reordering (when needed)

**Use Cases**: Chat messages, ordered events, sequential updates

**Reality Check**: Out-of-order delivery is rare (< 5%) due to same TCP connection and processing gaps. However, for critical applications (chat, transactions), use sequence numbers for guaranteed correctness.

```json
{
  "targetChannel": "WebSocket",
  "messageType": "fifo",
  "messageGroupId": "chat-room-456",
  "payload": {
    "chatId": "chat-room-456",
    "eventType": "chat",
    "content": "Message in order"
  }
}
```

**FIFO Grouping**:
- Messages with same `messageGroupId` are **processed** in order (one at a time)
- **Usually delivered in order** (same TCP connection), but sort by sequence for critical apps
- Default: Uses authenticated user ID as group ID
- Custom: Provide your own group ID (e.g., "chat-room-123")

**When to Use Sequence-Based Sorting**:
```
Simple notifications → No sorting needed (95% reliable)
Chat applications   → Sort by sequenceNumber (guaranteed correctness)
Transaction logs    → Sort by sequenceNumber (guaranteed correctness)
```

---

## Optional Features

### 1. Sequence Numbers

#### Standard Messages: SQS Sequences Only
```json
{
  "messageType": "standard",
  "payload": {
    "chatId": "chat-123",
    "eventType": "notification",
    "content": "Fast message"
  }
}
```
**Result**: SQS sequence for ordering only (not consecutive), ~50-100ms  
**Use Case**: When order doesn't matter or SQS sequence is sufficient

---

#### FIFO Messages: Automatic Custom Sequences
```json
{
  "messageType": "fifo",
  "generateSequence": true,
  "payload": {
    "chatId": "chat-123",
    "eventType": "chat",
    "content": "Ordered message"
  }
}
```
**Result**: Lambda generates consecutive DynamoDB sequence (1,2,3...), ~100-170ms  
**Use Case**: Chat, transaction logs - gap detection enabled  
**Note**: Set `generateSequence: true` at the top level to enable

---

#### Client-Provided Sequence (Advanced)
```json
{
  "messageType": "fifo",
  "payload": {
    "chatId": "chat-123",
    "eventType": "chat",
    "content": "Client tracked message",
    "customSequence": {
      "number": 42,
      "scope": "chat-123"
    }
  }
}
```
**Result**: Lambda passes through client sequence, ~80-150ms  
**Warning**: Client must coordinate sequences to avoid conflicts  
**Use Case**: When client already manages sequence state

---

### 2. Multi-Part Messages

For messages split into multiple parts (e.g., file uploads, large payloads).

```json
{
  "messageType": "fifo",
  "payload": {
    "chatId": "chat-123",
    "eventType": "file-upload",
    "content": "Binary chunk data...",
    "multiPartMetadata": {
      "groupId": "file-upload-xyz-789",
      "totalParts": 5,
      "partNumber": 1
    }
  }
}
```

**Structure**:
- `groupId`: Unique identifier for this multi-part message
- `totalParts`: Total number of parts expected
- `partNumber`: Current part number (1-based)

**Frontend Usage**: Track received parts and detect missing chunks

#### Custom Sequences vs Multi-Part Metadata

**Question**: Can't custom sequences handle multi-part completeness checking?

**Answer**: Technically yes, but multi-part metadata is more explicit and flexible.

| Aspect | Custom Sequences Only | Multi-Part Metadata |
|--------|----------------------|---------------------|
| **Single file upload** | ✅ Works (check seq 1-5) | ✅ Works (check parts 1-5) |
| **Multiple simultaneous uploads** | ❌ Can't distinguish files | ✅ groupId separates them |
| **Semantic clarity** | ❌ Just numbers | ✅ "This is part 3 of file X" |
| **Scope** | Per target (user:123) | Per logical group (file-xyz) |
| **Example** | seq 1,2,3,4,5 | groupId: file-A (1/3), file-B (1/2) |

**Real-World Scenario - Multiple Simultaneous File Uploads**:

```javascript
// With just sequences (CONFUSING)
seq 1: chunk data  // Which file is this?
seq 2: chunk data  // File A or B?
seq 3: chunk data
// Can't tell which chunks belong to which file!

// With multi-part metadata (CLEAR)
seq 1: { groupId: "file-A", part: 1/3, data: "..." }
seq 2: { groupId: "file-B", part: 1/2, data: "..." }
seq 3: { groupId: "file-A", part: 2/3, data: "..." }
seq 4: { groupId: "file-B", part: 2/2, data: "..." } ← file-B complete!
seq 5: { groupId: "file-A", part: 3/3, data: "..." } ← file-A complete!
```

**Recommendation**:
- **Simple sequential messages**: Use custom sequences
- **Multi-part logical grouping**: Use multiPartMetadata
- **Both together**: Maximum tracking (gap detection + grouping)

---

### 3. Custom Message Group ID (FIFO Only)

Control the ordering scope for FIFO messages.

```json
{
  "messageType": "fifo",
  "messageGroupId": "project-updates-proj123",
  "payload": {
    "chatId": "project-123",
    "eventType": "project-update",
    "content": "Project status changed"
  }
}
```

**Default Behavior**:
- P2P: Uses `chatId` from payload
- A2P: Uses `chatId` from payload

**Custom Behavior**:
- Use any string as grouping key
- Messages with same ID are ordered together
- Different IDs can be processed in parallel

---

## Feature Combinations Guide

### When to Use What?

This service offers three optional tracking mechanisms. Here's when to use each:

#### 1. **No Tracking** (Simplest, Fastest)
```json
{
  "messageType": "standard",
  "payload": { "content": "Simple notification" }
}
```
✅ **Use for**: Alerts, notifications where order doesn't matter  
✅ **Latency**: ~50-100ms (fastest)  
❌ **No**: Ordering, gap detection, or completeness tracking

---

#### 2. **FIFO Only** (Ordered Processing)
```json
{
  "messageType": "fifo",
  "payload": { "content": "Ordered message" }
}
```
✅ **Use for**: Messages that should be processed in order  
✅ **Latency**: ~80-150ms  
✅ **Client gets**: SQS `sequenceNumber` for sorting (if needed)  
⚠️ **Note**: Order usually preserved, but sort by sequence for critical apps

---

#### 3. **FIFO Messages** (Automatic Sequences + Gap Detection)
```json
{
  "messageType": "fifo",
  "generateSequence": true,
  "payload": { 
    "chatId": "chat-123",
    "content": "Trackable message"
  }
}
```
✅ **Use for**: Chat, transaction logs where you need to detect missing messages  
✅ **Latency**: ~100-170ms (+15ms for DynamoDB sequence generation)  
✅ **Client gets**: Consecutive sequences (1,2,3...) for gap detection  
✅ **Can detect**: "Got 1,2,4 → missing 3!"  
**Note**: Set `generateSequence: true` to enable sequence generation

---

#### 4. **Multi-Part Metadata** (Logical Grouping)
```json
{
  "messageType": "fifo",
  "payload": {
    "content": "File chunk",
    "multiPartMetadata": {
      "groupId": "file-upload-xyz",
      "totalParts": 5,
      "partNumber": 2
    }
  }
}
```
✅ **Use for**: File uploads, large messages split into chunks  
✅ **Latency**: ~80-150ms  
✅ **Client can**: Track multiple simultaneous multi-part messages  
✅ **Benefit**: Semantic clarity ("part 2 of file xyz")

---

#### 5. **FIFO Multi-Part** (Automatic Sequences + Part Tracking)
```json
{
  "messageType": "fifo",
  "generateSequence": true,
  "payload": {
    "chatId": "chat-123",
    "content": "File chunk",
    "multiPartMetadata": {
      "groupId": "file-upload-xyz",
      "totalParts": 5,
      "partNumber": 2
    }
  }
}
```
✅ **Use for**: Critical file uploads where you need both gap detection AND grouping  
✅ **Latency**: ~100-170ms  
✅ **Client gets**: Both consecutive sequences AND part tracking  
✅ **Can detect**: Missing sequences AND missing parts  
**Note**: Set `generateSequence: true` to enable sequence generation

---

### Quick Decision Matrix

| Your Need | Solution | Latency | Example Use Case |
|-----------|----------|---------|------------------|
| Just send it | Standard | ~50-100ms | "User logged in" alert |
| Keep order | FIFO (with generateSequence) | ~100-170ms | Status updates, chat |
| Detect gaps | FIFO (with generateSequence) | ~100-170ms | Chat messages |
| Track parts | Standard + multiPartMetadata | ~50-100ms | Single file upload |
| Multiple uploads | Standard + multiPartMetadata | ~50-100ms | User uploads 3 files at once |
| Critical file transfer | FIFO + generateSequence + multiPart | ~100-170ms | Mission-critical data chunks |

---

## Complete Examples

### 1. Simple Notification (Standard)
```json
{
  "targetChannel": "WebSocket",
  "payload": {
    "chatId": "chat-123",
    "eventType": "notification",
    "content": "You have a new follower!"
  }
}
```
**Delivery Time**: ~50-100ms  
**Ordering**: None  
**Sequences**: SQS sequence only (for ordering, not gap detection)

---

### 2. Chat Message (FIFO with Automatic Sequences)
```json
{
  "targetChannel": "WebSocket",
  "messageType": "fifo",
  "messageGroupId": "chat-room-789",
  "generateSequence": true,
  "payload": {
    "chatId": "chat-room-789",
    "eventType": "chat",
    "content": "Hello everyone!"
  }
}
```
**Delivery Time**: ~100-170ms  
**Processing Order**: ✅ Guaranteed per chat-room-789  
**Delivery Order**: ⚠️ Usually preserved (< 5% chance of scrambling)  
**Sequences**: ✅ Consecutive custom sequences (1,2,3...) for gap detection  
**Client Action**: Sort by `customSequence.number` for guaranteed order

---

### 3. Ordered Notification (FIFO with Automatic Sequence)
```json
{
  "targetChannel": "WebSocket",
  "messageType": "fifo",
  "generateSequence": true,
  "payload": {
    "chatId": "chat-123",
    "eventType": "task-update",
    "content": "Task #5 completed"
  }
}
```
**Delivery Time**: ~100-170ms  
**Ordering**: Guaranteed per chat-123  
**Sequences**: Custom sequence generated (consecutive, gap-detectable)  
**Note**: Set `generateSequence: true` to enable sequence generation

---

### 4. Multi-Part File Upload (FIFO with Multi-Part Metadata)

**Scenario**: Uploading multiple files simultaneously

```json
// File A, chunk 1
{
  "targetChannel": "WebSocket",
  "messageType": "fifo",
  "payload": {
    "chatId": "chat-123",
    "eventType": "file-chunk",
    "content": "base64-encoded-chunk-data...",
    "multiPartMetadata": {
      "groupId": "file-upload-A",
      "totalParts": 3,
      "partNumber": 1
    }
  }
}

// File B, chunk 1 (can be sent simultaneously)
{
  "payload": {
    "chatId": "chat-123",
    "multiPartMetadata": {
      "groupId": "file-upload-B",
      "totalParts": 2,
      "partNumber": 1
    }
  }
}
```
**Delivery Time**: ~80-150ms  
**Tracking**: Frontend groups by `groupId`, checks completeness per file  
**Why Multi-Part?**: Can distinguish multiple simultaneous uploads

**With FIFO** (automatic sequences for gap detection):
```json
{
  "messageType": "fifo",
  "generateSequence": true,
  "payload": {
    "chatId": "chat-123",
    "multiPartMetadata": { ... }
  }
}
```
**Result**: Both gap detection (consecutive sequences) AND logical grouping (multiPartMetadata)

---

### 5. Organization Broadcast (Standard, Multiple Targets)
```json
{
  "targetChannel": "WebSocket",
  "payload": {
    "chatId": "org-456",
    "eventType": "announcement",
    "content": {
      "title": "System Maintenance",
      "message": "Scheduled for tonight at 2 AM",
      "severity": "warning"
    }
  }
}
```
**Delivery Time**: ~50-100ms  
**Ordering**: None  
**Target**: All users subscribed to org-456 chat

---

### 6. Client-Managed Sequence (FIFO, Client Sequence)
```json
{
  "targetChannel": "WebSocket",
  "messageType": "fifo",
  "payload": {
    "chatId": "chat-789",
    "eventType": "game-update",
    "content": "Player moved to position (10, 20)",
    "customSequence": {
      "number": 1523,
      "scope": "chat-789:game-session-123"
    }
  }
}
```
**Delivery Time**: ~80-150ms  
**Ordering**: Guaranteed  
**Sequences**: Client-provided (zero Lambda overhead)

---

## Target Classes

### Chat-Based Routing (Current Implementation)

The notification service now uses **chat-based routing** where messages are delivered to all users who have active WebSocket connections subscribed to a specific chat.

```json
{
  "payload": {
    "chatId": "chat-123",
    "eventType": "message",
    "content": "Message content"
  }
}
```

**Routing**: Delivered to all active WebSocket connections subscribed to `chat-123`  
**Permission Check**: User must have permission entry in the permissions table for `chat-123`

### Permission System

Before publishing a message (via either A2P or P2P), the system checks if the authenticated user has permission to send to the specified `chatId`:

**Permission Table Structure**:
- Primary Key: `userId` (Cognito user ID)
- Sort Key: `chatId` 
- Permission exists if record is present

**Authorization Flow**:
1. User authenticates (Cognito JWT token)
2. User sends message with `chatId` in payload
3. Lambda queries permissions table: `userId` + `chatId`
4. If permission exists → message published
5. If no permission → `403 Forbidden` response

**Managing Permissions**: Use the `/permissions` API endpoint to grant/revoke chat access

---

## Validation Rules

### Required Fields
✅ `targetChannel` - Must be a non-empty string  
✅ `payload` - Must be an object  
✅ `payload.chatId` - Must be a non-empty string (required for routing and permissions)  
✅ `payload.eventType` - Must be a non-empty string  
✅ `payload.content` - Can be any type (string, object, array, etc.)

### Permission Requirements
✅ User must be authenticated (Cognito JWT token)  
✅ User must have permission to access the specified `chatId`  
✅ Permission is verified before message publication

### Optional Field Rules

**messageType**:
- Must be "fifo" or "standard"
- Default: "standard"

**messageGroupId** (FIFO only):
- Ignored for standard messages
- Default: Uses `chatId` from payload
- Can be any string (e.g., "chat-room-123")

**generateSequence** (FIFO only):
- Set to `true` to trigger DynamoDB sequence generation in Processor Lambda
- Generates consecutive sequences (1,2,3...) for gap detection
- Optional - only needed if you want custom sequences
- Ignored for standard messages

**customSequence** (FIFO only, in payload):
- Must be an object with `number` and `scope`
- `number` must be a positive integer
- `scope` must be a non-empty string
- If provided, overrides `generateSequence` automatic sequence generation
- Use only if client manages sequence state

**multiPartMetadata** (in payload):
- Must be an object with `groupId`, `totalParts`, `partNumber`
- `groupId` must be a non-empty string
- `totalParts` must be a positive integer
- `partNumber` must be between 1 and `totalParts`

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Missing required parameters: targetChannel and payload are required."
}
```

```json
{
  "error": "Missing required parameter: payload.chatId is required."
}
```

```json
{
  "error": "Invalid messageType. Must be 'fifo' or 'standard'."
}
```

```json
{
  "error": "Request body not json"
}
```

---

### 401 Unauthorized
```json
{
  "error": "Unauthorized - No user ID in context"
}
```

---

### 403 Forbidden
```json
{
  "error": "Forbidden: You do not have permission to send messages to this chat."
}
```

**Cause**: User does not have permission to access the specified `chatId`  
**Solution**: Request permission via the `/permissions` API or verify the correct `chatId`

---

### 500 Internal Server Error
```json
{
  "error": "Failed to send message",
  "details": "Error message details"
}
```

---

## ⚠️ Processing Order vs Delivery Order

### The Critical Distinction

**FIFO guarantees PROCESSING order, NOT DELIVERY order.**

However, **in practice, out-of-order delivery is rare** (< 5% of messages in typical conditions).

```
┌─────────────────────────────────────────────────────────────┐
│  FIFO Queue          Lambda Processor       WebSocket        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  msg1 ──────────────► Process msg1 ──────► Send (50ms) ──┐  │
│         (sequential)        │                             │  │
│  msg2 (waits)               ▼                             │  │
│         (in order)    Process msg2 ──────► Send (30ms) ──┼─►│
│                                                           │  │
│                                            Network varies │  │
│                                                           │  │
│                                            msg2 arrives! ◄┘  │
│                                            msg1 arrives! ◄───│
│                                                               │
│  ✅ Processing: Sequential                                   │
│  ⚠️  Delivery: Usually in order, but not guaranteed          │
└─────────────────────────────────────────────────────────────┘
```

### Why Out-of-Order is RARE

1. **Same TCP Connection**: WebSocket uses persistent connection - same network path
2. **Small Latency Variance**: Typically only 5-15ms difference between messages
3. **Processing Gap**: msg2 waits for msg1 to finish (~50-100ms buffer)
4. **TCP Ordering**: TCP protocol maintains packet order on same connection

### When It MIGHT Happen

Out-of-order delivery is more likely when:
- User has **multiple WebSocket connections** (desktop + mobile)
- Connections have **very different network latencies** (WiFi vs 4G)
- **Async rendering** in client causes display scrambling (see below)

**Estimated probability**: 1-5% of messages with multiple connections + varying conditions

### Two Solutions: Simple vs Defensive

#### Option 1: Simple Approach (Works 95%+ of the time)

```javascript
// Just display messages as they arrive
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  appendToUI(msg); // Direct rendering
};
```

**Use for**: Notifications, alerts, status updates where exact order isn't critical

**Pros**: 
- ✅ Simplest code
- ✅ Fastest rendering
- ✅ Works fine in most scenarios

---

#### Option 2: Defensive Approach (Guarantees correctness)

```javascript
// Sort messages by sequence number
const messageBuffer = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  messageBuffer.push(msg);
  
  // Sort by sequence number
  messageBuffer.sort((a, b) => 
    Number(a.sqsMetadata.sequenceNumber) - Number(b.sqsMetadata.sequenceNumber)
    // OR: a.customSequence.number - b.customSequence.number
  );
  
  renderMessages(messageBuffer);
};
```

**Use for**: Chat, transaction logs, ordered events where order is critical

**Pros**:
- ✅ Guarantees correct order
- ✅ Handles multiple connections gracefully
- ✅ Protects against async rendering race conditions

---

### The Bigger Risk: Async Rendering

**Network order is rarely the problem. Async rendering is.**

```javascript
// Even if delivered in order, async can scramble display!
ws.onmessage = async (event) => {
  const msg = JSON.parse(event.data);
  
  // msg1 arrives, starts rendering (takes 50ms)
  await renderMessage(msg); // ← Async operation!
  
  // msg2 arrives while msg1 still rendering
  // If msg2 renders faster (30ms), it appears first! ❌
};
```

**Solution**: Always use sequence numbers for sorting in critical UIs.

---

### When This Matters

| Scenario | Out-of-Order Risk | Recommendation |
|----------|-------------------|----------------|
| **Simple notifications** | Very low | Simple approach ✅ |
| **Chat messages** | Low, but critical | Defensive approach ✅ |
| **Status updates** | Low | Simple approach (latest wins) |
| **File chunks** | Medium (multiple connections) | Defensive + multiPartMetadata |
| **Transaction logs** | Low, but critical | Defensive approach ✅ |

### Best Practices

✅ **For most use cases**: Simple approach works fine (just append messages)  
✅ **For critical ordering**: Sort by sequence numbers (defensive approach)  
✅ **Use Standard messages** if order doesn't matter at all (faster)  
⚠️ **Remember**: Async rendering is a bigger risk than network variance

---

## Frontend Message Receipt

Messages arrive at WebSocket clients with enriched metadata.

### Received Message Structure
```json
{
  // Original payload fields
  "chatId": "chat-123",
  "eventType": "chat",
  "content": "Hello!",
  
  // Added by Lambda publishers
  "publishTimestamp": "2025-10-12T14:30:00.000Z",
  
  // Optional: Custom sequence (if generated or provided)
  "customSequence": {
    "number": 42,
    "scope": "chat-123",
    "timestamp": "2025-10-12T14:30:00.000Z"
  },
  
  // Optional: Multi-part metadata (if provided)
  "multiPartMetadata": {
    "groupId": "file-upload-xyz",
    "totalParts": 5,
    "partNumber": 3
  },
  
  // Added by Processor Lambda
  "sqsMetadata": {
    "sequenceNumber": "18779423847239847",  // FIFO only: for ordering
    "messageGroupId": "chat-123",            // FIFO only: ordering scope
    "messageId": "abc-123-def-456",          // SQS message ID
    "retryCount": 0                          // Delivery attempt count
  }
}
```

---

## Quick Decision Tree

```
Do you need ordering at the client?
├─ NO  → Use messageType: "standard"
│        ✅ Fastest delivery
│        ✅ SQS sequence for basic ordering
│        ✅ ~50-100ms
│        ✅ No gap detection
│
└─ YES → Use messageType: "fifo"
         ✅ Ordered processing (sequential per messageGroupId)
         ⏱️  ~80-150ms base latency
         📋 Client can sort by sqsMetadata.sequenceNumber
         │
         Need gap detection (chat, transactions)?
         │
         ├─ NO (notifications, alerts)
         │  └─ Simple FIFO: just ordered processing
         │     ✅ Works 95%+ of the time
         │     ✅ Sort by SQS sequence if needed
         │     💡 Order usually preserved (same TCP connection)
         │
         └─ YES (chat, logs, critical sequences)
            └─ FIFO with generateSequence: true
               ✅ Consecutive sequences (1,2,3...)
               ✅ Guarantees correct display order
               ✅ Gap detection (can detect missing messages)
               ⏱️  ~100-170ms (+15ms for DynamoDB sequences)
               📋 Sort by customSequence.number

Multi-part message?
└─ Add multiPartMetadata to payload
   ✅ Works with any message type
   ✅ Independent of sequences
```

---

## Summary Table

| Feature | Standard | FIFO | FIFO + generateSequence | FIFO + Multi-Part |
|---------|----------|------|------------------------|-------------------|
| **Processing Order** | ❌ | ✅ | ✅ | ✅ |
| **Delivery Order** | ❌ | ⚠️ Usually* | ⚠️ Usually* | ⚠️ Usually* |
| **Client Reordering** | SQS seq | SQS seq | Custom seq** | Custom seq |
| **Latency** | ~50-100ms | ~80-150ms | ~100-170ms | ~100-170ms |
| **Gap Detection** | ❌ | ❌ | ✅ | ✅ |
| **Completeness** | ❌ | ❌ | ✅ | ✅ (per part group) |
| **Use Case** | Alerts | Simple ordering | Chat/logs | File uploads |
| **Overhead** | None | None | +DynamoDB | +DynamoDB |

\* Usually in order (95%+) due to same TCP connection. Sort by sequence for critical apps.

\*\* Simple apps: just append. Critical apps: sort by `customSequence.number`.

---

## Additional Resources

- [Architecture Overview](ARCHITECTURE_OVERVIEW.md)
- [Quick Reference](QUICK_REFERENCE.md)
- [Sequence Number Strategy](SEQUENCE_STRATEGY.md)
- [P2P Usage Guide](websocket-message-publisher/USAGE.md)
- [A2P Usage Guide](http-message-publisher/USAGE.md)
