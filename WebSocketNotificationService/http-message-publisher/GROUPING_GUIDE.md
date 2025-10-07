# Message Grouping Quick Reference

## Overview
For FIFO messages, the `messageGroupId` determines which messages are processed sequentially. This guide helps you choose the right grouping strategy.

## Decision Tree

```
Is message order important?
├─ NO  → Use messageType: "standard" ✅
└─ YES → Use messageType: "fifo"
    │
    └─ What needs to be ordered?
        ├─ Messages in same chat room
        │   → messageGroupId: "chat-room-{roomId}" ✅
        │
        ├─ Updates to same order/transaction
        │   → messageGroupId: "order-{orderId}" ✅
        │
        ├─ Changes to same document
        │   → messageGroupId: "document-{docId}" ✅
        │
        ├─ All messages to same user
        │   → messageGroupId: omit (defaults to userId) ⚠️
        │
        └─ Something else
            → messageGroupId: "{resource-type}-{resourceId}" ✅
```

## Common Patterns

### ✅ Chat Application

```json
{
  "messageType": "fifo",
  "messageGroupId": "chat-room-abc123",
  "targetChannel": "WebSocket",
  "payload": {
    "targetId": "room-abc123",
    "targetClass": "hub",
    "eventType": "chat_message",
    "content": "Hello!"
  }
}
```

**Why?** Messages in Room A don't block messages in Room B.

### ✅ Order Status Updates

```json
{
  "messageType": "fifo",
  "messageGroupId": "order-xyz789",
  "targetChannel": "WebSocket",
  "payload": {
    "targetId": "user123",
    "targetClass": "user",
    "eventType": "order_update",
    "content": { "status": "shipped" }
  }
}
```

**Why?** Order XYZ updates are ordered, but Order ABC processes in parallel.

### ✅ Collaborative Editing

```json
{
  "messageType": "fifo",
  "messageGroupId": "document-doc456",
  "targetChannel": "WebSocket",
  "payload": {
    "targetId": "doc456",
    "targetClass": "hub",
    "eventType": "doc_edit",
    "content": { "operation": "insert", "text": "..." }
  }
}
```

**Why?** Edits to Document 456 are ordered, other documents process in parallel.

### ⚠️ User Notifications (Default Fallback)

```json
{
  "messageType": "fifo",
  // messageGroupId omitted - uses userId
  "targetChannel": "WebSocket",
  "payload": {
    "targetId": "user123",
    "targetClass": "user",
    "eventType": "notification",
    "content": "You have a new message"
  }
}
```

**Caution:** ALL messages to user123 will be sequential. Only use if truly needed.

### ✅ Push Notifications (Better Alternative)

```json
{
  "messageType": "standard", // No grouping needed!
  "targetChannel": "WebSocket",
  "payload": {
    "targetId": "user123",
    "targetClass": "user",
    "eventType": "notification",
    "content": "You have a new message"
  }
}
```

**Better!** Independent notifications process in parallel with lower latency.

## Performance Comparison

### Scenario: User in 3 chat rooms sends messages

**With Resource-Specific Grouping** ✅
```
Room A: msg1 → msg2 → msg3  (parallel)
Room B: msg1 → msg2          (parallel)
Room C: msg1                 (parallel)
Total Time: ~100ms (all parallel)
```

**With User-Level Grouping** ⚠️
```
User: RoomA-msg1 → RoomA-msg2 → RoomB-msg1 → RoomC-msg1 → RoomA-msg3 → RoomB-msg2
Total Time: ~600ms (all sequential)
```

## Rules of Thumb

1. **Be Specific**: Group by the smallest logical resource
   - ✅ `chat-room-{id}` not `user-{id}`
   - ✅ `order-{id}` not `customer-{id}`

2. **Parallelize When Possible**: Independent resources = independent groups
   - ✅ Each chat room has its own groupId
   - ❌ Don't use same groupId for unrelated messages

3. **Standard for Broadcasts**: If order doesn't matter, use Standard
   - ✅ Notifications, alerts, status updates
   - ❌ Don't use FIFO just because "it seems safer"

4. **Default Fallback is Safe but Slow**: Omitting `messageGroupId` works but may bottleneck
   - Use when: All user messages truly need ordering
   - Avoid when: User has multiple independent workflows

## Examples by Use Case

| Use Case | messageGroupId | Rationale |
|----------|----------------|-----------|
| Chat messages | `chat-room-{roomId}` | Order per room, rooms parallel |
| Order updates | `order-{orderId}` | Order per order, orders parallel |
| Transaction log | `account-{accountId}` | Order per account, accounts parallel |
| Game moves | `game-{gameId}` | Order per game, games parallel |
| Document edits | `document-{docId}` | Order per doc, docs parallel |
| User notifications | `standard` type | No ordering needed, max performance |
| System alerts | `standard` type | No ordering needed |
| Metrics/Analytics | `standard` type | No ordering needed, high volume |

## Anti-Patterns to Avoid

❌ **Global GroupId**
```json
{ "messageGroupId": "global" }
// Result: Everything sequential, terrible performance
```

❌ **Random GroupId**
```json
{ "messageGroupId": crypto.randomUUID() }
// Result: No ordering at all, why use FIFO?
```

❌ **FIFO for Non-Sequential Data**
```json
// BAD: Generic notifications don't need ordering
{ "messageType": "fifo", "eventType": "generic_notification" }
// GOOD: Use standard for better performance
{ "messageType": "standard", "eventType": "generic_notification" }
```

❌ **Too Broad Grouping**
```json
// BAD: All customer messages ordered together
{ "messageGroupId": "customer-{customerId}" }
// GOOD: Group by specific resource
{ "messageGroupId": "order-{orderId}" }
```

## Testing Your Grouping Strategy

Ask these questions:

1. **If message A and B have the same groupId, should B wait for A?**
   - YES → Correct grouping ✅
   - NO → groupId too broad, make it more specific ⚠️

2. **Can different groups process simultaneously?**
   - YES → Good parallelization ✅
   - NO → Consider splitting further 💡

3. **Does the groupId represent a single logical resource?**
   - YES → Well-designed ✅
   - NO → Too broad or too narrow ⚠️

## Need Help?

- **Chat app?** → Use `chat-room-{roomId}`
- **E-commerce?** → Use `order-{orderId}`
- **Notifications?** → Use `standard` messageType
- **Real-time collaboration?** → Use `document-{docId}` or `session-{sessionId}`
- **When in doubt?** → Start with resource-specific grouping, measure, adjust
