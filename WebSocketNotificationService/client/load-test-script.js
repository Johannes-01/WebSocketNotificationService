#!/usr/bin/env node

/**
 * End-to-End Latency Load Testing Script
 * 
 * This script measures end-to-end latency under load by:
 * 1. Sending 1000 messages simultaneously to different chats
 * 2. Using both A2P (HTTP REST API) with different HTTP clients
 * 3. Using P2P (WebSocket) with different WebSocket connections
 * 4. Measuring latency from client publish timestamp to message receipt
 * 
 * Prerequisites:
 * - Node.js installed
 * - npm install ws node-fetch
 * - Valid Cognito credentials in .env file
 * 
 * Usage:
 * node load-test-script.js
 */

const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================

// Load environment variables from .env.local file
function loadEnvFile() {
  const envPath = path.join(__dirname, 'websocket-tester', '.env.local');
  
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env.local file not found at:', envPath);
    console.error('Please create .env.local with the following variables:');
    console.error('  NEXT_PUBLIC_WEBSOCKET_ENDPOINT=wss://...');
    console.error('  NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT=https://...');
    console.error('  NEXT_PUBLIC_COGNITO_USER_POOL_ID=...');
    console.error('  NEXT_PUBLIC_COGNITO_CLIENT_ID=...');
    console.error('  TEST_USERNAME=...');
    console.error('  TEST_PASSWORD=...');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, ''); // Remove quotes
      process.env[key] = value;
    }
  });
}

loadEnvFile();

const CONFIG = {
  // WebSocket and HTTP endpoints
  WEBSOCKET_ENDPOINT: process.env.NEXT_PUBLIC_WEBSOCKET_ENDPOINT,
  HTTP_ENDPOINT: process.env.NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT,
  METRICS_ENDPOINT: null,  // Will be derived from HTTP_ENDPOINT
  
  // Cognito configuration
  USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
  CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
  
  // Test credentials (add these to .env.local)
  TEST_USERNAME: process.env.TEST_USERNAME,
  TEST_PASSWORD: process.env.TEST_PASSWORD,
  
  // Load test parameters
  NUM_MESSAGES: 100,          // Total messages to send
  NUM_CHATS: 1,               // Single chat for focused testing
  USERS_PER_CHAT: 2,          // 2 users per chat
  
  // Message distribution
  A2P_MESSAGE_RATIO: 0.5,     // 50% A2P (HTTP), 50% P2P (WebSocket)
  
  // Test configuration
  MESSAGE_TYPE: 'standard',       // Standard queue for parallel sending
  TIMEOUT_MS: 120000,         // 120 second timeout for all messages
  RUN_PARALLEL: false,        // Run A2P and P2P tests in parallel
  
  // Throughput test configuration
  THROUGHPUT_TEST_MODE: true,
  TARGET_P95_MS: 800,                  // Target P95 latency in milliseconds
  THROUGHPUT_START_MSG_PER_SEC: 10,    
  THROUGHPUT_INCREMENT_MSG_PER_SEC: 10,
  THROUGHPUT_MAX_MSG_PER_SEC: 1000,     
  THROUGHPUT_TEST_DURATION_SEC: 10,
  
  // Test selection - set only ONE to true, or both for mixed testing
  RUN_A2P: false,             // Disable A2P (HTTP) tests
  RUN_P2P: true,              // Enable P2P (WebSocket) tests - instant burst
  
  // ACK configuration
  P2P_ACK_TIMEOUT_MS: 5000,    // 5 second timeout for P2P WebSocket ACK
  REQUEST_ACK: false,          // Disable ACK for instant parallel sending
  
  // Message receipt tracking
  get WAIT_FOR_RECEIPT() {
    // False - fire-and-forget for instant parallel sending
    return false;
  },
  RECEIPT_TIMEOUT_MS: 15000,  // 15 second timeout for message receipt
  
  // Metric collection
  SEND_METRICS_TO_CLOUDWATCH: false,  // Disabled - we measure latency locally
  METRICS_BATCH_SIZE: 50,           // Send metrics in batches to avoid overwhelming the API
  
  // Derived values (calculated automatically)
  get TOTAL_USERS() {
    return this.NUM_CHATS * this.USERS_PER_CHAT;  // 10 × 5 = 50 users
  },
  get MESSAGES_PER_CHAT() {
    return Math.ceil(this.NUM_MESSAGES / this.NUM_CHATS);  // 1000 / 10 = 100
  },
  get A2P_MESSAGES() {
    // If only A2P, send all messages via A2P
    if (this.RUN_A2P && !this.RUN_P2P) return this.NUM_MESSAGES;
    // If only P2P, send no A2P messages
    if (!this.RUN_A2P && this.RUN_P2P) return 0;
    // If both, use the ratio
    return Math.ceil(this.NUM_MESSAGES * this.A2P_MESSAGE_RATIO);
  },
  get P2P_MESSAGES() {
    // If only P2P, send all messages via P2P
    if (this.RUN_P2P && !this.RUN_A2P) return this.NUM_MESSAGES;
    // If only A2P, send no P2P messages
    if (!this.RUN_P2P && this.RUN_A2P) return 0;
    // If both, use the remainder
    return this.NUM_MESSAGES - this.A2P_MESSAGES;
  },
};

// Validate configuration
function validateConfig() {
  const required = [
    'WEBSOCKET_ENDPOINT',
    'HTTP_ENDPOINT',
    'USER_POOL_ID',
    'CLIENT_ID',
    'TEST_USERNAME',
    'TEST_PASSWORD'
  ];
  
  const missing = required.filter(key => !CONFIG[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required configuration:');
    missing.forEach(key => console.error(`  - ${key}`));
    process.exit(1);
  }
  
  // Derive metrics endpoint from HTTP endpoint
  // Example: https://abc123.execute-api.us-east-1.amazonaws.com/prod/publish
  //       -> https://abc123.execute-api.us-east-1.amazonaws.com/prod/metrics
  if (CONFIG.HTTP_ENDPOINT) {
    const baseUrl = CONFIG.HTTP_ENDPOINT.replace(/\/[^\/]+$/, ''); // Remove last path segment
    CONFIG.METRICS_ENDPOINT = `${baseUrl}/metrics`;
    console.log(`📊 Metrics endpoint: ${CONFIG.METRICS_ENDPOINT}`);
  }
}

validateConfig();

// ============================================================================
// Cognito Authentication Helper
// ============================================================================

async function getCognitoToken() {
  console.log('🔐 Authenticating with Cognito...');
  
  // For simplicity, using AWS SDK for Cognito
  // In production, use amazon-cognito-identity-js
  const AWS = require('aws-sdk');
  const AmazonCognitoIdentity = require('amazon-cognito-identity-js');
  
  const poolData = {
    UserPoolId: CONFIG.USER_POOL_ID,
    ClientId: CONFIG.CLIENT_ID
  };
  
  const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
  
  const authenticationData = {
    Username: CONFIG.TEST_USERNAME,
    Password: CONFIG.TEST_PASSWORD,
  };
  
  const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(authenticationData);
  
  const userData = {
    Username: CONFIG.TEST_USERNAME,
    Pool: userPool
  };
  
  const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
  
  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (result) => {
        const idToken = result.getIdToken().getJwtToken();
        console.log('✅ Authentication successful');
        resolve(idToken);
      },
      onFailure: (err) => {
        console.error('❌ Authentication failed:', err);
        reject(err);
      }
    });
  });
}

// ============================================================================
// Latency Tracking
// ============================================================================

class LatencyTracker {
  constructor(testName) {
    this.testName = testName;
    this.latencies = [];
    this.errors = [];
    this.startTime = null;
    this.endTime = null;
    this.metricsQueue = [];  // Queue for batching CloudWatch metrics
    this.metricsSent = 0;
    this.metricsErrors = 0;
  }

  start() {
    this.startTime = Date.now();
  }

  recordLatency(latency, metadata = {}) {
    this.latencies.push({
      latency,
      timestamp: Date.now(),
      ...metadata
    });
    
    // Add to metrics queue for CloudWatch
    if (CONFIG.SEND_METRICS_TO_CLOUDWATCH) {
      this.metricsQueue.push({
        latency,
        messageId: metadata.messageId,
        chatId: metadata.chatId
      });
    }
  }

  recordError(error, metadata = {}) {
    this.errors.push({
      error: error.message || String(error),
      timestamp: Date.now(),
      ...metadata
    });
  }
  
  /**
   * Send metrics to CloudWatch in batches
   */
  async flushMetrics(token) {
    if (!CONFIG.SEND_METRICS_TO_CLOUDWATCH || this.metricsQueue.length === 0) {
      return;
    }
    
    const batch = this.metricsQueue.splice(0, CONFIG.METRICS_BATCH_SIZE);
    
    const promises = batch.map(async (metric) => {
      try {
        const response = await fetch(CONFIG.METRICS_ENDPOINT, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            latency: metric.latency,
            messageId: metric.messageId,
            chatId: metric.chatId
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        this.metricsSent++;
      } catch (error) {
        this.metricsErrors++;
        console.error(`Failed to send metric to CloudWatch:`, error.message);
      }
    });
    
    await Promise.all(promises);
  }
  
  /**
   * Send all remaining metrics
   */
  async flushAllMetrics(token) {
    if (!CONFIG.SEND_METRICS_TO_CLOUDWATCH) {
      return;
    }
    
    console.log(`\n📊 Sending ${this.metricsQueue.length} metrics to CloudWatch...`);
    
    while (this.metricsQueue.length > 0) {
      await this.flushMetrics(token);
    }
    
    console.log(`✅ Sent ${this.metricsSent} metrics to CloudWatch (${this.metricsErrors} errors)`);
  }

  finish() {
    this.endTime = Date.now();
  }

  getStats() {
    const sortedLatencies = this.latencies.map(l => l.latency).sort((a, b) => a - b);
    const count = sortedLatencies.length;
    
    if (count === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        p95: 0,
        p99: 0,
        totalDuration: this.endTime - this.startTime,
        errorCount: this.errors.length
      };
    }

    const sum = sortedLatencies.reduce((a, b) => a + b, 0);
    
    return {
      count,
      min: sortedLatencies[0],
      max: sortedLatencies[count - 1],
      mean: sum / count,
      median: sortedLatencies[Math.floor(count / 2)],
      p95: sortedLatencies[Math.floor(count * 0.95)],
      p99: sortedLatencies[Math.floor(count * 0.99)],
      totalDuration: this.endTime - this.startTime,
      errorCount: this.errors.length,
      throughput: (count / ((this.endTime - this.startTime) / 1000)).toFixed(2)
    };
  }

  printReport() {
    const stats = this.getStats();
    
    // Calculate expected messages based on what was actually sent
    const actualMessagesSent = (CONFIG.RUN_A2P ? CONFIG.A2P_MESSAGES : 0) + (CONFIG.RUN_P2P ? CONFIG.P2P_MESSAGES : 0);
    const expectedReceivedMessages = actualMessagesSent * CONFIG.USERS_PER_CHAT;
    
    console.log('\n' + '='.repeat(70));
    console.log(`📊 ${this.testName} - Test Results`);
    console.log('='.repeat(70));
    console.log(`Messages Sent:      ${actualMessagesSent} (${CONFIG.A2P_MESSAGES} A2P + ${CONFIG.P2P_MESSAGES} P2P)`);
    console.log(`Expected Received:  ${expectedReceivedMessages} (${actualMessagesSent} × ${CONFIG.USERS_PER_CHAT} users/chat)`);
    console.log(`Actually Received:  ${stats.count}`);
    console.log(`Delivery Rate:      ${expectedReceivedMessages > 0 ? ((stats.count / expectedReceivedMessages) * 100).toFixed(2) : 0}%`);
    console.log(`Errors:             ${stats.errorCount}`);
    console.log(`Total Duration:     ${stats.totalDuration}ms (${(stats.totalDuration / 1000).toFixed(2)}s)`);
    console.log(`Throughput:         ${stats.throughput} msg/sec (received)`);
    console.log(`Send Rate:          ${actualMessagesSent > 0 ? (actualMessagesSent / (stats.totalDuration / 1000)).toFixed(2) : 0} msg/sec (sent)`);
    
    if (CONFIG.SEND_METRICS_TO_CLOUDWATCH) {
      console.log(`\nCloudWatch Metrics:`);
      console.log(`  Sent:             ${this.metricsSent}`);
      console.log(`  Errors:           ${this.metricsErrors}`);
      console.log(`  Success Rate:     ${this.metricsSent > 0 ? ((this.metricsSent / (this.metricsSent + this.metricsErrors)) * 100).toFixed(2) : 0}%`);
    }
    
    console.log('\nLatency Statistics (ms):');
    console.log(`  Min:      ${stats.min.toFixed(2)}`);
    console.log(`  Max:      ${stats.max.toFixed(2)}`);
    console.log(`  Mean:     ${stats.mean.toFixed(2)}`);
    console.log(`  Median:   ${stats.median.toFixed(2)}`);
    console.log(`  P95:      ${stats.p95.toFixed(2)}`);
    console.log(`  P99:      ${stats.p99.toFixed(2)}`);
    
    if (stats.errorCount > 0) {
      console.log('\n⚠️  Errors:');
      
      // Group errors by type for better analysis
      const errorGroups = {};
      this.errors.forEach(err => {
        const errorType = err.type || 'unknown';
        if (!errorGroups[errorType]) {
          errorGroups[errorType] = [];
        }
        errorGroups[errorType].push(err);
      });
      
      // Print error summary by type
      Object.keys(errorGroups).forEach(type => {
        const count = errorGroups[type].length;
        console.log(`\n  ${type.toUpperCase()}: ${count} errors`);
        
        // Show first 3 examples of each type
        errorGroups[type].slice(0, 3).forEach((err, idx) => {
          console.log(`    ${idx + 1}. ${err.error}`);
          if (err.messageIndex !== undefined) {
            console.log(`       Message Index: ${err.messageIndex}`);
          }
          if (err.chatId) {
            console.log(`       Chat ID: ${err.chatId}`);
          }
        });
        
        if (errorGroups[type].length > 3) {
          console.log(`    ... and ${errorGroups[type].length - 3} more ${type} errors`);
        }
      });
    }
    
    console.log('='.repeat(70) + '\n');
    
    return stats;
  }

  exportToCSV(filename) {
    const csvHeader = 'Latency (ms),Chat ID,Message Index,Timestamp\n';
    const csvRows = this.latencies.map(l => 
      `${l.latency},${l.chatId || ''},${l.messageIndex || ''},${l.timestamp}`
    ).join('\n');
    
    const csvContent = csvHeader + csvRows;
    fs.writeFileSync(filename, csvContent);
    console.log(`📁 Latency data exported to: ${filename}`);
  }
  
  exportErrorsToFile(filename) {
    if (this.errors.length === 0) {
      return;
    }
    
    const errorHeader = 'Error Type,Error Message,Message Index,Chat ID,User ID,Timestamp\n';
    const errorRows = this.errors.map(e => 
      `${e.type || 'unknown'},"${e.error}",${e.messageIndex || ''},${e.chatId || ''},${e.userId || ''},${e.timestamp}`
    ).join('\n');
    
    const errorContent = errorHeader + errorRows;
    fs.writeFileSync(filename, errorContent);
    console.log(`📁 Error data exported to: ${filename}`);
  }
}

// ============================================================================
// Production-Like Load Test (Parallel A2P + P2P)
// ============================================================================

/**
 * Setup chat room connections
 * Creates USERS_PER_CHAT WebSocket connections for each chat
 * Each user only subscribes to their assigned chat (realistic)
 * 
 * Note: WebSocket connections are only created if needed (for receiving messages)
 */
async function setupChatRoomConnections(token) {
  const connections = [];
  const pendingAcks = new Map();  // For backward compatibility
  const pendingReceipts = new Map();  // Track pending message receipts
  const receivedMessages = new Map();
  const tracker = new LatencyTracker('Production Load Test');
  
  // Only set up WebSocket connections if we're actually sending messages
  // (both A2P and P2P need receivers to measure latency)
  const needsWebSockets = CONFIG.RUN_A2P || CONFIG.RUN_P2P;
  
  if (!needsWebSockets) {
    console.log('⏭️  Skipping WebSocket setup (no tests enabled)');
    return { connections, pendingAcks, pendingReceipts, receivedMessages, tracker };
  }
  
  console.log(`\n📡 Setting up ${CONFIG.TOTAL_USERS} WebSocket connections...`);
  console.log(`   ${CONFIG.NUM_CHATS} chats × ${CONFIG.USERS_PER_CHAT} users per chat`);
  
  for (let chatIdx = 0; chatIdx < CONFIG.NUM_CHATS; chatIdx++) {
    const chatId = `chat-${chatIdx}`;
    
    for (let userIdx = 0; userIdx < CONFIG.USERS_PER_CHAT; userIdx++) {
      const userId = chatIdx * CONFIG.USERS_PER_CHAT + userIdx;
      
      const ws = new WebSocket(
        `${CONFIG.WEBSOCKET_ENDPOINT}?token=${token}&chatIds=${chatId}`  // Subscribe to ONLY one chat
      );
      
      // Setup message handler
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          // Handle ACK messages (for backward compatibility)
          if (message.type === 'ack') {
            const pending = pendingAcks.get(message.ackId);
            if (pending) {
              clearTimeout(pending.timeout);
              pendingAcks.delete(message.ackId);
              pending.resolve(message);
            }
            return;
          }
          
          // Skip non-message events
          if (!message.clientPublishTimestamp) {
            return;
          }
          
          const publishTime = new Date(message.clientPublishTimestamp).getTime();
          const receiveTime = Date.now();
          const latency = receiveTime - publishTime;
          
          tracker.recordLatency(latency, {
            chatId: message.chatId,
            messageId: message.messageId,
            messageIndex: message.messageIndex,
            userId: userId,
            testType: message.testType
          });
          
          // Track unique receptions: use combination of messageIndex + userId to count each user's reception
          // This allows multiple users to receive the same message and be counted separately
          const receptionKey = `${message.messageIndex}-${userId}`;
          receivedMessages.set(receptionKey, true);
          
          // Resolve pending receipt promises for this message index
          const receiptPromise = pendingReceipts.get(message.messageIndex);
          if (receiptPromise) {
            clearTimeout(receiptPromise.timeout);
            pendingReceipts.delete(message.messageIndex);
            receiptPromise.resolve({ latency, receiveTime });
          }
          
          // Periodically flush metrics to CloudWatch
          if (tracker.metricsQueue.length >= CONFIG.METRICS_BATCH_SIZE) {
            tracker.flushMetrics(token).catch(err => {
              console.error('Failed to flush metrics:', err.message);
            });
          }
        } catch (error) {
          tracker.recordError(error);
        }
      });
      
      connections.push({
        ws,
        userId,
        chatId,
        chatIdx,
        userIdx
      });
    }
  }
  
  // Wait for all connections to open
  await Promise.all(connections.map(conn => {
    return new Promise((resolve, reject) => {
      conn.ws.on('open', resolve);
      conn.ws.on('error', reject);
    });
  }));
  
  console.log(`✅ ${CONFIG.TOTAL_USERS} WebSocket connections established`);
  
  return { connections, pendingAcks, pendingReceipts, receivedMessages, tracker };
}

/**
 * Run production-like load test with parallel A2P and P2P messages
 */
async function runProductionLoadTest(token) {
  console.log('\n🚀 Starting Production-Like Load Test...');
  console.log(`   Total Messages:    ${CONFIG.NUM_MESSAGES}`);
  console.log(`   A2P Messages:      ${CONFIG.A2P_MESSAGES} (HTTP)`);
  console.log(`   P2P Messages:      ${CONFIG.P2P_MESSAGES} (WebSocket)`);
  console.log(`   Chats:             ${CONFIG.NUM_CHATS}`);
  console.log(`   Users per Chat:    ${CONFIG.USERS_PER_CHAT}`);
  console.log(`   Total Users:       ${CONFIG.TOTAL_USERS}`);
  console.log(`   Mode:              ${CONFIG.RUN_PARALLEL ? 'PARALLEL' : 'SEQUENTIAL'}`);
  console.log(`   ACK Timeout:       ${CONFIG.P2P_ACK_TIMEOUT_MS}ms`);
  
  // Setup all WebSocket connections (chat rooms)
  const { connections, pendingAcks, pendingReceipts, receivedMessages, tracker } = await setupChatRoomConnections(token);
  
  tracker.start();
  
  // Determine which tests to run
  const testsToRun = [];
  if (CONFIG.RUN_A2P) {
    testsToRun.push({ name: 'A2P', fn: () => sendA2PMessages(token, connections, pendingReceipts, tracker) });
  }
  if (CONFIG.RUN_P2P) {
    testsToRun.push({ name: 'P2P', fn: () => sendP2PMessages(connections, pendingAcks, pendingReceipts, tracker) });
  }
  
  if (testsToRun.length === 0) {
    console.error('❌ No tests selected! Please set RUN_A2P or RUN_P2P to true.');
    throw new Error('No tests configured to run');
  }
  
  if (CONFIG.RUN_PARALLEL && testsToRun.length === 2) {
    // Run A2P and P2P tests in parallel (production-like)
    console.log('\n⚡ Running A2P and P2P tests in PARALLEL...');
    
    await Promise.all(testsToRun.map(test => test.fn()));
    
    console.log('✅ All messages sent (A2P + P2P in parallel)');
  } else {
    // Sequential mode or single test
    for (const test of testsToRun) {
      console.log(`\n📊 Running ${test.name} test...`);
      await test.fn();
    }
    
    if (testsToRun.length === 2) {
      console.log('✅ All messages sent (A2P then P2P sequentially)');
    } else {
      console.log(`✅ All messages sent (${testsToRun[0].name} only)`);
    }
  }
  
  // Wait for all messages to arrive
  const actualMessagesSent = (CONFIG.RUN_A2P ? CONFIG.A2P_MESSAGES : 0) + (CONFIG.RUN_P2P ? CONFIG.P2P_MESSAGES : 0);
  const expectedMessages = actualMessagesSent * CONFIG.USERS_PER_CHAT;
  await waitForMessages(receivedMessages, expectedMessages, CONFIG.TIMEOUT_MS);
  
  tracker.finish();
  
  // Send all remaining metrics to CloudWatch
  await tracker.flushAllMetrics(token);
  
  // Close all connections (if any were created)
  if (connections.length > 0) {
    connections.forEach(conn => conn.ws.close());
    console.log(`🔌 Closed ${connections.length} WebSocket connections`);
  }
  
  const stats = tracker.printReport();
  tracker.exportToCSV(`production-latency-${Date.now()}.csv`);
  
  // Export errors if any occurred
  if (tracker.errors.length > 0) {
    tracker.exportErrorsToFile(`production-errors-${Date.now()}.csv`);
  }
  
  // Per-chat statistics
  printPerChatStatistics(tracker);
  
  return stats;
}

/**
 * Send A2P messages (HTTP REST API)
 * Strategy depends on message type:
 * - Standard: Sequential globally (one message at a time across all chats)
 * - FIFO: Sequential per chat (parallel across chats, sequential within each chat)
 */
async function sendA2PMessages(token, connections, pendingReceipts, tracker) {
  if (!CONFIG.RUN_A2P || CONFIG.A2P_MESSAGES === 0) {
    console.log('⏭️  Skipping A2P messages (disabled or 0 messages)');
    return;
  }
  
  if (CONFIG.MESSAGE_TYPE === 'standard') {
    // Standard: Global sequential sending
    console.log(`📤 Sending ${CONFIG.A2P_MESSAGES} A2P messages (SEQUENTIAL globally for standard messages)`);
    
    for (let i = 0; i < CONFIG.A2P_MESSAGES; i++) {
      const chatIdx = i % CONFIG.NUM_CHATS;
      const chatId = `chat-${chatIdx}`;
      
      const message = {
        targetChannel: 'WebSocket',
        messageType: CONFIG.MESSAGE_TYPE,
        payload: {
          chatId,
          eventType: 'load-test',
          content: `A2P Test - Message ${i}`,
          clientPublishTimestamp: new Date().toISOString(),
          messageIndex: i,
          testType: 'a2p'
        }
      };
      
      try {
        // Send HTTP request
        const response = await fetch(CONFIG.HTTP_ENDPOINT, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message)
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        await response.json();
        
        // Wait for message to be received (standard message behavior)
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (pendingReceipts.has(i)) {
              pendingReceipts.delete(i);
              reject(new Error(`Receipt timeout for A2P message ${i}`));
            }
          }, CONFIG.RECEIPT_TIMEOUT_MS);
          
          pendingReceipts.set(i, { resolve, reject, timeout, messageIndex: i });
        });
        
        // Progress indicator (every 50 messages)
        if (i % 50 === 0 && i > 0) {
          console.log(`   A2P: ${i}/${CONFIG.A2P_MESSAGES} sent`);
        }
      } catch (error) {
        console.error(`❌ A2P Error at message ${i}:`, error.message);
        tracker.recordError(error, { messageIndex: i, chatId, type: 'a2p' });
      }
    }
    
    console.log(`✅ A2P: ${CONFIG.A2P_MESSAGES} messages sent (sequential)`);
  } else {
    // FIFO: Per-chat sequential sending (parallel across chats)
    console.log(`📤 Sending ${CONFIG.A2P_MESSAGES} A2P messages (PARALLEL per chat, SEQUENTIAL within chat for FIFO)`);
    
    const messagesPerChat = Math.ceil(CONFIG.A2P_MESSAGES / CONFIG.NUM_CHATS);
    const chatPromises = [];
    
    for (let chatIdx = 0; chatIdx < CONFIG.NUM_CHATS; chatIdx++) {
      const chatId = `chat-${chatIdx}`;
      
      // Each chat sends messages sequentially
      const chatPromise = (async () => {
        for (let msgIdx = 0; msgIdx < messagesPerChat; msgIdx++) {
          const globalIndex = chatIdx * messagesPerChat + msgIdx;
          if (globalIndex >= CONFIG.A2P_MESSAGES) break;
          
          const message = {
            targetChannel: 'WebSocket',
            messageType: CONFIG.MESSAGE_TYPE,
            payload: {
              chatId,
              eventType: 'load-test',
              content: `A2P Test - Chat ${chatIdx} Message ${msgIdx}`,
              clientPublishTimestamp: new Date().toISOString(),
              messageIndex: globalIndex,
              testType: 'a2p'
            }
          };
          
          try {
            // Send HTTP request
            const response = await fetch(CONFIG.HTTP_ENDPOINT, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(message)
            });
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            await response.json();
            
            // FIFO: Wait for message receipt within this chat
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                if (pendingReceipts.has(globalIndex)) {
                  pendingReceipts.delete(globalIndex);
                  reject(new Error(`Receipt timeout for A2P message ${globalIndex}`));
                }
              }, CONFIG.RECEIPT_TIMEOUT_MS);
              
              pendingReceipts.set(globalIndex, { resolve, reject, timeout, messageIndex: globalIndex });
            });
            
            // Progress indicator (every 10 messages per chat)
            if (msgIdx % 10 === 0 && msgIdx > 0) {
              console.log(`   A2P Chat ${chatIdx}: ${msgIdx}/${messagesPerChat} sent`);
            }
          } catch (error) {
            console.error(`❌ A2P Error at chat ${chatIdx}, message ${globalIndex}:`, error.message);
            tracker.recordError(error, { messageIndex: globalIndex, chatId, type: 'a2p' });
          }
        }
      })();
      
      chatPromises.push(chatPromise);
    }
    
    // Wait for all chats to complete
    await Promise.all(chatPromises);
    console.log(`✅ A2P: ${CONFIG.A2P_MESSAGES} messages sent across ${CONFIG.NUM_CHATS} chats`);
  }
}

/**
 * Send P2P messages (WebSocket)
 * Instant parallel burst mode - sends all messages immediately
 */
async function sendP2PMessages(connections, pendingAcks, pendingReceipts, tracker) {
  if (!CONFIG.RUN_P2P || CONFIG.P2P_MESSAGES === 0) {
    console.log('⏭️  Skipping P2P messages (disabled or 0 messages)');
    return;
  }
  
  // Instant parallel sending for burst test
  console.log(`📤 Sending ${CONFIG.P2P_MESSAGES} P2P messages INSTANTLY (parallel burst)`);
  
  const sendPromises = [];
  
  for (let i = 0; i < CONFIG.P2P_MESSAGES; i++) {
    const globalIndex = CONFIG.A2P_MESSAGES + i;
    const userIdx = i % CONFIG.TOTAL_USERS; // Distribute across all users
    const conn = connections[userIdx];
    
    const message = {
      action: 'sendMessage',
      targetChannel: 'WebSocket',
      messageType: CONFIG.MESSAGE_TYPE,
      requestAck: CONFIG.REQUEST_ACK,
      payload: {
        chatId: conn.chatId,
        eventType: 'load-test',
        content: `P2P Burst Test - Message ${i}`,
        clientPublishTimestamp: new Date().toISOString(),
        messageIndex: globalIndex,
        testType: 'p2p'
      }
    };
    
    // Send all messages in parallel without waiting
    const sendPromise = new Promise((resolve, reject) => {
      try {
        conn.ws.send(JSON.stringify(message));
        resolve();
      } catch (error) {
        console.error(`❌ P2P Error at message ${globalIndex}:`, error.message);
        tracker.recordError(error, { 
          messageIndex: globalIndex, 
          userId: conn.userId, 
          chatId: conn.chatId, 
          type: 'send_error' 
        });
        reject(error);
      }
    });
    
    sendPromises.push(sendPromise.catch(() => {})); // Swallow errors to continue
  }
  
  // Wait for all messages to be sent
  await Promise.all(sendPromises);
  
  console.log(`✅ P2P: ${CONFIG.P2P_MESSAGES} messages sent INSTANTLY (parallel burst)`);
}

/**
 * Print per-chat statistics
 */
function printPerChatStatistics(tracker) {
  console.log('\n' + '='.repeat(70));
  console.log('📊 Per-Chat Statistics');
  console.log('='.repeat(70));
  
  const chatStats = {};
  
  // Group latencies by chat
  tracker.latencies.forEach(entry => {
    const chatId = entry.chatId || 'unknown';
    if (!chatStats[chatId]) {
      chatStats[chatId] = {
        latencies: [],
        a2pCount: 0,
        p2pCount: 0
      };
    }
    chatStats[chatId].latencies.push(entry.latency);
    if (entry.testType === 'a2p') {
      chatStats[chatId].a2pCount++;
    } else if (entry.testType === 'p2p') {
      chatStats[chatId].p2pCount++;
    }
  });
  
  // Print statistics for each chat
  Object.keys(chatStats).sort().forEach(chatId => {
    const stats = chatStats[chatId];
    const sorted = stats.latencies.sort((a, b) => a - b);
    const count = sorted.length;
    
    if (count === 0) return;
    
    const mean = sorted.reduce((a, b) => a + b, 0) / count;
    const median = sorted[Math.floor(count / 2)];
    const p95 = sorted[Math.floor(count * 0.95)];
    
    console.log(`\n${chatId}:`);
    console.log(`  Messages:  ${count} (A2P: ${stats.a2pCount}, P2P: ${stats.p2pCount})`);
    console.log(`  Mean:      ${mean.toFixed(2)} ms`);
    console.log(`  Median:    ${median.toFixed(2)} ms`);
    console.log(`  P95:       ${p95.toFixed(2)} ms`);
  });
  
  console.log('='.repeat(70) + '\n');
}

// ============================================================================
// Legacy A2P and P2P Tests (for backward compatibility)
// ============================================================================

async function runA2PLoadTest(token) {
  console.log('\n🚀 Starting A2P (HTTP) Load Test...');
  console.log(`   Clients: ${CONFIG.NUM_HTTP_CLIENTS}`);
  console.log(`   Messages: ${CONFIG.NUM_MESSAGES}`);
  console.log(`   Chats: ${CONFIG.NUM_CHATS}`);
  
  const tracker = new LatencyTracker('A2P (HTTP REST)');
  
  // Create WebSocket connection to receive messages
  const ws = new WebSocket(
    `${CONFIG.WEBSOCKET_ENDPOINT}?token=${token}&chatIds=${generateChatIds().join(',')}`
  );
  
  // Track received messages
  const receivedMessages = new Map();
  
  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('✅ WebSocket receiver connected');
      resolve();
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      reject(error);
    });
  });
  
  // Listen for incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Skip non-message events
      if (message.type === 'ack' || !message.clientPublishTimestamp) {
        return;
      }
      
      const publishTime = new Date(message.clientPublishTimestamp).getTime();
      const receiveTime = Date.now();
      const latency = receiveTime - publishTime;
      
      tracker.recordLatency(latency, {
        chatId: message.chatId,
        messageId: message.messageId,
        messageIndex: message.messageIndex
      });
      
      receivedMessages.set(message.messageIndex, true);
    } catch (error) {
      tracker.recordError(error);
    }
  });
  
  tracker.start();
  
  // Send messages via HTTP using multiple clients
  const messagesPerClient = Math.ceil(CONFIG.NUM_MESSAGES / CONFIG.NUM_HTTP_CLIENTS);
  const sendPromises = [];
  
  for (let clientId = 0; clientId < CONFIG.NUM_HTTP_CLIENTS; clientId++) {
    const startIndex = clientId * messagesPerClient;
    const endIndex = Math.min(startIndex + messagesPerClient, CONFIG.NUM_MESSAGES);
    
    const clientPromise = sendMessagesViaHTTP(
      token,
      startIndex,
      endIndex,
      clientId,
      tracker
    );
    
    sendPromises.push(clientPromise);
  }
  
  // Wait for all messages to be sent
  await Promise.all(sendPromises);
  console.log('✅ All HTTP requests completed');
  
  // Wait for messages to arrive (with timeout)
  await waitForMessages(receivedMessages, CONFIG.NUM_MESSAGES, CONFIG.TIMEOUT_MS);
  
  tracker.finish();
  ws.close();
  
  const stats = tracker.printReport();
  tracker.exportToCSV(`a2p-latency-${Date.now()}.csv`);
  
  return stats;
}

async function sendMessagesViaHTTP(token, startIndex, endIndex, clientId, tracker) {
  const promises = [];
  
  for (let i = startIndex; i < endIndex; i++) {
    const chatId = `chat-${i % CONFIG.NUM_CHATS}`;
    const clientPublishTimestamp = new Date().toISOString();
    
    const message = {
      targetChannel: 'WebSocket',
      messageType: CONFIG.MESSAGE_TYPE,
      payload: {
        chatId,
        eventType: 'load-test',
        content: `A2P Load Test - Message ${i} from Client ${clientId}`,
        clientPublishTimestamp,
        messageIndex: i,
        testType: 'a2p'
      }
    };
    
    const promise = fetch(CONFIG.HTTP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message)
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .catch(error => {
      tracker.recordError(error, { messageIndex: i, clientId });
    });
    
    promises.push(promise);
  }
  
  return Promise.all(promises);
}

// ============================================================================
// P2P Load Test (WebSocket)
// ============================================================================

async function runP2PLoadTest(token) {
  console.log('\n🚀 Starting P2P (WebSocket) Load Test...');
  console.log(`   Connections: ${CONFIG.NUM_WS_CONNECTIONS}`);
  console.log(`   Messages: ${CONFIG.NUM_MESSAGES}`);
  console.log(`   Chats: ${CONFIG.NUM_CHATS}`);
  console.log(`   ACK Timeout: ${CONFIG.P2P_ACK_TIMEOUT_MS}ms`);
  
  const tracker = new LatencyTracker('P2P (WebSocket)');
  
  // Create multiple WebSocket connections
  const connections = [];
  const receivedMessages = new Map();
  const pendingAcks = new Map(); // Track pending ACKs across all connections
  
  // Connect all WebSocket clients
  for (let i = 0; i < CONFIG.NUM_WS_CONNECTIONS; i++) {
    const ws = new WebSocket(
      `${CONFIG.WEBSOCKET_ENDPOINT}?token=${token}&chatIds=${generateChatIds().join(',')}`
    );
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Handle ACK messages
        if (message.type === 'ack') {
          const pending = pendingAcks.get(message.ackId);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingAcks.delete(message.ackId);
            pending.resolve(message);
          }
          return;
        }
        
        // Skip non-message events
        if (!message.clientPublishTimestamp) {
          return;
        }
        
        const publishTime = new Date(message.clientPublishTimestamp).getTime();
        const receiveTime = Date.now();
        const latency = receiveTime - publishTime;
        
        tracker.recordLatency(latency, {
          chatId: message.chatId,
          messageId: message.messageId,
          messageIndex: message.messageIndex,
          connectionId: i
        });
        
        receivedMessages.set(message.messageIndex, true);
      } catch (error) {
        tracker.recordError(error);
      }
    });
    
    connections.push(ws);
  }
  
  // Wait for all connections to open
  await Promise.all(connections.map(ws => {
    return new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
  }));
  
  console.log(`✅ ${CONFIG.NUM_WS_CONNECTIONS} WebSocket connections established`);
  
  tracker.start();
  
  // Send messages via WebSocket using multiple connections
  const messagesPerConnection = Math.ceil(CONFIG.NUM_MESSAGES / CONFIG.NUM_WS_CONNECTIONS);
  const sendPromises = [];
  
  for (let connId = 0; connId < CONFIG.NUM_WS_CONNECTIONS; connId++) {
    const startIndex = connId * messagesPerConnection;
    const endIndex = Math.min(startIndex + messagesPerConnection, CONFIG.NUM_MESSAGES);
    
    const promise = sendMessagesViaWebSocket(
      connections[connId],
      startIndex,
      endIndex,
      connId,
      tracker,
      pendingAcks
    );
    
    sendPromises.push(promise);
  }
  
  // Wait for all messages to be sent (with ACK confirmation)
  await Promise.all(sendPromises);
  console.log('✅ All WebSocket messages sent and acknowledged');
  
  // Wait for messages to arrive (with timeout)
  await waitForMessages(receivedMessages, CONFIG.NUM_MESSAGES, CONFIG.TIMEOUT_MS);
  
  tracker.finish();
  
  // Close all connections
  connections.forEach(ws => ws.close());
  
  const stats = tracker.printReport();
  tracker.exportToCSV(`p2p-latency-${Date.now()}.csv`);
  
  return stats;
}

async function sendMessagesViaWebSocket(ws, startIndex, endIndex, connectionId, tracker, pendingAcks) {
  const promises = [];
  
  for (let i = startIndex; i < endIndex; i++) {
    const chatId = `chat-${i % CONFIG.NUM_CHATS}`;
    const clientPublishTimestamp = new Date().toISOString();
    const ackId = `ack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`;
    
    const message = {
      action: 'sendMessage',
      targetChannel: 'WebSocket',
      messageType: CONFIG.MESSAGE_TYPE,
      requestAck: CONFIG.REQUEST_ACK,
      ackId: ackId,
      payload: {
        chatId,
        eventType: 'load-test',
        content: `P2P Load Test - Message ${i} from Connection ${connectionId}`,
        clientPublishTimestamp,
        messageIndex: i,
        testType: 'p2p'
      }
    };
    
    // Create promise for ACK handling
    const ackPromise = new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        if (pendingAcks.has(ackId)) {
          pendingAcks.delete(ackId);
          const error = new Error(`ACK timeout for message ${i}`);
          tracker.recordError(error, { messageIndex: i, connectionId, type: 'ack_timeout' });
          reject(error);
        }
      }, CONFIG.P2P_ACK_TIMEOUT_MS);
      
      // Store in pending map
      pendingAcks.set(ackId, { resolve, reject, timeout, messageIndex: i });
      
      // Send the message
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timeout);
        pendingAcks.delete(ackId);
        tracker.recordError(error, { messageIndex: i, connectionId, type: 'send_error' });
        reject(error);
      }
    });
    
    promises.push(ackPromise.catch(() => {
      // Swallow errors to allow other messages to continue
      // Errors are already tracked in the tracker
    }));
  }
  
  return Promise.all(promises);
}

// ============================================================================
// Utility Functions
// ============================================================================

function generateChatIds() {
  const chatIds = [];
  for (let i = 0; i < CONFIG.NUM_CHATS; i++) {
    chatIds.push(`chat-${i}`);
  }
  return chatIds;
}

async function waitForMessages(receivedMessages, expectedCount, timeoutMs) {
  const startTime = Date.now();
  const checkInterval = 100; // Check every 100ms
  
  while (receivedMessages.size < expectedCount) {
    const elapsed = Date.now() - startTime;
    
    if (elapsed > timeoutMs) {
      console.log(`⚠️  Timeout reached. Received ${receivedMessages.size}/${expectedCount} messages`);
      break;
    }
    
    // Update progress every second
    if (elapsed % 1000 < checkInterval) {
      const progress = ((receivedMessages.size / expectedCount) * 100).toFixed(1);
      process.stdout.write(`\r   Receiving messages: ${receivedMessages.size}/${expectedCount} (${progress}%)     `);
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  console.log(`\n✅ Received ${receivedMessages.size}/${expectedCount} messages`);
}

// ============================================================================
// Throughput Testing
// ============================================================================

/**
 * Send warmup messages to avoid cold starts
 */
async function sendWarmupMessages(token, connections, pendingReceipts, receivedMessages) {
  const warmupCount = 5;
  console.log(`\n🔥 Sending ${warmupCount} warmup messages to avoid cold starts...`);
  
  for (let i = 0; i < warmupCount; i++) {
    const chatIdx = i % CONFIG.NUM_CHATS;
    const chatId = `chat-${chatIdx}`;
    const conn = connections[chatIdx * CONFIG.USERS_PER_CHAT]; // Use first user of each chat
    
    const message = {
      action: 'sendMessage',
      targetChannel: 'WebSocket',
      messageType: CONFIG.MESSAGE_TYPE,
      requestAck: false, // No ACK needed for warmup
      payload: {
        chatId,
        eventType: 'warmup',
        content: `Warmup message ${i}`,
        clientPublishTimestamp: new Date().toISOString(),
        messageIndex: -1 - i, // Negative index for warmup
        testType: 'warmup'
      }
    };
    
    try {
      conn.ws.send(JSON.stringify(message));
      console.log(`   Warmup ${i + 1}/${warmupCount} sent via WebSocket`);
    } catch (error) {
      console.error(`   ⚠️  Warmup message ${i} failed:`, error.message);
    }
  }
  
  // Wait for warmup messages to arrive
  console.log(`   Waiting for warmup messages to be received...`);
  const expectedWarmup = warmupCount * CONFIG.USERS_PER_CHAT;
  
  // Give it up to 30 seconds for warmup
  const warmupStartTime = Date.now();
  let warmupReceived = 0;
  
  while (warmupReceived < expectedWarmup) {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Count warmup messages in receivedMessages (they have negative indices)
    warmupReceived = Array.from(receivedMessages.keys()).filter(idx => idx < 0).length;
    
    if (Date.now() - warmupStartTime > 30000) {
      console.log(`   ⚠️  Warmup timeout - received ${warmupReceived}/${expectedWarmup} messages`);
      break;
    }
  }
  
  console.log(`✅ Warmup complete - received ${warmupReceived}/${expectedWarmup} messages`);
  console.log(`   System is now warm, starting actual test...\n`);
  
  // Wait 2 more seconds for system to stabilize
  await new Promise(resolve => setTimeout(resolve, 2000));
}

/**
 * Run throughput test to find maximum sustainable throughput while meeting P95 < 800ms target
 */
async function runThroughputTest(token) {
  console.log('\n🚀 Starting Throughput Test...');
  console.log(`   Target: P95 < ${CONFIG.TARGET_P95_MS}ms`);
  console.log(`   Starting rate: ${CONFIG.THROUGHPUT_START_MSG_PER_SEC} msg/sec`);
  console.log(`   Increment: ${CONFIG.THROUGHPUT_INCREMENT_MSG_PER_SEC} msg/sec`);
  console.log(`   Max rate: ${CONFIG.THROUGHPUT_MAX_MSG_PER_SEC} msg/sec`);
  console.log(`   Test duration: ${CONFIG.THROUGHPUT_TEST_DURATION_SEC}s per rate`);
  console.log(`   Users per chat: ${CONFIG.USERS_PER_CHAT}`);
  console.log(`   Chats: ${CONFIG.NUM_CHATS}`);
  console.log(`   Total connections: ${CONFIG.NUM_CHATS * CONFIG.USERS_PER_CHAT}`);
  console.log(`   Run A2P: ${CONFIG.RUN_A2P}`);
  console.log(`   Run P2P: ${CONFIG.RUN_P2P}`);

  const results = [];
  let currentRate = CONFIG.THROUGHPUT_START_MSG_PER_SEC;
  let maxSuccessfulRate = 0;
  
  // Setup connections once for all tests
  console.log('\n' + '─'.repeat(70));
  console.log('🔧 Initial Setup');
  console.log('─'.repeat(70));
  const { connections, pendingAcks, pendingReceipts, receivedMessages, tracker } = await setupChatRoomConnections(token);
  
  // Send warmup messages
  await sendWarmupMessages(token, connections, pendingReceipts, receivedMessages);
  
  while (currentRate <= CONFIG.THROUGHPUT_MAX_MSG_PER_SEC) {
    console.log('\n' + '─'.repeat(70));
    console.log(`🔬 Testing throughput: ${currentRate} msg/sec`);
    console.log('─'.repeat(70));
    
    // Calculate number of messages for this test
    const numMessages = currentRate * CONFIG.THROUGHPUT_TEST_DURATION_SEC;
    
    // Reset tracker for this test iteration
    const iterationTracker = new LatencyTracker(`Throughput Test - ${currentRate} msg/sec`);
    
    // Clear previous test's received messages (but keep warmup messages)
    const warmupMessages = Array.from(receivedMessages.entries()).filter(([idx]) => idx < 0);
    receivedMessages.clear();
    warmupMessages.forEach(([idx, val]) => receivedMessages.set(idx, val));
    
    // Setup message tracking for this iteration
    const messageHandler = (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        // Skip ACK and warmup messages
        if (message.type === 'ack' || message.testType === 'warmup') {
          return;
        }
        
        if (!message.clientPublishTimestamp) {
          return;
        }
        
        const publishTime = new Date(message.clientPublishTimestamp).getTime();
        const receiveTime = Date.now();
        const latency = receiveTime - publishTime;
        
        iterationTracker.recordLatency(latency, {
          chatId: message.chatId,
          messageId: message.messageId,
          messageIndex: message.messageIndex,
          testType: message.testType
        });
        
        // Track unique receptions: use combination of messageIndex + receive timestamp to allow multiple users to receive same message
        // Generate unique key for each reception (messageIndex alone would only count unique messages, not total receptions)
        const receptionKey = `${message.messageIndex}-${receiveTime}-${Math.random()}`;
        receivedMessages.set(receptionKey, true);
      } catch (error) {
        iterationTracker.recordError(error);
      }
    };
    
    // Temporarily replace message handlers
    connections.forEach(conn => {
      conn.ws.removeAllListeners('message');
      conn.ws.on('message', messageHandler);
    });
    
    iterationTracker.start();
    
    // Send messages with rate limiting
    await sendMessagesWithRateLimit(token, connections, pendingReceipts, iterationTracker, currentRate, numMessages);
    
    // Wait for messages to arrive
    // Each message sent to a chat is received by ALL users subscribed to that chat
    // numMessages sent × USERS_PER_CHAT subscribed per chat = total receptions
    const expectedMessages = numMessages * CONFIG.USERS_PER_CHAT;
    await waitForMessages(receivedMessages, expectedMessages + warmupMessages.length, CONFIG.TIMEOUT_MS);
    
    iterationTracker.finish();
    
    // Get stats
    const stats = iterationTracker.getStats();
    
    // Check if target met
    const targetMet = stats.p95 <= CONFIG.TARGET_P95_MS;
    
    results.push({
      rate: currentRate,
      ...stats,
      targetMet
    });
    
    console.log(`\n📊 Results for ${currentRate} msg/sec:`);
    console.log(`   Messages: ${stats.count}/${expectedMessages} (${((stats.count/expectedMessages)*100).toFixed(1)}%)`);
    console.log(`   Mean: ${stats.mean.toFixed(2)}ms`);
    console.log(`   P95: ${stats.p95.toFixed(2)}ms`);
    console.log(`   P99: ${stats.p99.toFixed(2)}ms`);
    console.log(`   Target (P95 < ${CONFIG.TARGET_P95_MS}ms): ${targetMet ? '✅ MET' : '❌ EXCEEDED'}`);
    
    if (targetMet) {
      maxSuccessfulRate = currentRate;
      console.log(`   ✅ Target met - continuing to higher rate...`);
    } else {
      console.log(`   ❌ Target exceeded - stopping test`);
      break;
    }
    
    // Increment rate for next iteration
    currentRate += CONFIG.THROUGHPUT_INCREMENT_MSG_PER_SEC;
    
    // Wait 3 seconds between tests
    if (currentRate <= CONFIG.THROUGHPUT_MAX_MSG_PER_SEC) {
      console.log(`\n⏸️  Waiting 3 seconds before next test...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Close all connections
  if (connections.length > 0) {
    connections.forEach(conn => conn.ws.close());
    console.log(`\n🔌 Closed ${connections.length} WebSocket connections`);
  }
  
  // Print summary
  printThroughputTestSummary(results, maxSuccessfulRate);
  
  return { results, maxSuccessfulRate };
}

/**
 * Send messages with rate limiting via P2P (WebSocket)
 */
async function sendMessagesWithRateLimit(token, connections, pendingReceipts, tracker, targetRate, numMessages) {
  const delayBetweenMessages = 1000 / targetRate;  // milliseconds
  const messagesPerChat = Math.ceil(numMessages / CONFIG.NUM_CHATS);
  const chatPromises = [];
  
  // Calculate delay per chat to achieve overall target rate
  const delayPerChat = (1000 * CONFIG.NUM_CHATS) / targetRate;
  
  // Group connections by chat
  const connectionsByChat = {};
  connections.forEach(conn => {
    if (!connectionsByChat[conn.chatId]) {
      connectionsByChat[conn.chatId] = [];
    }
    connectionsByChat[conn.chatId].push(conn);
  });
  
  for (let chatIdx = 0; chatIdx < CONFIG.NUM_CHATS; chatIdx++) {
    const chatId = `chat-${chatIdx}`;
    const chatConnections = connectionsByChat[chatId] || [];
    
    // Each chat sends messages sequentially with rate limiting
    const chatPromise = (async () => {
      for (let msgIdx = 0; msgIdx < messagesPerChat; msgIdx++) {
        const messageStartTime = Date.now();
        const globalIndex = chatIdx * messagesPerChat + msgIdx;
        if (globalIndex >= numMessages) break;
        
        // Rotate through connections in this chat
        const conn = chatConnections[msgIdx % chatConnections.length];
        
        const message = {
          action: 'sendMessage',
          targetChannel: 'WebSocket',
          messageType: CONFIG.MESSAGE_TYPE,
          requestAck: false, // No ACK for throughput testing
          payload: {
            chatId,
            eventType: 'throughput-test',
            content: `Throughput Test - Chat ${chatIdx} Message ${msgIdx}`,
            clientPublishTimestamp: new Date().toISOString(),
            messageIndex: globalIndex,
            testType: 'p2p'
          }
        };
        
        try {
          // Send via WebSocket
          conn.ws.send(JSON.stringify(message));
          
          // Rate limiting: wait if needed
          const elapsed = Date.now() - messageStartTime;
          const waitTime = delayPerChat - elapsed;
          if (waitTime > 0) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        } catch (error) {
          tracker.recordError(error, { messageIndex: globalIndex, chatId, userId: conn.userId, type: 'p2p' });
        }
      }
    })();
    
    chatPromises.push(chatPromise);
  }
  
  // Wait for all chats to complete
  await Promise.all(chatPromises);
  console.log(`✅ Sent ${numMessages} messages at target rate ${targetRate} msg/sec via P2P (WebSocket)`);
}

/**
 * Print throughput test summary
 */
function printThroughputTestSummary(results, maxSuccessfulRate) {
  console.log('\n' + '═'.repeat(70));
  console.log('📊 Throughput Test Summary');
  console.log('═'.repeat(70));
  console.log(`Target: P95 < ${CONFIG.TARGET_P95_MS}ms\n`);
  
  console.log('Rate (msg/s)  | P95 (ms) | P99 (ms) | Mean (ms) | Target');
  console.log('-'.repeat(70));
  
  results.forEach(result => {
    const targetIcon = result.targetMet ? '✅' : '❌';
    console.log(
      `${String(result.rate).padStart(12)} | ` +
      `${result.p95.toFixed(2).padStart(8)} | ` +
      `${result.p99.toFixed(2).padStart(8)} | ` +
      `${result.mean.toFixed(2).padStart(9)} | ` +
      `${targetIcon}`
    );
  });
  
  console.log('═'.repeat(70));
  console.log(`\n🎯 Maximum Sustainable Throughput: ${maxSuccessfulRate} msg/sec`);
  console.log(`   (while maintaining P95 < ${CONFIG.TARGET_P95_MS}ms)`);
  console.log('═'.repeat(70) + '\n');
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         WebSocket Notification Service - Load Test                ║');
  if (CONFIG.THROUGHPUT_TEST_MODE) {
    console.log('║         Throughput Test Mode - Find Maximum Sustainable Rate      ║');
  } else {
    console.log('║         Production-Like End-to-End Latency Measurement            ║');
  }
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log();
  console.log('Configuration:');
  
  if (CONFIG.THROUGHPUT_TEST_MODE) {
    console.log(`  Test Mode:             THROUGHPUT TEST`);
    console.log(`  Target:                P95 < ${CONFIG.TARGET_P95_MS}ms`);
    console.log(`  Starting Rate:         ${CONFIG.THROUGHPUT_START_MSG_PER_SEC} msg/sec`);
    console.log(`  Rate Increment:        ${CONFIG.THROUGHPUT_INCREMENT_MSG_PER_SEC} msg/sec`);
    console.log(`  Maximum Rate:          ${CONFIG.THROUGHPUT_MAX_MSG_PER_SEC} msg/sec`);
    console.log(`  Test Duration:         ${CONFIG.THROUGHPUT_TEST_DURATION_SEC}s per rate`);
    console.log(`  Chats:                 ${CONFIG.NUM_CHATS}`);
    console.log(`  Users per Chat:        ${CONFIG.USERS_PER_CHAT}`);
    console.log(`  Total WebSocket Users: ${CONFIG.TOTAL_USERS}`);
    console.log(`  Message Type:          ${CONFIG.MESSAGE_TYPE}`);
  } else {
    console.log(`  Total Messages:        ${CONFIG.NUM_MESSAGES}`);
    console.log(`  Test Selection:        ${CONFIG.RUN_A2P && CONFIG.RUN_P2P ? 'A2P + P2P' : CONFIG.RUN_A2P ? 'A2P only' : CONFIG.RUN_P2P ? 'P2P only' : 'NONE'}`);
    console.log(`  A2P Messages (HTTP):   ${CONFIG.A2P_MESSAGES}`);
    console.log(`  P2P Messages (WS):     ${CONFIG.P2P_MESSAGES}`);
    console.log(`  Chats:                 ${CONFIG.NUM_CHATS}`);
    console.log(`  Users per Chat:        ${CONFIG.USERS_PER_CHAT}`);
    console.log(`  Total WebSocket Users: ${CONFIG.TOTAL_USERS}`);
    console.log(`  Message Type:          ${CONFIG.MESSAGE_TYPE}`);
    console.log(`  Send Strategy:         ${CONFIG.MESSAGE_TYPE === 'standard' ? 'SEQUENTIAL (global, wait for receipt)' : 'SEQUENTIAL per chat (FIFO ordering)'}`);
    console.log(`  Test Mode:             ${CONFIG.RUN_PARALLEL && CONFIG.RUN_A2P && CONFIG.RUN_P2P ? 'PARALLEL (A2P + P2P)' : 'SEQUENTIAL'}`);
    console.log(`  ACK Timeout:           ${CONFIG.P2P_ACK_TIMEOUT_MS}ms`);
    console.log(`  Receipt Timeout:       ${CONFIG.RECEIPT_TIMEOUT_MS}ms`);
  }
  console.log(`  Timeout:               ${CONFIG.TIMEOUT_MS}ms`);
  console.log(`  CloudWatch Metrics:    ${CONFIG.SEND_METRICS_TO_CLOUDWATCH ? 'ENABLED' : 'DISABLED'}`);
  if (CONFIG.SEND_METRICS_TO_CLOUDWATCH) {
    console.log(`  Metrics Endpoint:      ${CONFIG.METRICS_ENDPOINT}`);
    console.log(`  Metrics Batch Size:    ${CONFIG.METRICS_BATCH_SIZE}`);
  }
  console.log();
  
  try {
    // Authenticate
    const token = await getCognitoToken();
    
    if (CONFIG.THROUGHPUT_TEST_MODE) {
      // Run throughput test
      console.log('\n' + '━'.repeat(70));
      const { results, maxSuccessfulRate } = await runThroughputTest(token);
      
      console.log('\n✅ Throughput test completed successfully!');
      
      // Export results to CSV
      const csvHeader = 'Rate (msg/s),Mean (ms),Median (ms),P95 (ms),P99 (ms),Messages,Errors,Target Met\n';
      const csvRows = results.map(r => 
        `${r.rate},${r.mean.toFixed(2)},${r.median.toFixed(2)},${r.p95.toFixed(2)},${r.p99.toFixed(2)},${r.count},${r.errorCount},${r.targetMet ? 'YES' : 'NO'}`
      ).join('\n');
      const csvContent = csvHeader + csvRows;
      fs.writeFileSync(`throughput-test-${Date.now()}.csv`, csvContent);
      console.log(`📁 Results exported to CSV file`);
      
    } else {
      // Run production-like load test
      console.log('\n' + '━'.repeat(70));
      const stats = await runProductionLoadTest(token);
      
      console.log('\n✅ Load test completed successfully!');
      console.log(`📁 Results exported to CSV file`);
      
      // Summary
      console.log('\n' + '═'.repeat(70));
      console.log('📊 Final Summary');
      console.log('═'.repeat(70));
      const actualMessagesSent = (CONFIG.RUN_A2P ? CONFIG.A2P_MESSAGES : 0) + (CONFIG.RUN_P2P ? CONFIG.P2P_MESSAGES : 0);
      console.log(`Success Rate:    ${actualMessagesSent > 0 ? ((stats.count / (actualMessagesSent * CONFIG.USERS_PER_CHAT)) * 100).toFixed(2) : 0}%`);
      console.log(`Mean Latency:    ${stats.mean.toFixed(2)} ms`);
      console.log(`Median Latency:  ${stats.median.toFixed(2)} ms`);
      console.log(`P95 Latency:     ${stats.p95.toFixed(2)} ms`);
      console.log(`P99 Latency:     ${stats.p99.toFixed(2)} ms`);
      console.log(`Throughput:      ${stats.throughput} msg/sec`);
      console.log(`Total Duration:  ${stats.totalDuration} ms (${(stats.totalDuration / 1000).toFixed(2)}s)`);
      console.log(`Errors:          ${stats.errorCount}`);
      console.log('═'.repeat(70));
    }
    
  } catch (error) {
    console.error('\n❌ Load test failed:', error);
    process.exit(1);
  }
}

// Run the tests
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { 
  runProductionLoadTest,
  runA2PLoadTest, 
  runP2PLoadTest, 
  LatencyTracker 
};
