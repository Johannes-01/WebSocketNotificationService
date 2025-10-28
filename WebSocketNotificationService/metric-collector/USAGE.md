# End-to-End Latency Metric Collector - Usage Guide

## Overview

The metric collector has been simplified to **ONLY track end-to-end latency** from message publish to client receipt. This provides the most important metric for understanding user experience.

## Simplified API

### Endpoint
```
POST /metrics
Authorization: Bearer {COGNITO_JWT_TOKEN}
```

### Request Format
```json
{
  "latency": 234.56,           // Required: E2E latency in milliseconds
  "messageId": "msg-123",      // Optional: message identifier
  "chatId": "chat-abc"         // Optional: chat identifier
}
```

### Success Response (200 OK)
```json
{
  "message": "End-to-end latency recorded successfully",
  "latency_ms": 234.56
}
```

### Error Responses

**400 Bad Request** - Missing latency field:
```json
{
  "error": "Missing required field: latency (in milliseconds) is required",
  "example": { 
    "latency": 234.56, 
    "messageId": "optional", 
    "chatId": "optional" 
  }
}
```

**400 Bad Request** - Invalid latency value:
```json
{
  "error": "Invalid latency value: must be a positive number"
}
```

## Client Implementation

### JavaScript/TypeScript Example

```javascript
class LatencyTracker {
  constructor(apiUrl, authToken) {
    this.apiUrl = apiUrl;
    this.authToken = authToken;
  }

  /**
   * Calculate and submit end-to-end latency
   * @param {string} publishTimestamp - ISO 8601 timestamp from message
   * @param {string} messageId - Optional message ID
   * @param {string} chatId - Optional chat ID
   */
  async trackE2ELatency(publishTimestamp, messageId = null, chatId = null) {
    const receivedAt = Date.now();
    const publishedAt = new Date(publishTimestamp).getTime();
    const latencyMs = receivedAt - publishedAt;

    try {
      const response = await fetch(`${this.apiUrl}/metrics`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          latency: latencyMs,
          messageId: messageId,
          chatId: chatId,
        }),
      });

      if (!response.ok) {
        console.error('Failed to submit latency metric:', await response.text());
      }
    } catch (error) {
      console.error('Error submitting latency metric:', error);
    }
  }
}

// Usage with WebSocket
const tracker = new LatencyTracker(API_URL, cognitoToken);

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  // Track E2E latency
  tracker.trackE2ELatency(
    message.publishTimestamp,
    message.messageId,
    message.payload?.chatId
  );
  
  // Display message
  displayMessage(message);
};
```

### Batched Submission (Recommended for High Throughput)

```javascript
class BatchedLatencyTracker {
  constructor(apiUrl, authToken, batchSize = 10, flushInterval = 10000) {
    this.apiUrl = apiUrl;
    this.authToken = authToken;
    this.batchSize = batchSize;
    this.buffer = [];
    
    // Auto-flush every 10 seconds
    setInterval(() => this.flush(), flushInterval);
  }

  /**
   * Add latency measurement to buffer
   */
  track(publishTimestamp, messageId = null, chatId = null) {
    const receivedAt = Date.now();
    const publishedAt = new Date(publishTimestamp).getTime();
    const latencyMs = receivedAt - publishedAt;

    this.buffer.push({
      latency: latencyMs,
      messageId: messageId,
      chatId: chatId,
    });

    // Auto-flush when batch is full
    if (this.buffer.length >= this.batchSize) {
      this.flush();
    }
  }

  /**
   * Submit all buffered metrics
   */
  async flush() {
    if (this.buffer.length === 0) return;

    const metrics = [...this.buffer];
    this.buffer = [];

    // Submit each metric individually
    // (CloudWatch metric filters work per-log-entry)
    for (const metric of metrics) {
      try {
        await fetch(`${this.apiUrl}/metrics`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(metric),
        });
      } catch (error) {
        console.error('Failed to submit metric:', error);
      }
    }
  }
}

// Usage
const tracker = new BatchedLatencyTracker(API_URL, cognitoToken);

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  // Buffer latency measurement
  tracker.track(
    message.publishTimestamp,
    message.messageId,
    message.payload?.chatId
  );
  
  displayMessage(message);
};

// Clean up on page unload
window.addEventListener('beforeunload', () => tracker.flush());
```

## CloudWatch Dashboard

The simplified dashboard shows only end-to-end latency metrics:

### Dashboard Name
`NotificationService-E2E-Latency`

### Widgets

1. **Percentiles Graph** (P50, P90, P95, P99)
   - Shows latency distribution over time
   - Most important for understanding user experience

2. **Average & Extremes**
   - Average, Minimum, Maximum latency
   - Helps identify outliers

3. **Message Throughput & High Latency Count**
   - Total message count
   - Count of messages exceeding 1000ms (1 second)

4. **Current Average E2E Latency** (Single Value)
   - Real-time average latency

5. **Current P95 Latency** (Single Value)
   - 95th percentile indicator

6. **Total Messages** (Single Value)
   - Message throughput in last 1 minute

7. **High Latency Messages** (Single Value)
   - Count of slow messages (>1s) in last 1 minute

## CloudWatch Metrics

### Metric Names

| Metric | Namespace | Unit | Description |
|--------|-----------|------|-------------|
| `EndToEndLatency` | `NotificationService` | Milliseconds | E2E latency from publish to client |
| `HighLatencyMessageCount` | `NotificationService` | Count | Messages exceeding 1000ms |

### Available Statistics

- **p50** (Median): 50% of messages have latency below this
- **p90**: 90% of messages have latency below this
- **p95**: 95% of messages have latency below this
- **p99**: 99% of messages have latency below this
- **Average**: Mean latency across all messages
- **Minimum**: Fastest message delivery
- **Maximum**: Slowest message delivery
- **SampleCount**: Total number of messages

## Performance Guidelines

### Target Latencies

| Percentile | Target | Good | Acceptable | Poor |
|------------|--------|------|------------|------|
| **P50** | < 200ms | < 300ms | < 500ms | > 500ms |
| **P90** | < 400ms | < 600ms | < 1000ms | > 1000ms |
| **P95** | < 600ms | < 800ms | < 1500ms | > 1500ms |
| **P99** | < 1000ms | < 1500ms | < 2000ms | > 2000ms |

### High Latency Threshold

Messages exceeding **1000ms (1 second)** are considered high latency and tracked separately.

## Troubleshooting

### No metrics appearing in dashboard

1. **Check client is submitting metrics:**
   ```bash
   # Check Lambda logs
   aws logs tail /aws/lambda/NotificationService-MetricCollector --follow
   ```

2. **Verify metric filter:**
   - Check CloudWatch → Log groups → `/aws/lambda/NotificationService-MetricCollector`
   - Look for logs with `event_type: "end_to_end_latency"`

3. **Check authentication:**
   - Ensure valid Cognito JWT token
   - Verify token hasn't expired

### Metrics delayed

- CloudWatch metrics have ~1-2 minute delay
- Dashboard updates every 60 seconds by default
- Refresh dashboard manually to see latest data

### High latency detected

**Possible causes:**
1. Network latency (client to AWS region)
2. WebSocket connection issues
3. Backend processing delays
4. DynamoDB throttling (if using sequences)
5. SQS queue backlog

**Debugging steps:**
1. Check processor Lambda duration in CloudWatch
2. Verify SQS queue depth
3. Review X-Ray traces for bottlenecks
4. Check client network conditions

## Migration from Old System

### Old Format (DEPRECATED)
```json
{
  "metricName": "EndToEndLatency",
  "value": 234.56,
  "clientId": "client-123",
  "metadata": {}
}
```

### New Format (CURRENT)
```json
{
  "latency": 234.56,
  "messageId": "msg-123",
  "chatId": "chat-abc"
}
```

### Breaking Changes
- ❌ Removed: `metricName`, `clientId`, `metadata` fields
- ❌ Removed: Network latency and jitter tracking
- ✅ Simplified: Only `latency` field required
- ✅ Added: Optional `messageId` and `chatId` for correlation

## Benefits of Simplified Approach

✅ **Clearer focus**: One metric that matters most  
✅ **Easier client implementation**: Simpler API  
✅ **Better dashboard**: No confusion with multiple metrics  
✅ **Faster debugging**: Directly correlate issues with user experience  
✅ **Cost reduction**: Fewer CloudWatch logs and metrics  

## Related Documentation

- [Architecture Overview](../ARCHITECTURE_OVERVIEW.md)
- [Sequence Diagram](../SEQUENCE_DIAGRAM.md)
- [Quick Reference](../QUICK_REFERENCE.md)
