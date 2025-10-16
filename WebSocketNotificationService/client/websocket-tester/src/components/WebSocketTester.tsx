'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { metricsService } from '@/services/metrics';

interface Message {
  id: string;
  timestamp: string;
  direction: 'sent' | 'received';
  type: 'P2P' | 'A2P';
  content: string;
  payload?: any;
  latency?: number; // E2E latency in milliseconds
  networkLatency?: number; // Processor → client latency
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
  const [generateSequence, setGenerateSequence] = useState(false); // Enable custom sequence numbers
  
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
        const clientReceiveTime = new Date(); // Capture receive time immediately
        addLog(`📨 Received message: ${event.data.substring(0, 100)}...`);
        try {
          const data = JSON.parse(event.data);
          
          // Track end-to-end latency if timestamps are available
          let e2eLatency: number | undefined;
          let networkLatency: number | undefined;
          
          if (data.publishTimestamp && data.processorTimestamp) {
            const publishTime = new Date(data.publishTimestamp);
            const processorTime = new Date(data.processorTimestamp);
            
            e2eLatency = clientReceiveTime.getTime() - publishTime.getTime();
            networkLatency = clientReceiveTime.getTime() - processorTime.getTime();
            
            // Send metrics to the collector Lambda
            const token = await getIdToken();
            if (token) {
              await metricsService.trackEndToEndLatency(
                data.publishTimestamp,
                data.processorTimestamp,
                clientReceiveTime,
                token
              );
            }
            
            addLog(`📊 Latency - E2E: ${e2eLatency}ms, Network: ${networkLatency}ms`);
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
                  
                  // Track message loss metric
                  const token = await getIdToken();
                  if (token) {
                    await metricsService.trackMessageLoss(expectedSeq, currentSeq, token);
                  }
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
            networkLatency: networkLatency,
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
      };

      setWs(websocket);
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

    const message = {
      action: 'sendMessage',
      targetChannel: 'WebSocket',
      messageType,
      ...(messageType === 'fifo' && messageGroupId && { messageGroupId }),
      ...(messageType === 'fifo' && generateSequence && { generateSequence: true }),
      payload: {
        chatId,
        eventType,
        content: messageContent,
        timestamp: new Date().toISOString()
      }
    };

    ws.send(JSON.stringify(message));
    addLog(`📤 Sent P2P message to chat ${chatId}${messageType === 'fifo' && messageGroupId ? ` (group: ${messageGroupId})` : ''}${messageType === 'fifo' && generateSequence ? ' [seq]' : ''}`);

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

      const message = {
        targetChannel: 'WebSocket',
        messageType,
        ...(messageType === 'fifo' && messageGroupId && { messageGroupId }),
        ...(messageType === 'fifo' && generateSequence && { generateSequence: true }),
        payload: {
          chatId,
          eventType,
          content: messageContent,
          timestamp: new Date().toISOString()
        }
      };

      addLog(`📤 Sending A2P message via HTTP to ${endpoint}...${messageType === 'fifo' && messageGroupId ? ` (group: ${messageGroupId})` : ''}${messageType === 'fifo' && generateSequence ? ' [seq]' : ''}`);
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
                  
                  <div className="flex items-center space-x-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <input
                      type="checkbox"
                      id="generateSequence"
                      checked={generateSequence}
                      onChange={(e) => setGenerateSequence(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="generateSequence" className="text-sm font-medium text-gray-700 cursor-pointer flex-1">
                      Generate Sequence Numbers
                    </label>
                  </div>
                  {generateSequence && (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-xs text-yellow-800">
                        <strong>⚠️ Performance Note:</strong> Custom sequence generation adds ~50-100ms latency per message due to DynamoDB atomic counter.
                      </p>
                      <p className="text-xs text-yellow-700 mt-1">
                        <strong>✅ Benefits:</strong> Gap detection, message loss tracking, completeness validation.
                      </p>
                    </div>
                  )}
                </>
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
                    
                    {msg.networkLatency !== undefined && (
                      <div className="mt-1 text-xs text-gray-600">
                        Network: {msg.networkLatency}ms
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
                📤 P2P{messageType === 'fifo' && generateSequence && ' 🔢'}
              </button>
              <button
                onClick={sendA2PMessage}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                📡 A2P{messageType === 'fifo' && generateSequence && ' 🔢'}
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
              {messageType === 'fifo' && generateSequence && (
                <span className="ml-2 text-blue-600 font-semibold">
                  | 🔢 Custom Sequences <span className="text-green-600">●</span> (Gap detection enabled)
                </span>
              )}
              {messageType === 'fifo' && !generateSequence && (
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
