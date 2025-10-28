/**
 * Metrics Service
 * Handles sending client-side END-TO-END LATENCY ONLY to the metric collector Lambda
 * 
 * Updated to use new simplified metric format
 */

interface E2ELatencyMetric {
  latency: number;           // Required: E2E latency in milliseconds
  messageId?: string;        // Optional: message identifier
  chatId?: string;          // Optional: chat identifier
}

class MetricsService {
  private metricsEndpoint: string;

  constructor() {
    this.metricsEndpoint = process.env.NEXT_PUBLIC_METRICS_ENDPOINT || '';
  }

  /**
   * Send end-to-end latency metric to the collector Lambda
   * New simplified format: only latency field is required
   */
  async sendMetric(data: E2ELatencyMetric, token: string): Promise<void> {
    if (!this.metricsEndpoint) {
      console.warn('Metrics endpoint not configured. Set NEXT_PUBLIC_METRICS_ENDPOINT in .env');
      return;
    }

    try {
      const response = await fetch(this.metricsEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to send E2E latency metric:', response.status, errorText);
      }
    } catch (error) {
      console.error('Error sending E2E latency metric:', error);
    }
  }

  /**
   * Calculate and send end-to-end latency
   * @param publishTimestamp - When the message was published (from message payload)
   * @param clientReceiveTime - When the client received the message (current time)
   * @param messageId - Optional message ID for correlation
   * @param chatId - Optional chat ID for correlation
   */
  async trackEndToEndLatency(
    publishTimestamp: Date,
    clientReceiveTime: Date,
    token: string,
    messageId?: string,
    chatId?: string
  ): Promise<void> {
    try {
      const publishTime = new Date(publishTimestamp);
      
      // End-to-end latency: publish → client
      const e2eLatency = clientReceiveTime.getTime() - publishTime.getTime();

      await this.sendMetric({
        latency: e2eLatency,
        messageId,
        chatId,
      }, token);
    } catch (error) {
      console.error('Error tracking E2E latency:', error);
    }
  }
}

// Singleton instance
export const metricsService = new MetricsService();
