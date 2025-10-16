/**
 * Metrics Service
 * Handles sending client-side performance metrics to the metric collector Lambda
 */

interface MetricData {
  metricName: 'EndToEndLatency' | 'NetworkLatency' | 'Jitter' | 'MessageLoss';
  value: number;
  clientId?: string;
  metadata?: Record<string, any>;
}

class MetricsService {
  private metricsEndpoint: string;
  private lastLatency: number | null = null;
  private clientId: string;

  constructor() {
    this.metricsEndpoint = process.env.NEXT_PUBLIC_METRICS_ENDPOINT || '';
    this.clientId = this.generateClientId();
  }

  private generateClientId(): string {
    // Generate a unique client ID for this session
    return `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Send a metric to the collector Lambda
   */
  async sendMetric(data: MetricData, token: string): Promise<void> {
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
        body: JSON.stringify({
          ...data,
          clientId: data.clientId || this.clientId,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        console.error('Failed to send metric:', response.statusText);
      }
    } catch (error) {
      console.error('Error sending metric:', error);
    }
  }

  /**
   * Calculate and send end-to-end latency
   * @param publishTimestamp - When the message was published (from message payload)
   * @param processorTimestamp - When the processor handled the message (from message payload)
   * @param clientReceiveTime - When the client received the message (current time)
   */
  async trackEndToEndLatency(
    publishTimestamp: string,
    processorTimestamp: string,
    clientReceiveTime: Date,
    token: string
  ): Promise<void> {
    try {
      const publishTime = new Date(publishTimestamp);
      const processorTime = new Date(processorTimestamp);
      
      // End-to-end latency: publish → client
      const e2eLatency = clientReceiveTime.getTime() - publishTime.getTime();
      
      // Network latency: processor → client
      const networkLatency = clientReceiveTime.getTime() - processorTime.getTime();

      // Send E2E latency
      await this.sendMetric({
        metricName: 'EndToEndLatency',
        value: e2eLatency,
        metadata: {
          publishTimestamp,
          processorTimestamp,
          clientReceiveTime: clientReceiveTime.toISOString(),
        },
      }, token);

      // Send network latency
      await this.sendMetric({
        metricName: 'NetworkLatency',
        value: networkLatency,
        metadata: {
          processorTimestamp,
          clientReceiveTime: clientReceiveTime.toISOString(),
        },
      }, token);

      // Calculate and send jitter (variance between consecutive message latencies)
      if (this.lastLatency !== null) {
        const jitter = Math.abs(e2eLatency - this.lastLatency);
        await this.sendMetric({
          metricName: 'Jitter',
          value: jitter,
          metadata: {
            currentLatency: e2eLatency,
            previousLatency: this.lastLatency,
          },
        }, token);
      }

      this.lastLatency = e2eLatency;

      console.log(`📊 Metrics tracked - E2E: ${e2eLatency}ms, Network: ${networkLatency}ms`);
    } catch (error) {
      console.error('Error tracking latency:', error);
    }
  }

  /**
   * Track message loss (when expected sequence numbers are missing)
   */
  async trackMessageLoss(
    expectedSequence: number,
    receivedSequence: number,
    token: string
  ): Promise<void> {
    const lossCount = receivedSequence - expectedSequence;
    if (lossCount > 0) {
      await this.sendMetric({
        metricName: 'MessageLoss',
        value: lossCount,
        metadata: {
          expectedSequence,
          receivedSequence,
        },
      }, token);
      console.warn(`⚠️ Message loss detected: ${lossCount} messages missing`);
    }
  }

  getClientId(): string {
    return this.clientId;
  }
}

// Singleton instance
export const metricsService = new MetricsService();
