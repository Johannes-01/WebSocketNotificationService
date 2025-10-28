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

class AckManager {
  /**
   * @param {WebSocket} websocket - The WebSocket connection
   * @param {number} timeout - Timeout in milliseconds (default: 5000ms)
   */
  constructor(websocket, timeout = 5000) {
    this.websocket = websocket;
    this.timeout = timeout;
    this.pendingAcks = new Map();
    
    // Listen for ACK messages
    this.originalOnMessage = websocket.onmessage;
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Handle ACK messages
      if (data.type === 'ack') {
        this._handleAck(data);
      }
      
      // Pass through to original handler
      if (this.originalOnMessage) {
        this.originalOnMessage(event);
      }
    };
  }

  /**
   * Generate a unique ACK ID
   * @returns {string} Unique ACK ID
   */
  _generateAckId() {
    return `ack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Handle incoming ACK message
   * @param {Object} ackData - ACK message data
   */
  _handleAck(ackData) {
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
   * @param {Object} message - Message to send (without requestAck/ackId)
   * @returns {Promise<Object>} Resolves with ACK data or rejects on timeout/error
   */
  sendWithAck(message) {
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
        reject(error);
      }
    });
  }

  /**
   * Send a message without waiting for ACK (fire-and-forget)
   * @param {Object} message - Message to send
   */
  send(message) {
    this.websocket.send(JSON.stringify(message));
  }

  /**
   * Get statistics about pending ACKs
   * @returns {Object} Statistics
   */
  getStats() {
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
  clearAll() {
    for (const [ackId, pending] of this.pendingAcks.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Connection closed or ACK manager cleared'));
    }
    this.pendingAcks.clear();
  }

  /**
   * Destroy the ACK manager and restore original WebSocket handler
   */
  destroy() {
    this.clearAll();
    this.websocket.onmessage = this.originalOnMessage;
  }
}

// Export for Node.js/CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AckManager;
}

// Export for ES6 modules
if (typeof exports !== 'undefined') {
  exports.AckManager = AckManager;
}

// Make available globally in browser
if (typeof window !== 'undefined') {
  window.AckManager = AckManager;
}
