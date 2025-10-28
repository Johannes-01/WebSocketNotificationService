/**
 * Metric Collector Lambda
 * Receives client-side END-TO-END LATENCY metrics only and logs them to CloudWatch
 * 
 * Expected payload format:
 * {
 *   "latency": 234.56,           // End-to-end latency in milliseconds (required)
 *   "messageId": "msg-123",      // Optional: message identifier
 *   "chatId": "chat-abc"         // Optional: chat identifier
 * }
 */

exports.handler = async (event) => {
  try {
    // Parse request body
    const payload = JSON.parse(event.body || '{}');

    // Validate required field: latency
    if (payload.latency === undefined || payload.latency === null) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Missing required field: latency (in milliseconds) is required',
          example: { latency: 234.56, messageId: 'optional', chatId: 'optional' }
        }),
      };
    }

    const latencyMs = parseFloat(payload.latency);

    // Validate latency is a positive number
    if (isNaN(latencyMs) || latencyMs < 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Invalid latency value: must be a positive number',
        }),
      };
    }

    // Extract optional metadata
    const userId = event.requestContext?.authorizer?.claims?.sub || 'unknown';
    const messageId = payload.messageId || 'unknown';
    const chatId = payload.chatId || 'unknown';

    // Log structured metric for CloudWatch metric filter
    console.log(JSON.stringify({
      event_type: 'end_to_end_latency',
      latency_ms: latencyMs,
      user_id: userId,
      message_id: messageId,
      chat_id: chatId,
      timestamp: new Date().toISOString(),
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        message: 'metric recorded successfully',
        latency_ms: latencyMs,
      }),
    };
  } catch (error) {
    console.error('Error processing E2E latency metric:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to record latency metric',
        details: error.message,
      }),
    };
  }
};
