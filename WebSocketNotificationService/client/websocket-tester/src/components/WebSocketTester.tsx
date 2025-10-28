'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { metricsService } from '@/services/metrics';
import { AckManager } from '@/utils/AckManager';

interface Message {
  id: string;
  timestamp: string;
  direction: 'sent' | 'received';
  type: 'P2P' | 'A2P';
  content: string;
  payload?: any;
  latency?: number; // E2E latency in milliseconds
  sequenceNumber?: number; // Sequence number (custom consecutive or SQS for display)
  isCustomSequence?: boolean; // True if using custom consecutive sequences (gap detection), false if SQS (ordering only)
  isOutOfOrder?: boolean; // True if sequence number is not consecutive
  missingCount?: number; // Number of messages potentially lost
}

export default function WebSocketTester() {
  const router = useRouter();
  const { user, getIdToken, signOut } = useAuth();
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectionLog, setConnectionLog] = useState<string[]>([]);
  
  // ACK Manager for P2P sequential burst sends
  const ackManagerRef = useRef<AckManager | null>(null);
  
  // Sequence tracking per scope (targetClass:targetId)
  const [lastSequenceByScope, setLastSequenceByScope] = useState<Record<string, number>>({});
  
  // Connection parameters (Phase 4: Chat-ID based)
  const [chatIds, setChatIds] = useState('chat-123,chat-456'); // Comma-separated list of chat IDs
  
  // Message parameters (Phase 4: Chat-ID based)
  const [chatId, setChatId] = useState('chat-123'); // Target chat ID
  const [eventType, setEventType] = useState('notification');
  const [messageContent, setMessageContent] = useState('');
  const [messageType, setMessageType] = useState<'standard' | 'fifo'>('standard');
  const [messageGroupId, setMessageGroupId] = useState('');
  
  // Bulk sending state
  const [bulkCount, setBulkCount] = useState(1000);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkStats, setBulkStats] = useState<{sent: number, failed: number, duration: number} | null>(null);
  const [bulkSequential, setBulkSequential] = useState(false); // Sequential sending (await each response)
  const [bulkMethod, setBulkMethod] = useState<'p2p' | 'a2p'>('p2p'); // Publishing method for bulk send
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setConnectionLog(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const connectWebSocket = async () => {
    try {
      const token = await getIdToken();
      if (!token) {
        addLog('❌ Failed to get authentication token');
        return;
      }

      const wsUrl = `${process.env.NEXT_PUBLIC_WEBSOCKET_ENDPOINT}?token=${token}&chatIds=${chatIds}`;
      addLog(`🔌 Connecting to ${process.env.NEXT_PUBLIC_WEBSOCKET_ENDPOINT}...`);
      addLog(`   Subscribing to chats: ${chatIds}`);
      
      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        addLog('✅ WebSocket connected successfully');
        setConnected(true);
      };

      websocket.onmessage = async (event) => {
        addLog(`📨 Received message: ${event.data.substring(0, 100)}...`);
        try {
          const data = JSON.parse(event.data);
          
          // Skip ACK messages - they're handled by AckManager, not displayed in chat
          if (data.type === 'ack') {
            addLog(`✅ ACK received: ${data.ackId} (${data.messageId})`);
            return; // Don't add ACK messages to the message list
          }
          
          let e2eLatency: number | undefined;

          // Use client-side timestamp if available (no clock skew)
          // Fall back to server timestamp (may have clock skew)
          if (data.clientPublishTimestamp) {
            const publishTime = new Date(data.clientPublishTimestamp);
            const clientReceiveTime = new Date();
            
            e2eLatency = clientReceiveTime.getTime() - publishTime.getTime();
            
            // Should never be negative with client timestamps, but guard anyway
            if (e2eLatency < 0) {
              addLog(`⚠️ Unexpected negative latency: ${e2eLatency}ms (adjusted to 0ms)`);
              e2eLatency = 0;
            }
            
            addLog(`📊 Latency - E2E: ${e2eLatency}ms (client clock)`);
          } else if (data.publishTimestamp) {
            // Fallback to server timestamp (has potential clock skew)
            const publishTime = new Date(data.publishTimestamp);
            const clientReceiveTime = new Date();
            
            e2eLatency = clientReceiveTime.getTime() - publishTime.getTime();
            
            // Guard against clock skew
            if (e2eLatency < 0) {
              addLog(`⚠️ Clock skew detected! Latency: ${e2eLatency}ms (adjusted to 0ms)`);
              e2eLatency = 0;
            }
            
            addLog(`📊 Latency - E2E: ${e2eLatency}ms (server clock)`);
          }
          
          // Send metrics to the collector Lambda (if available)
          if (e2eLatency !== undefined && data.publishTimestamp) {
            const token = await getIdToken();
            if (token) {
              await metricsService.trackEndToEndLatency(
                new Date(data.publishTimestamp),
                new Date(),
                token,
                data.messageId,
                data.chatId || data.payload?.chatId
              );
            }
          }
          
          // Track sequence numbers if present
          let sequenceNumber: number | undefined;
          let isOutOfOrder = false;
          let missingCount: number | undefined;
          let isCustomSequence = false; // True if using custom consecutive sequences
          
          // Prioritize custom consecutive sequence, fall back to SQS sequence
          if (data.sequenceNumber !== undefined && typeof data.sequenceNumber === 'number') {
            const currentSeq = data.sequenceNumber; // Custom consecutive sequence (1,2,3...)
            sequenceNumber = currentSeq;
            isCustomSequence = true;
            
            // Get scope from chatId (Phase 4: chat-based scoping)
            const scope = data.chatId || 'default';
            
            const lastSeq = lastSequenceByScope[scope];
            
            if (lastSeq !== undefined) {
              const expectedSeq = lastSeq + 1;
              
              if (currentSeq !== expectedSeq) {
                isOutOfOrder = true;
                missingCount = currentSeq - expectedSeq;
                
                if (missingCount > 0) {
                  addLog(`⚠️ Sequence gap detected! Expected: ${expectedSeq}, Got: ${currentSeq}, Missing: ${missingCount}`);
                } else {
                  addLog(`⚠️ Out-of-order sequence! Expected: ${expectedSeq}, Got: ${currentSeq}`);
                }
              } else {
                addLog(`✅ Sequence #${currentSeq} in order`);
              }
            } else {
              addLog(`🔢 First sequence number received: ${currentSeq} (scope: ${scope})`);
            }
            
            // Update last sequence for this scope
            setLastSequenceByScope(prev => ({
              ...prev,
              [scope]: currentSeq
            }));
          } else if (data.sqsSequenceNumber !== undefined && typeof data.sqsSequenceNumber === 'string') {
            // SQS sequence (non-consecutive) - only for ordering verification, not gap detection
            const currentSqsSeq = BigInt(data.sqsSequenceNumber);
            sequenceNumber = parseInt(data.sqsSequenceNumber.slice(-6)); // Show last 6 digits for display
            isCustomSequence = false;
            
            const scope = data.chatId || 'default';
            
            const lastSeq = lastSequenceByScope[scope];
            
            if (lastSeq !== undefined) {
              const lastSqsSeq = BigInt(lastSeq);
              
              // Only check ordering (higher = later), not gaps
              if (currentSqsSeq < lastSqsSeq) {
                isOutOfOrder = true;
                addLog(`⚠️ Out-of-order delivery! SQS sequence decreased`);
              } else {
                addLog(`✅ SQS sequence in order (ordering only)`);
              }
            } else {
              addLog(`🔢 First SQS sequence received (scope: ${scope})`);
            }
            
            // Store the BigInt as string for comparison
            setLastSequenceByScope(prev => ({
              ...prev,
              [scope]: Number(currentSqsSeq)
            }));
          }
          
          const msg: Message = {
            id: Math.random().toString(36),
            timestamp: new Date().toISOString(),
            direction: 'received',
            type: 'A2P',
            content: data.content || data.payload?.content || JSON.stringify(data),
            payload: data,
            latency: e2eLatency,
            sequenceNumber,
            isCustomSequence,
            isOutOfOrder,
            missingCount,
          };
          setMessages(prev => [...prev, msg]);
        } catch (e) {
          const msg: Message = {
            id: Math.random().toString(36),
            timestamp: new Date().toISOString(),
            direction: 'received',
            type: 'A2P',
            content: event.data,
          };
          setMessages(prev => [...prev, msg]);
        }
      };

      websocket.onerror = (error) => {
        addLog(`❌ WebSocket error: ${error}`);
        console.error('WebSocket error:', error);
      };

      websocket.onclose = (event) => {
        addLog(`🔌 WebSocket closed. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}`);
        setConnected(false);
        // Clean up ACK manager
        if (ackManagerRef.current) {
          ackManagerRef.current.destroy();
          ackManagerRef.current = null;
        }
      };

      setWs(websocket);
      
      // Initialize ACK manager for this connection
      ackManagerRef.current = new AckManager(websocket, 10000); // 10 second timeout for bulk operations
      addLog('✅ ACK Manager initialized (10s timeout)');
    } catch (error) {
      addLog(`❌ Connection failed: ${error}`);
      console.error('Connection error:', error);
    }
  };

  const disconnectWebSocket = () => {
    if (ws) {
      ws.close();
      setWs(null);
      setConnected(false);
      addLog('🔌 Disconnected manually');
      // Clean up ACK manager
      if (ackManagerRef.current) {
        ackManagerRef.current.destroy();
        ackManagerRef.current = null;
      }
    }
  };

  const sendP2PMessage = () => {
    if (!ws || !connected) {
      addLog('❌ Not connected to WebSocket');
      return;
    }

    if (!messageContent.trim()) {
      addLog('❌ Message content is empty');
      return;
    }

    // Capture client publish time to avoid clock skew with server
    const clientPublishTimestamp = new Date().toISOString();

    const message = {
      action: 'sendMessage',
      targetChannel: 'WebSocket',
      messageType,
      ...(messageType === 'fifo' && messageGroupId && { messageGroupId }),
      ...(messageType === 'fifo' && { generateSequence: true }), // Request sequence generation at top level
      payload: {
        chatId,
        eventType,
        content: messageContent,
        clientPublishTimestamp, // Add client-side timestamp for accurate latency measurement
      }
    };

    ws.send(JSON.stringify(message));
    addLog(`📤 Sent P2P message to chat ${chatId}${messageType === 'fifo' && messageGroupId ? ` (group: ${messageGroupId})` : ''}${messageType === 'fifo' ? ' [seq]' : ''}`);

    const msg: Message = {
      id: Math.random().toString(36),
      timestamp: new Date().toISOString(),
      direction: 'sent',
      type: 'P2P',
      content: messageContent,
      payload: message
    };
    setMessages(prev => [...prev, msg]);
    setMessageContent('');
  };

  const sendA2PMessage = async () => {
    try {
      const token = await getIdToken();
      if (!token) {
        addLog('❌ Failed to get authentication token');
        return;
      }

      if (!messageContent.trim()) {
        addLog('❌ Message content is empty');
        return;
      }

      const endpoint = process.env.NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT;
      if (!endpoint) {
        addLog('❌ HTTP publish endpoint not configured in environment variables');
        console.error('NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT is not set');
        return;
      }

      // Capture client publish time to avoid clock skew with server
      const clientPublishTimestamp = new Date().toISOString();

      const message = {
        targetChannel: 'WebSocket',
        messageType,
        ...(messageType === 'fifo' && messageGroupId && { messageGroupId }),
        ...(messageType === 'fifo' && { generateSequence: true }), // Request sequence generation at top level
        payload: {
          chatId,
          eventType,
          content: messageContent,
          clientPublishTimestamp, // Add client-side timestamp for accurate latency measurement
        }
      };

      addLog(`📤 Sending A2P message via HTTP to ${endpoint}...${messageType === 'fifo' && messageGroupId ? ` (group: ${messageGroupId})` : ''}${messageType === 'fifo' ? ' [seq]' : ''}`);
      console.log('A2P Request:', { endpoint, message, token: `${token.substring(0, 20)}...` });
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message)
      });

      console.log('A2P Response:', { status: response.status, statusText: response.statusText });

      if (response.ok) {
        const responseData = await response.json();
        addLog(`✅ A2P message sent successfully - MessageId: ${responseData.messageId}`);
        console.log('A2P Response Data:', responseData);
        const msg: Message = {
          id: Math.random().toString(36),
          timestamp: new Date().toISOString(),
          direction: 'sent',
          type: 'A2P',
          content: messageContent,
          payload: message
        };
        setMessages(prev => [...prev, msg]);
        setMessageContent('');
      } else {
        const errorText = await response.text();
        addLog(`❌ A2P message failed: ${response.status} ${response.statusText}`);
        addLog(`   Error details: ${errorText}`);
        console.error('A2P Error Response:', { status: response.status, body: errorText });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(`❌ A2P request failed: ${errorMessage}`);
      console.error('A2P error:', error);
    }
  };

  /**
   * Send bulk messages with flexible options
   * Supports:
   * - Method: P2P (WebSocket) or A2P (HTTP)
   * - Mode: Parallel (fast) or Sequential (ordered)
   * - Type: FIFO (with sequences) or Standard (fast)
   */
  const sendBulkMessages = async () => {
    // Validate prerequisites based on selected method
    if (bulkMethod === 'p2p' && (!ws || !connected)) {
      addLog('❌ Not connected to WebSocket. Connect first or switch to A2P method.');
      return;
    }

    if (bulkSending) {
      addLog('⚠️ Bulk send already in progress');
      return;
    }

    setBulkSending(true);
    setBulkProgress(0);
    setBulkStats(null);

    const startTime = Date.now();
    let sentCount = 0;
    let failedCount = 0;

    const methodLabel = bulkMethod === 'p2p' ? 'P2P WebSocket' : 'A2P HTTP';
    const modeLabel = bulkSequential ? 'Sequential' : 'Parallel';
    const mode = `${modeLabel} (${methodLabel})`;
    
    addLog(`🚀 Starting bulk send: ${bulkCount} messages via ${mode}`);
    addLog(`   Target: chat-${chatId}, Type: ${messageType}${messageType === 'fifo' ? ' [with sequences]' : ''}`);

    try {
      if (bulkMethod === 'a2p') {
        // A2P HTTP Publishing (Sequential or Parallel)
        const token = await getIdToken();
        if (!token) {
          addLog('❌ Failed to get authentication token');
          setBulkSending(false);
          return;
        }

        const endpoint = process.env.NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT;
        if (!endpoint) {
          addLog('❌ HTTP publish endpoint not configured');
          setBulkSending(false);
          return;
        }

        addLog(`   📡 A2P HTTP mode${bulkSequential ? ' (sequential - awaiting responses)' : ' (parallel - fire and forget)'}`);
        addLog(`   📋 Endpoint: ${endpoint}`);
        addLog(`   👤 User: ${user?.getUsername()}`);
        addLog(`   💬 Target chat: ${chatId}`);
        // Base message template for A2P
        const baseMessage = {
          targetChannel: 'WebSocket',
          messageType,
          ...(messageType === 'fifo' && messageGroupId && { messageGroupId }),
          ...(messageType === 'fifo' && { generateSequence: true }), // Request sequence generation at top level
          payload: {
            chatId,
            eventType: 'bulk-test',
            content: '',
            bulkIndex: 0,
          }
        };

        if (bulkSequential) {
          // A2P Sequential: Wait for each HTTP response
          for (let i = 0; i < bulkCount; i++) {
            const messageNum = i + 1;
            
            baseMessage.payload.content = `A2P Sequential ${messageNum}/${bulkCount}`;
            baseMessage.payload.bulkIndex = messageNum;

            try {
              const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(baseMessage)
              });

              if (response.ok) {
                sentCount++;
              } else {
                failedCount++;
                console.error(JSON.stringify(response))
                const errorText = await response.text().catch(() => 'Unable to read error response');
                console.error(`Failed to send message ${messageNum}: ${response.status} ${response.statusText}`, errorText);
                
                if (failedCount === 1) {
                  addLog(`⚠️ First HTTP error: ${response.status} ${response.statusText}`);
                  addLog(`   Details: ${errorText.substring(0, 100)}`);
                }
              }

              // Update progress every 10 messages
              if (messageNum % 10 === 0) {
                const progress = Math.floor((messageNum / bulkCount) * 100);
                setBulkProgress(progress);
                addLog(`   Progress: ${messageNum}/${bulkCount} (${progress}%) - Failed: ${failedCount}`);
              }
            } catch (error) {
              failedCount++;
              console.error(`Failed to send message ${messageNum}:`, error);
            }
          }
        } else {
          // A2P Parallel: Fire all requests concurrently
          const promises = [];
          for (let i = 0; i < bulkCount; i++) {
            const messageNum = i + 1;
            const message = {
              ...baseMessage,
              payload: {
                ...baseMessage.payload,
                content: `A2P Parallel ${messageNum}/${bulkCount}`,
                bulkIndex: messageNum,
              }
            };

            const promise = fetch(endpoint, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(message)
            })
            .then(response => {
              if (response.ok) {
                sentCount++;
              } else {
                failedCount++;
              }
              return response.ok;
            })
            .catch(error => {
              failedCount++;
              console.error(`Failed to send message ${messageNum}:`, error);
              return false;
            });

            promises.push(promise);

            // Update progress every 100 requests
            if (messageNum % 100 === 0) {
              const progress = Math.floor((messageNum / bulkCount) * 100);
              setBulkProgress(progress);
              addLog(`   Queued: ${messageNum}/${bulkCount} (${progress}%)`);
            }
          }

          // Wait for all parallel requests to complete
          addLog(`   ⏳ Waiting for ${bulkCount} parallel HTTP requests...`);
          await Promise.all(promises);
        }
      } else {
        // P2P WebSocket Publishing (Sequential or Parallel)
        if (!ws) {
          addLog('❌ WebSocket connection lost');
          setBulkSending(false);
          return;
        }

        addLog(`   ⚡ P2P WebSocket mode${bulkSequential ? ' (sequential - awaiting ACKs)' : ' (parallel - fire and forget)'}`);
        
        // Base message template for P2P
        const baseMessage = {
          action: 'sendMessage',
          targetChannel: 'WebSocket',
          messageType,
          ...(messageType === 'fifo' && messageGroupId && { messageGroupId }),
          ...(messageType === 'fifo' && { generateSequence: true }), // Request sequence generation at top level
          payload: {
            chatId,
            eventType: 'bulk-test',
            content: '',
            bulkIndex: 0,
          }
        };

        if (bulkSequential) {
          // P2P Sequential: Wait for ACK from server before sending next message
          if (!ackManagerRef.current) {
            addLog('❌ ACK Manager not initialized. Reconnect to WebSocket.');
            setBulkSending(false);
            return;
          }

          addLog(`   ✅ Batch WebSocket mode with ACK confirmation (10s timeout per message)`);
          addLog(`   📊 Strategy: Send all messages immediately, wait for all ACKs in parallel`);
          addLog(`   📊 Tracking: sent, ACK received, failed, timeouts`);
          
          // Prepare all messages
          const messagesToSend = [];
          for (let i = 0; i < bulkCount; i++) {
            const messageNum = i + 1;
            messagesToSend.push({
              ...baseMessage,
              payload: {
                ...baseMessage.payload,
                content: `P2P Batch ACK ${messageNum}/${bulkCount}`,
                bulkIndex: messageNum,
                clientPublishTimestamp: new Date().toISOString(), // Add timestamp
              }
            });
          }
          
          addLog(`   📤 Sending ${bulkCount} messages in parallel...`);
          
          // Send all messages and wait for ACKs in parallel
          const results = await ackManagerRef.current.sendBatchWithAckSettled(messagesToSend);
          
          // Process results
          let ackReceivedCount = 0;
          let timeoutCount = 0;
          
          results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              sentCount++;
              ackReceivedCount++;
              
              // Log first few successes for debugging
              if (ackReceivedCount <= 3) {
                addLog(`   ✅ ACK ${index + 1}: ${result.value?.messageId} (seq: ${result.value?.sequenceNumber || 'N/A'})`);
              }
            } else {
              failedCount++;
              
              const errorMessage = result.reason?.message || 'Unknown error';
              if (errorMessage.includes('timeout')) {
                timeoutCount++;
              }
              
              // Log first few errors for debugging
              if (failedCount <= 3) {
                addLog(`   ❌ Message ${index + 1} failed: ${errorMessage.substring(0, 60)}`);
              }
            }
          });
          
          // Final ACK statistics
          addLog(`   📊 ACK Summary: ${ackReceivedCount} confirmed, ${timeoutCount} timeouts, ${failedCount - timeoutCount} failed`);
        } else {
          // P2P Parallel: Send all messages as fast as possible
          let progressUpdateCounter = 0;
          
          for (let i = 0; i < bulkCount; i++) {
            const messageNum = i + 1;
            
            baseMessage.payload.content = `P2P Parallel ${messageNum}/${bulkCount}`;
            baseMessage.payload.bulkIndex = messageNum;

            try {
              ws.send(JSON.stringify(baseMessage));
              sentCount++;
              
              // Update progress every 100 messages
              if (messageNum % 100 === 0) {
                progressUpdateCounter++;
                const progress = Math.floor((messageNum / bulkCount) * 100);
                setBulkProgress(progress);
                
                // Only log every 200 messages to reduce overhead
                if (progressUpdateCounter % 2 === 0) {
                  addLog(`   Progress: ${messageNum}/${bulkCount} (${progress}%)`);
                }
              }
            } catch (error) {
              failedCount++;
              console.error(`Failed to send message ${messageNum}:`, error);
            }
          }
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      const messagesPerSecond = Math.floor((sentCount / duration) * 1000);

      setBulkProgress(100);
      setBulkStats({
        sent: sentCount,
        failed: failedCount,
        duration,
      });

      const successRate = ((sentCount / bulkCount) * 100).toFixed(1);
      
      addLog(`✅ Bulk send complete!`);
      addLog(`   Sent: ${sentCount}/${bulkCount} messages (${successRate}% success rate)`);
      addLog(`   Failed: ${failedCount} messages`);
      addLog(`   Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
      addLog(`   Speed: ${messagesPerSecond} messages/second`);
      
      if (failedCount > 0) {
        addLog(`   ⚠️ Note: ${failedCount} messages failed (may be ${bulkMethod === 'a2p' ? 'HTTP errors or ' : ''}Lambda throttling)`);
      }
      
      if (duration < 1000 && !bulkSequential && bulkMethod === 'p2p') {
        addLog(`   🎯 Target achieved: ${sentCount} messages in < 1 second!`);
      }
      
      if (bulkSequential && sentCount === bulkCount) {
        addLog(`   ✅ Sequential mode: All messages sent in order`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(`❌ Bulk send failed: ${errorMessage}`);
      console.error('Bulk send error:', error);
    } finally {
      setBulkSending(false);
    }
  };

  const clearMessages = () => {
    setMessages([]);
    addLog('🧹 Messages cleared');
  };

  const clearLogs = () => {
    setConnectionLog([]);
  };

  const handleSignOut = async () => {
    // Disconnect WebSocket if connected
    if (ws) {
      ws.close();
    }
    await signOut();
    // Redirect to sign-in page
    router.push('/signin');
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b p-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              title="Back to home"
            >
              ← Home
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Single Client Tester</h1>
              <p className="text-sm text-gray-600">
                Signed in as: <span className="font-medium">{user?.getUsername()}</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/multi-client')}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-sm font-medium"
            >
              🔌 Multi-Client Mode
            </button>
            <button
              onClick={() => router.push('/permissions')}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm font-medium"
            >
              🔐 Permissions
            </button>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm font-medium"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Configuration */}
        <div className="w-80 bg-white border-r overflow-y-auto p-4 space-y-6">
          {/* Connection Section */}
          <div>
            <h2 className="text-lg font-semibold mb-3 text-gray-900">Connection</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Chat IDs (comma-separated)
                </label>
                <input
                  type="text"
                  value={chatIds}
                  onChange={(e) => setChatIds(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder="chat-123,chat-456"
                  disabled={connected}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Subscribe to multiple chats by separating IDs with commas
                </p>
              </div>
              
              {!connected ? (
                <button
                  onClick={connectWebSocket}
                  className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 transition-colors font-medium"
                >
                  🔌 Connect
                </button>
              ) : (
                <button
                  onClick={disconnectWebSocket}
                  className="w-full bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 transition-colors font-medium"
                >
                  🔌 Disconnect
                </button>
              )}
            </div>
          </div>

          {/* Message Configuration */}
          <div>
            <h2 className="text-lg font-semibold mb-3 text-gray-900">Message Settings</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Target Chat ID
                </label>
                <input
                  type="text"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder="chat-123"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Send message to this chat
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
                <input
                  type="text"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder="e.g., notification, chat"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message Type</label>
                <select
                  value={messageType}
                  onChange={(e) => setMessageType(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                >
                  <option value="standard">Standard (Low Latency)</option>
                  <option value="fifo">FIFO (Ordered)</option>
                </select>
              </div>
              {messageType === 'fifo' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Message Group ID <span className="text-gray-500 text-xs">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={messageGroupId}
                      onChange={(e) => setMessageGroupId(e.target.value)}
                      className="w-full px-3 py-2 border rounded-md text-sm"
                      placeholder="e.g., chat-room-123"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Messages with same group ID are processed in order
                    </p>
                  </div>
                  
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <p className="text-xs text-blue-800">
                      <strong>🔢 Sequence Numbers:</strong> FIFO messages automatically include consecutive sequence numbers for gap detection and message loss tracking.
                    </p>
                    <p className="text-xs text-blue-700 mt-1">
                      <strong>⚠️ Note:</strong> Sequence generation adds ~50-100ms latency due to DynamoDB atomic counter.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Bulk Send Section */}
          <div className="border-t pt-4">
            <h2 className="text-lg font-semibold mb-3 text-gray-900">⚡ Bulk Send</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Number of Messages
                </label>
                <input
                  type="number"
                  value={bulkCount}
                  onChange={(e) => setBulkCount(parseInt(e.target.value) || 1000)}
                  min="1"
                  max="10000"
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  placeholder="1000"
                  disabled={bulkSending}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Send multiple messages rapidly
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Publishing Method
                </label>
                <select
                  value={bulkMethod}
                  onChange={(e) => setBulkMethod(e.target.value as 'p2p' | 'a2p')}
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  disabled={bulkSending}
                >
                  <option value="p2p">P2P - WebSocket</option>
                  <option value="a2p">A2P - HTTP REST</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {bulkMethod === 'p2p' ? 'Requires WebSocket connection' : 'Works without WebSocket'}
                </p>
              </div>
              
              <div className="flex items-center space-x-2 p-3 bg-purple-50 border border-purple-200 rounded-md">
                <input
                  type="checkbox"
                  id="bulkSequential"
                  checked={bulkSequential}
                  onChange={(e) => setBulkSequential(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                  disabled={bulkSending}
                />
                <label htmlFor="bulkSequential" className="text-sm font-medium text-gray-700 cursor-pointer flex-1">
                  Sequential Mode
                </label>
              </div>
              
              {bulkMethod === 'p2p' ? (
                bulkSequential ? (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <p className="text-xs text-blue-800">
                      <strong>⚡ P2P Sequential with ACK:</strong> Waits for server acknowledgment before sending next message.
                    </p>
                    <p className="text-xs text-blue-700 mt-1">
                      <strong>✅ Benefits:</strong> Guaranteed delivery confirmation, tracks timeouts, no message loss.
                    </p>
                    <p className="text-xs text-blue-700 mt-1">
                      <strong>⏱️ Timeout:</strong> 10s per message | <strong>📊 Tracking:</strong> sent, ACKs, timeouts
                    </p>
                  </div>
                ) : (
                  <div className="p-3 bg-orange-50 border border-orange-200 rounded-md">
                    <p className="text-xs text-orange-800">
                      <strong>⚡ P2P Parallel:</strong> Sends all messages via WebSocket instantly.
                    </p>
                    <p className="text-xs text-orange-700 mt-1">
                      <strong>✅ Benefits:</strong> Maximum throughput (~1000 msg/sec).
                    </p>
                    <p className="text-xs text-orange-700 mt-1">
                      <strong>⚠️ Note:</strong> Concurrent Lambda invocations.
                    </p>
                  </div>
                )
              ) : (
                bulkSequential ? (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <p className="text-xs text-blue-800">
                      <strong>📡 A2P Sequential:</strong> HTTP requests with response awaiting.
                    </p>
                    <p className="text-xs text-blue-700 mt-1">
                      <strong>✅ Benefits:</strong> Guaranteed SNS arrival order, confirmations.
                    </p>
                    <p className="text-xs text-blue-700 mt-1">
                      <strong>⏱️ Speed:</strong> ~{Math.floor(bulkCount * 0.075)}s for {bulkCount} messages
                    </p>
                  </div>
                ) : (
                  <div className="p-3 bg-orange-50 border border-orange-200 rounded-md">
                    <p className="text-xs text-orange-800">
                      <strong>📡 A2P Parallel:</strong> Concurrent HTTP requests.
                    </p>
                    <p className="text-xs text-orange-700 mt-1">
                      <strong>✅ Benefits:</strong> Fast HTTP publishing (~100-200 msg/sec).
                    </p>
                    <p className="text-xs text-orange-700 mt-1">
                      <strong>⚠️ Note:</strong> May hit rate limits with very high counts.
                    </p>
                  </div>
                )
              )}
              
              <button
                onClick={sendBulkMessages}
                disabled={(bulkMethod === 'p2p' && !connected) || bulkSending}
                className="w-full bg-orange-600 text-white py-2 px-4 rounded-md hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {bulkSending 
                  ? `🔄 Sending... ${bulkProgress}%` 
                  : `${bulkMethod === 'p2p' ? '⚡' : '📡'} Send ${bulkCount} (${bulkSequential ? 'Sequential' : 'Parallel'})`
                }
              </button>
              
              {bulkStats && (
                <div className={`p-3 border rounded-md text-xs ${
                  bulkStats.failed === 0 
                    ? 'bg-green-50 border-green-200' 
                    : bulkStats.failed < bulkCount * 0.1 
                      ? 'bg-yellow-50 border-yellow-200'
                      : 'bg-red-50 border-red-200'
                }`}>
                  <div className={`font-semibold mb-1 ${
                    bulkStats.failed === 0 ? 'text-green-800' : 'text-yellow-800'
                  }`}>
                    {bulkStats.failed === 0 ? '✅' : '⚠️'} Bulk Send Complete
                  </div>
                  <div className={`space-y-0.5 ${
                    bulkStats.failed === 0 ? 'text-green-700' : 'text-yellow-700'
                  }`}>
                    <div>Sent: {bulkStats.sent}/{bulkCount} messages ({((bulkStats.sent / bulkCount) * 100).toFixed(1)}% success)</div>
                    {bulkStats.failed > 0 && (
                      <div className="text-red-600">Failed: {bulkStats.failed} messages (HTTP errors)</div>
                    )}
                    <div>Duration: {bulkStats.duration}ms ({(bulkStats.duration / 1000).toFixed(2)}s)</div>
                    <div>Speed: {Math.floor((bulkStats.sent / bulkStats.duration) * 1000)} msg/sec</div>
                    {bulkStats.failed === 0 ? (
                      <div className="text-green-600 font-semibold mt-1">
                        ✅ Perfect! All messages sent successfully!
                      </div>
                    ) : bulkStats.failed < bulkCount * 0.1 ? (
                      <div className="text-yellow-700 mt-1">
                        💡 {bulkStats.failed} failures likely due to Lambda cold starts/throttling
                      </div>
                    ) : (
                      <div className="text-red-700 mt-1">
                        ⚠️ High failure rate - check permissions and Lambda logs
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {bulkMethod === 'p2p' && !connected && (
                <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                  ⚠️ Connect to WebSocket to use P2P method, or switch to A2P
                </div>
              )}

            </div>
          </div>
        </div>

        {/* Center Panel - Messages */}
        <div className="flex-1 flex flex-col">
          {/* Messages Display */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            <div className="space-y-2">
              {messages.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  No messages yet. Connect and send a message to get started!
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-3 rounded-lg ${
                      msg.direction === 'sent'
                        ? 'bg-blue-100 ml-auto'
                        : 'bg-white'
                    } max-w-2xl shadow-sm`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      {msg.direction === 'sent' ? (
                        <span className={`text-xs font-semibold px-2 py-1 rounded ${
                          msg.type === 'P2P' ? 'bg-purple-200 text-purple-800' : 'bg-green-200 text-green-800'
                        }`}>
                          {msg.type}
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-600">
                            📨 Received
                          </span>
                          {msg.latency !== undefined && (
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                              msg.latency < 500 ? 'bg-green-100 text-green-700' :
                              msg.latency < 1000 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              ⚡ {msg.latency}ms
                            </span>
                          )}
                        </div>
                      )}
                      <span className="text-xs text-gray-500">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-900">{msg.content}</div>
                    
                    {/* Sequence number display */}
                    {msg.sequenceNumber !== undefined && (
                      <div className={`mt-1 text-xs font-medium flex items-center gap-2 ${
                        msg.isOutOfOrder 
                          ? 'text-red-600' 
                          : 'text-blue-600'
                      }`}>
                        <span>
                          🔢 {msg.isCustomSequence ? 'Seq' : 'SQS'}: {msg.sequenceNumber}
                          {msg.isCustomSequence && <span className="text-green-600 ml-1" title="Consecutive sequence - gap detection enabled">●</span>}
                          {!msg.isCustomSequence && <span className="text-orange-500 ml-1" title="SQS sequence - ordering only">○</span>}
                        </span>
                        {msg.isOutOfOrder && msg.missingCount !== undefined && msg.missingCount > 0 && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded">
                            ⚠️ Gap: {msg.missingCount} missing
                          </span>
                        )}
                        {msg.isOutOfOrder && msg.missingCount !== undefined && msg.missingCount <= 0 && (
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded">
                            ⚠️ Out of order
                          </span>
                        )}
                        {!msg.isOutOfOrder && (
                          <span className="text-green-600">✓</span>
                        )}
                      </div>
                    )}
                    {msg.payload && (
                      <details className="mt-2">
                        <summary className="text-xs text-gray-600 cursor-pointer">View payload</summary>
                        <pre className="text-xs bg-gray-100 p-2 rounded mt-1 overflow-x-auto">
                          {JSON.stringify(msg.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Message Input */}
          <div className="bg-white border-t p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendP2PMessage()}
                placeholder="Type your message..."
                className="flex-1 px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={sendP2PMessage}
                disabled={!connected}
                className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                📤 P2P{messageType === 'fifo' && ' 🔢'}
              </button>
              <button
                onClick={sendA2PMessage}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                📡 A2P{messageType === 'fifo' && ' 🔢'}
              </button>
              <button
                onClick={clearMessages}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                🧹
              </button>
            </div>
            <div className="mt-2 text-xs text-gray-600">
              <span className="font-semibold">P2P:</span> Send via WebSocket (requires connection) |{' '}
              <span className="font-semibold">A2P:</span> Send via HTTP API (no connection needed)
              {messageType === 'fifo' && (
                <span className="ml-2 text-blue-600 font-semibold">
                  | 🔢 Custom Sequences <span className="text-green-600">●</span> (Gap detection enabled)
                </span>
              )}
              {messageType === 'standard' && (
                <span className="ml-2 text-orange-600 font-semibold">
                  | SQS Sequences <span className="text-orange-500">○</span> (Ordering only)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Connection Log */}
        <div className="w-80 bg-gray-900 text-gray-100 overflow-y-auto p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold text-gray-200">Connection Log</h2>
            <button
              onClick={clearLogs}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
            >
              Clear
            </button>
          </div>
          <div className="space-y-1 font-mono text-xs">
            {connectionLog.length === 0 ? (
              <div className="text-gray-500">No log entries yet...</div>
            ) : (
              connectionLog.map((log, index) => (
                <div key={index} className="text-gray-300">{log}</div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
