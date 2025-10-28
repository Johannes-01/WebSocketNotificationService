/**
 * WebSocket ACK Manager
 * 
 * Utility class to manage acknowledgment (ACK) requests for WebSocket messages.
 * Handles ACK correlation, timeouts, and promise-based responses.
 * 
 * @example
 * const ackManager = new AckManager(websocket, 5000); // 5 second timeout
 * 
 * try {
 *   const ack = await ackManager.sendWithAck({
 *     action: 'sendMessage',
 *     targetChannel: 'WebSocket',
 *     messageType: 'fifo',
 *     payload: {
 *       chatId: 'chat-123',
 *       eventType: 'chat',
 *       content: 'Hello!'
 *     }
 *   });
 *   console.log('Message confirmed:', ack.messageId);
 * } catch (error) {
 *   console.error('Message failed:', error);
 * }
 */

export interface AckResponse {
  type: 'ack';
  ackId: string;
  status: 'success' | 'error';
  messageId?: string;
  messageType?: string;
  timestamp: string;
  snsMessageId?: string;
  sequenceNumber?: string | null;
  error?: string;
}

interface PendingAck {
  resolve: (value: AckResponse) => void;
  reject: (reason: Error) => void;
  timeoutId: NodeJS.Timeout;
  timestamp: number;
  message: any;
}

export class AckManager {
  private websocket: WebSocket;
  private timeout: number;
  private pendingAcks: Map<string, PendingAck>;
  private originalOnMessage: ((this: WebSocket, ev: MessageEvent) => any) | null;

  /**
   * @param websocket - The WebSocket connection
   * @param timeout - Timeout in milliseconds (default: 5000ms)
   */
  constructor(websocket: WebSocket, timeout: number = 5000) {
    this.websocket = websocket;
    this.timeout = timeout;
    this.pendingAcks = new Map();
    
    // Store and wrap the original onmessage handler
    this.originalOnMessage = websocket.onmessage;
    websocket.onmessage = (event: MessageEvent) => {
      let data: any;
      let parseError: Error | null = null;
      
      // Parse JSON once and reuse
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        parseError = e as Error;
      }
      
      // Handle ACK messages (if parsing succeeded)
      if (data && data.type === 'ack') {
        this._handleAck(data as AckResponse);
        // Don't pass ACK messages to the original handler
        // This prevents double processing in the UI
        return;
      }
      
      // Pass through to original handler
      if (this.originalOnMessage) {
        // If we already parsed successfully, we could optionally pass the parsed data
        // but to maintain compatibility, we call with the original event
        this.originalOnMessage.call(this.websocket, event);
      }
    };
  }

  /**
   * Generate a unique ACK ID
   * @returns Unique ACK ID
   */
  private _generateAckId(): string {
    return `ack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Handle incoming ACK message
   * @param ackData - ACK message data
   */
  private _handleAck(ackData: AckResponse): void {
    const pending = this.pendingAcks.get(ackData.ackId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingAcks.delete(ackData.ackId);
      
      if (ackData.status === 'success') {
        pending.resolve(ackData);
      } else {
        pending.reject(new Error(`ACK failed: ${ackData.error || 'Unknown error'}`));
      }
    }
  }

  /**
   * Send a message and wait for ACK
   * @param message - Message to send (without requestAck/ackId)
   * @returns Promise that resolves with ACK data or rejects on timeout/error
   */
  sendWithAck(message: any): Promise<AckResponse> {
    return new Promise((resolve, reject) => {
      const ackId = this._generateAckId();
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        if (this.pendingAcks.has(ackId)) {
          this.pendingAcks.delete(ackId);
          reject(new Error(`ACK timeout after ${this.timeout}ms - message may still be delivered`));
        }
      }, this.timeout);
      
      // Store pending ACK
      this.pendingAcks.set(ackId, {
        resolve,
        reject,
        timeoutId,
        timestamp: Date.now(),
        message,
      });
      
      // Send message with ACK request
      const messageWithAck = {
        ...message,
        requestAck: true,
        ackId: ackId,
      };
      
      try {
        this.websocket.send(JSON.stringify(messageWithAck));
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingAcks.delete(ackId);
        reject(error as Error);
      }
    });
  }

  /**
   * Send a message without waiting for ACK (fire-and-forget)
   * @param message - Message to send
   */
  send(message: any): void {
    this.websocket.send(JSON.stringify(message));
  }

  /**
   * Send multiple messages in parallel and wait for all ACKs
   * More efficient than sequential sending - sends all messages immediately
   * and waits for all ACKs to come back
   * 
   * @param messages - Array of messages to send
   * @returns Promise that resolves when all ACKs received or rejects if any fail
   */
  async sendBatchWithAck(messages: any[]): Promise<AckResponse[]> {
    const promises = messages.map(message => this.sendWithAck(message));
    return Promise.all(promises);
  }

  /**
   * Send multiple messages in parallel with individual error handling
   * Unlike sendBatchWithAck, this doesn't fail fast - it waits for all results
   * 
   * @param messages - Array of messages to send
   * @returns Promise with array of results (success or error for each message)
   */
  async sendBatchWithAckSettled(messages: any[]): Promise<Array<{
    status: 'fulfilled' | 'rejected';
    value?: AckResponse;
    reason?: Error;
  }>> {
    const promises = messages.map(message => this.sendWithAck(message));
    const results = await Promise.allSettled(promises);
    
    return results.map(result => ({
      status: result.status,
      value: result.status === 'fulfilled' ? result.value : undefined,
      reason: result.status === 'rejected' ? result.reason : undefined,
    }));
  }

  /**
   * Get statistics about pending ACKs
   * @returns Statistics object
   */
  getStats(): {
    pendingCount: number;
    oldestPendingAge: number;
    averagePendingAge: number;
  } {
    const now = Date.now();
    const pending = Array.from(this.pendingAcks.values());
    
    return {
      pendingCount: pending.length,
      oldestPendingAge: pending.length > 0 
        ? Math.max(...pending.map(p => now - p.timestamp))
        : 0,
      averagePendingAge: pending.length > 0
        ? pending.reduce((sum, p) => sum + (now - p.timestamp), 0) / pending.length
        : 0,
    };
  }

  /**
   * Clear all pending ACKs (e.g., on disconnect)
   */
  clearAll(): void {
    for (const [ackId, pending] of this.pendingAcks.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Connection closed or ACK manager cleared'));
    }
    this.pendingAcks.clear();
  }

  /**
   * Destroy the ACK manager and restore original WebSocket handler
   */
  destroy(): void {
    this.clearAll();
    this.websocket.onmessage = this.originalOnMessage;
  }
}
