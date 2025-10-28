# Sequence Number Guide for Frontend

## ⚠️ Important: SQS Sequence Numbers Limitation

**SQS FIFO sequence numbers are NOT consecutive!** 

From [AWS Documentation](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queue-message-identifiers.html):
> "The sequence number is a large, **non-consecutive** number that Amazon SQS assigns to each message."

**What this means:**
- ✅ Sequence numbers are monotonically increasing (each new number is larger)
- ❌ Sequence numbers do NOT increment by 1
- ❌ **Gaps in sequence numbers do NOT indicate missing messages**

**Example:**
```javascript
Message 1: sequenceNumber = "18868359141601484224"
Message 2: sequenceNumber = "18868359141619370011"  // Gap of 17,885,787 - NO messages missing!
Message 3: sequenceNumber = "18868359141637255798"  // Gap of 17,885,787 - NO messages missing!
```

**Use SQS sequence numbers for:**
- ✅ Verifying messages arrive in order (current > previous)
- ✅ Detecting out-of-order delivery (shouldn't happen with FIFO)

**Do NOT use SQS sequence numbers for:**
- ❌ Detecting missing messages
- ❌ Counting messages
- ❌ Gap detection

**For reliable gap detection:** See `SEQUENCE_NUMBER_SOLUTION.md` for implementation using custom consecutive sequence numbers with DynamoDB.

---

## Overview

The WebSocket Notification Service now includes SQS FIFO sequence numbers in every message sent to the frontend. This enables reliable message ordering, gap detection, and deduplication.

## Message Structure

Every WebSocket message now includes the following metadata:

```javascript
{
  // Your original payload fields
  "eventType": "notification",
  "content": "Message content",
  
  // Routing metadata
  "targetId": "user-123",
  "targetClass": "user",
  
  // Timing metadata
  "publishTimestamp": "2025-10-11T12:00:00.000Z",
  "receivedTimestamp": "2025-10-11T12:00:00.150Z",
  "latencyMs": 150,
  
  // Sequence tracking (FIFO only - null for standard queue)
  "sequenceNumber": "18868359141601484224",  // ✅ Monotonically increasing per messageGroupId
  "messageGroupId": "user-123",               // ✅ Scope of the sequence (same as targetId)
  "messageId": "abc-123-xyz",                 // ✅ Unique SQS message ID
  "retryCount": 0                             // ✅ 0 for first delivery, >0 for retries
}
```

## Sequence Number Guarantees

### For FIFO Messages (messageType: 'fifo')

- **`sequenceNumber`**: A 128-bit number (as string) that is **monotonically increasing** within the same `messageGroupId`
- **`messageGroupId`**: Identifies the scope of the sequence (equals `targetId`)
- **Ordering**: Messages with the same `messageGroupId` are **always** delivered in order
- **No duplicates**: FIFO queues guarantee exactly-once delivery (with deduplication)

### For Standard Messages (messageType: 'standard')

- **`sequenceNumber`**: `null` (standard queues don't have sequence numbers)
- **`messageGroupId`**: `null`
- **Ordering**: Best-effort (messages may arrive out of order)
- **Duplicates**: Possible (standard queues provide at-least-once delivery)

## Frontend Implementation Examples

### 1. Basic Ordering Verification (Not Gap Detection!)

```javascript
class WebSocketClient {
  constructor() {
    this.lastSequenceNumbers = new Map(); // messageGroupId → last sequence number
  }

  handleMessage(data) {
    const message = JSON.parse(data);
    
    // Only track sequences for FIFO messages
    if (message.sequenceNumber && message.messageGroupId) {
      const lastSeq = this.lastSequenceNumbers.get(message.messageGroupId);
      
      if (lastSeq) {
        const current = BigInt(message.sequenceNumber);
        const last = BigInt(lastSeq);
        
        // ✅ Verify ordering (should always be true for FIFO)
        if (current <= last) {
          console.error(`❌ OUT OF ORDER! This should never happen with FIFO!`);
          console.error(`Current: ${current}, Last: ${last}`);
        } else {
          console.log(`✅ In order: ${current} > ${last}`);
        }
        
        // ❌ DO NOT check for gaps like this:
        // const gap = current - last - 1n;  // This is meaningless!
        // SQS sequence numbers are NOT consecutive
      }
      
      this.lastSequenceNumbers.set(message.messageGroupId, message.sequenceNumber);
    }
    
    // Process the message
    this.processMessage(message);
  }
}
```

### 2. Deduplication (Handle Retries)

```javascript
class MessageDeduplicator {
  constructor(maxSize = 1000) {
    this.seen = new Map(); // messageId → timestamp
    this.maxSize = maxSize;
  }

  isDuplicate(message) {
    if (this.seen.has(message.messageId)) {
      console.log(`🔄 Duplicate message detected: ${message.messageId}`);
      return true;
    }
    
    // Track this message
    this.seen.set(message.messageId, Date.now());
    
    // Clean up old entries (simple LRU)
    if (this.seen.size > this.maxSize) {
      const oldestKey = this.seen.keys().next().value;
      this.seen.delete(oldestKey);
    }
    
    return false;
  }
}

// Usage
const deduplicator = new MessageDeduplicator();

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (deduplicator.isDuplicate(message)) {
    return; // Skip duplicate
  }
  
  handleMessage(message);
};
```

### 3. Out-of-Order Detection and Buffering

⚠️ **Note:** With FIFO queues, out-of-order delivery should NEVER happen. This code is for debugging only.

```javascript
class OrderedMessageBuffer {
  constructor() {
    this.lastSequences = new Map(); // messageGroupId → last sequence number
  }

  addMessage(message) {
    if (!message.sequenceNumber || !message.messageGroupId) {
      // Standard queue message - process immediately
      return [message];
    }

    const groupId = message.messageGroupId;
    const seqNum = BigInt(message.sequenceNumber);
    const lastSeq = this.lastSequences.get(groupId);
    
    if (!lastSeq) {
      // First message for this group
      this.lastSequences.set(groupId, seqNum);
      return [message];
    }
    
    // Verify ordering (should ALWAYS be true for FIFO)
    if (seqNum > lastSeq) {
      console.log(`✅ Message in order for ${groupId}`);
      this.lastSequences.set(groupId, seqNum);
      return [message];
    } else {
      console.error(`❌ OUT OF ORDER for ${groupId}! This should NEVER happen!`);
      console.error(`Current: ${seqNum}, Last: ${lastSeq}`);
      // This indicates a serious issue with FIFO queue configuration
      return [message]; // Process anyway, but log the error
    }
  }
}
```

### 4. Complete Example with React

```javascript
import { useState, useEffect, useRef } from 'react';

function useWebSocketWithSequencing(url) {
  const [messages, setMessages] = useState([]);
  const wsRef = useRef(null);
  const lastSeqRef = useRef(new Map());
  const seenMessagesRef = useRef(new Set());

  useEffect(() => {
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      // Deduplication
      if (seenMessagesRef.current.has(message.messageId)) {
        console.log('Duplicate message, skipping');
        return;
      }
      seenMessagesRef.current.add(message.messageId);
      
      // Ordering verification (FIFO only) - NOT gap detection!
      if (message.sequenceNumber && message.messageGroupId) {
        const lastSeq = lastSeqRef.current.get(message.messageGroupId);
        
        if (lastSeq) {
          const current = BigInt(message.sequenceNumber);
          const last = BigInt(lastSeq);
          
          // ✅ Verify ordering
          if (current <= last) {
            console.error(`❌ OUT OF ORDER! This should never happen with FIFO!`);
          } else {
            console.log(`✅ In order: ${current} > ${last}`);
          }
          
          // ❌ DON'T do this - gaps are normal!
          // const gap = current - last - 1n;
          // if (gap > 0n) {
          //   console.error(`Missing ${gap} messages`); // WRONG!
          // }
        }
        
        lastSeqRef.current.set(message.messageGroupId, message.sequenceNumber);
      }
      
      // Add to messages
      setMessages(prev => [...prev, message]);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
    };

    return () => {
      ws.close();
    };
  }, [url]);

  return messages;
}
```

## Important: Gap Detection is NOT Possible with SQS Sequence Numbers

❌ **You cannot use SQS sequence numbers to detect missing messages** because:
1. Sequence numbers are not consecutive
2. Gaps between numbers are normal and expected
3. A gap of 1 million doesn't mean anything

### If You Need Gap Detection

See `SEQUENCE_NUMBER_SOLUTION.md` for:
- **Custom consecutive sequence numbers** using DynamoDB
- **Message counting** approaches
- **Timestamp-based** detection methods

### What You CAN Do with SQS Sequence Numbers

✅ **Verify ordering:**
```javascript
if (message.sequenceNumber && lastSeq) {
  const current = BigInt(message.sequenceNumber);
  const last = BigInt(lastSeq);
  
  if (current <= last) {
    console.error('OUT OF ORDER - this is a serious bug!');
  }
}
```

✅ **Debugging:**
```javascript
console.log({
  sequenceNumber: message.sequenceNumber,
  messageGroupId: message.messageGroupId,
  orderingCheck: current > last ? 'PASS' : 'FAIL'
});
```

## Best Practices

1. **Always use BigInt for sequence numbers** - They're 128-bit numbers and exceed JavaScript's Number.MAX_SAFE_INTEGER

2. **Track sequences per messageGroupId** - Each group has its own independent sequence

3. **Implement deduplication** - Use `messageId` to detect and skip duplicates (especially for retries)

4. **Handle null sequences gracefully** - Standard queue messages won't have sequence numbers

5. **Store last sequence in localStorage** - Persist across page reloads:
   ```javascript
   localStorage.setItem(`lastSeq_${groupId}`, sequenceNumber);
   ```

6. **Monitor retryCount** - If `retryCount > 0`, the message was redelivered (possible duplicate)

## Debugging

Log sequence information for troubleshooting:

```javascript
console.log({
  messageId: message.messageId,
  sequenceNumber: message.sequenceNumber,
  messageGroupId: message.messageGroupId,
  retryCount: message.retryCount,
  latency: message.latencyMs,
  eventType: message.eventType
});
```

## AWS Guarantees

- **FIFO Queue**: Exactly-once delivery, strict ordering per MessageGroupId
- **Standard Queue**: At-least-once delivery, best-effort ordering
- **Sequence Numbers**: Monotonically increasing, unique across the entire queue
- **MessageGroupId**: Scope of ordering (maps to your `targetId`)

## Architecture Flow

```
Publisher
  ↓ (with MessageGroupId = targetId)
SNS FIFO Topic
  ↓ (preserves order per MessageGroupId)
SQS FIFO Queue (assigns SequenceNumber)
  ↓ (FIFO delivery per MessageGroupId)
Processor Lambda
  ↓ (extracts SequenceNumber from SQS)
WebSocket → Frontend
  ↓
Frontend tracks last sequence per messageGroupId
```

## Questions?

- Sequence numbers are only available for **FIFO queues** (`messageType: 'fifo'`)
- Standard queue messages (`messageType: 'standard'`) will have `sequenceNumber: null`
- Gaps usually indicate network issues or Lambda processing delays
- Out-of-order delivery should **never** happen with FIFO queues (within the same MessageGroupId)
