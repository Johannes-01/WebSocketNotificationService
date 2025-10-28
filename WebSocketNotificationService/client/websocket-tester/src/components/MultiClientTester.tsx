'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { metricsService } from '@/services/metrics';
import ClientCard from './websocket/ClientCard';
import ConnectionLog from './websocket/ConnectionLog';

export interface Message {
  id: string;
  timestamp: string;
  direction: 'sent' | 'received';
  type: 'P2P' | 'A2P';
  content: string;
  payload?: any;
  latency?: number; // E2E latency in milliseconds
  sequenceNumber?: number; // Custom consecutive sequence number
  isOutOfOrder?: boolean; // True if sequence number is not consecutive
  missingCount?: number; // Number of messages potentially lost
}

export interface Client {
  id: string;
  chatIds: string; // Comma-separated chat IDs for subscription
  ws: WebSocket | null;
  connected: boolean;
  messages: Message[];
  connecting: boolean;
  lastSequenceByScope: Record<string, number>; // Track sequences per scope (chatId)
}

export default function MultiClientTester() {
  const router = useRouter();
  const { user, getIdToken, signOut } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [connectionLog, setConnectionLog] = useState<string[]>([]);
  
  // New client form state (Phase 4: Chat-ID based)
  const [newClientChatIds, setNewClientChatIds] = useState('');

  const addLog = (message: string, clientId?: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = clientId ? `[${clientId.substring(0, 8)}...]` : '[SYSTEM]';
    setConnectionLog(prev => [...prev, `[${timestamp}] ${prefix} ${message}`]);
  };

  const createClient = () => {
    if (!newClientChatIds.trim()) {
      addLog('❌ Chat IDs are required');
      return;
    }

    const clientId = Math.random().toString(36).substring(7);
    const newClient: Client = {
      id: clientId,
      chatIds: newClientChatIds,
      ws: null,
      connected: false,
      messages: [],
      connecting: false,
      lastSequenceByScope: {}, // Initialize sequence tracking
    };

    setClients(prev => [...prev, newClient]);
    addLog(`✅ Client created: ${newClientChatIds}`, clientId);
    
    // Reset form
    setNewClientChatIds('');
  };

  const connectClient = async (clientId: string) => {
    try {
      const token = await getIdToken();
      if (!token) {
        addLog('❌ Failed to get authentication token', clientId);
        return;
      }

      const client = clients.find(c => c.id === clientId);
      if (!client) return;

      setClients(prev => prev.map(c => 
        c.id === clientId ? { ...c, connecting: true } : c
      ));

      const wsUrl = `${process.env.NEXT_PUBLIC_WEBSOCKET_ENDPOINT}?token=${token}&chatIds=${client.chatIds}`;
      addLog(`🔌 Connecting to WebSocket...`, clientId);
      addLog(`   Subscribing to chats: ${client.chatIds}`, clientId);
      
      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        addLog('✅ Connected successfully', clientId);
        setClients(prev => prev.map(c => 
          c.id === clientId ? { ...c, connected: true, ws: websocket, connecting: false } : c
        ));
      };

      websocket.onmessage = async (event) => {
        const clientReceiveTime = new Date(); // Capture receive time immediately
        addLog(`📨 Received message`, clientId);
        try {
          const data = JSON.parse(event.data);
          
          // Track end-to-end latency if timestamps are available
          let e2eLatency: number | undefined;

          if (data.publishTimestamp) {
            const publishTime = new Date(data.publishTimestamp);
            
            e2eLatency = clientReceiveTime.getTime() - publishTime.getTime();
            
            // Send metrics to the collector Lambda
            const token = await getIdToken();
            if (token) {
              await metricsService.trackEndToEndLatency(
                publishTime,
                clientReceiveTime,
                token,
                data.messageId,
                data.chatId || data.payload?.chatId
              );
            }
            
            addLog(`📊 Latency - E2E: ${e2eLatency}ms`, clientId);
          }
          
          // Track sequence numbers if present
          let sequenceNumber: number | undefined;
          let isOutOfOrder = false;
          let missingCount: number | undefined;
          
          const client = clients.find(c => c.id === clientId);
          
          if (data.sequenceNumber !== undefined && typeof data.sequenceNumber === 'number' && client) {
            const currentSeq = data.sequenceNumber;
            sequenceNumber = currentSeq;
            
            // Get scope from chatId (Phase 4: chat-based scoping)
            const scope = data.chatId || 'default';
            
            const lastSeq = client.lastSequenceByScope[scope];
            
            if (lastSeq !== undefined) {
              const expectedSeq = lastSeq + 1;
              
              if (currentSeq !== expectedSeq) {
                isOutOfOrder = true;
                missingCount = currentSeq - expectedSeq;
                
                if (missingCount > 0) {
                  addLog(`⚠️ Sequence gap! Expected: ${expectedSeq}, Got: ${currentSeq}, Missing: ${missingCount}`, clientId);
                } else {
                  addLog(`⚠️ Out-of-order sequence! Expected: ${expectedSeq}, Got: ${currentSeq}`, clientId);
                }
              } else {
                addLog(`✅ Sequence #${currentSeq} in order`, clientId);
              }
            } else {
              addLog(`🔢 First sequence: ${currentSeq} (scope: ${scope})`, clientId);
            }
            
            // Update last sequence for this scope
            setClients(prev => prev.map(c => 
              c.id === clientId 
                ? { 
                    ...c, 
                    lastSequenceByScope: {
                      ...c.lastSequenceByScope,
                      [scope]: currentSeq
                    }
                  } 
                : c
            ));
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
            isOutOfOrder,
            missingCount,
          };
          setClients(prev => prev.map(c => 
            c.id === clientId ? { ...c, messages: [...c.messages, msg] } : c
          ));
        } catch (e) {
          const msg: Message = {
            id: Math.random().toString(36),
            timestamp: new Date().toISOString(),
            direction: 'received',
            type: 'A2P',
            content: event.data,
          };
          setClients(prev => prev.map(c => 
            c.id === clientId ? { ...c, messages: [...c.messages, msg] } : c
          ));
        }
      };

      websocket.onerror = (error) => {
        addLog(`❌ WebSocket error`, clientId);
        console.error('WebSocket error:', error);
        setClients(prev => prev.map(c => 
          c.id === clientId ? { ...c, connecting: false } : c
        ));
      };

      websocket.onclose = (event) => {
        addLog(`🔌 Disconnected. Code: ${event.code}`, clientId);
        setClients(prev => prev.map(c => 
          c.id === clientId ? { ...c, connected: false, ws: null, connecting: false } : c
        ));
      };

    } catch (error) {
      addLog(`❌ Connection failed: ${error}`, clientId);
      console.error('Connection error:', error);
      setClients(prev => prev.map(c => 
        c.id === clientId ? { ...c, connecting: false } : c
      ));
    }
  };

  const disconnectClient = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (client?.ws) {
      client.ws.close();
      addLog('🔌 Disconnected manually', clientId);
    }
  };

  const removeClient = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (client?.ws) {
      client.ws.close();
    }
    setClients(prev => prev.filter(c => c.id !== clientId));
    addLog('🗑️ Client removed', clientId);
  };

  const sendP2PMessage = async (clientId: string, chatId: string, eventType: string, content: string, messageType: string, messageGroupId?: string, generateSequence?: boolean) => {
    const client = clients.find(c => c.id === clientId);
    if (!client?.ws || !client.connected) {
      addLog('❌ Not connected to WebSocket', clientId);
      return;
    }

    if (!content.trim()) {
      addLog('❌ Message content is empty', clientId);
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
        content,
        timestamp: new Date().toISOString()
      }
    };

    console.log(message);

    client.ws.send(JSON.stringify(message));
    addLog(`📤 Sent P2P to chat ${chatId}${messageType === 'fifo' && messageGroupId ? ` (group: ${messageGroupId})` : ''}${messageType === 'fifo' && generateSequence ? ' [seq]' : ''}`, clientId);

    const msg: Message = {
      id: Math.random().toString(36),
      timestamp: new Date().toISOString(),
      direction: 'sent',
      type: 'P2P',
      content,
      payload: message
    };
    
    setClients(prev => prev.map(c => 
      c.id === clientId ? { ...c, messages: [...c.messages, msg] } : c
    ));
  };

  const sendA2PMessage = async (clientId: string, chatId: string, eventType: string, content: string, messageType: string, messageGroupId?: string, generateSequence?: boolean) => {
    try {
      const token = await getIdToken();
      if (!token) {
        addLog('❌ Failed to get authentication token', clientId);
        return;
      }

      if (!content.trim()) {
        addLog('❌ Message content is empty', clientId);
        return;
      }

      const endpoint = process.env.NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT;
      if (!endpoint) {
        addLog('❌ HTTP publish endpoint not configured', clientId);
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
          content,
          timestamp: new Date().toISOString()
        }
      };

      addLog(`📤 Sending A2P via HTTP...${messageType === 'fifo' && messageGroupId ? ` (group: ${messageGroupId})` : ''}${messageType === 'fifo' && generateSequence ? ' [seq]' : ''}`, clientId);
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message)
      });

      if (response.ok) {
        const responseData = await response.json();
        addLog(`✅ A2P sent - MessageId: ${responseData.messageId}`, clientId);
        
        const msg: Message = {
          id: Math.random().toString(36),
          timestamp: new Date().toISOString(),
          direction: 'sent',
          type: 'A2P',
          content,
          payload: message
        };
        
        setClients(prev => prev.map(c => 
          c.id === clientId ? { ...c, messages: [...c.messages, msg] } : c
        ));
      } else {
        const errorText = await response.text();
        addLog(`❌ A2P failed: ${response.status}`, clientId);
        console.error('A2P Error:', errorText);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(`❌ A2P request failed: ${errorMessage}`, clientId);
      console.error('A2P error:', error);
    }
  };

  const clearClientMessages = (clientId: string) => {
    setClients(prev => prev.map(c => 
      c.id === clientId ? { ...c, messages: [] } : c
    ));
    addLog('🧹 Messages cleared', clientId);
  };

  const clearLogs = () => {
    setConnectionLog([]);
  };

  const handleSignOut = async () => {
    // Disconnect all WebSocket clients
    clients.forEach(client => {
      if (client.ws) {
        client.ws.close();
      }
    });
    await signOut();
    router.push('/signin');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clients.forEach(client => {
        if (client.ws) {
          client.ws.close();
        }
      });
    };
  }, []);

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
              <h1 className="text-2xl font-bold text-gray-900">Multi-Client WebSocket Tester</h1>
              <p className="text-sm text-gray-600">
                Signed in as: <span className="font-medium">{user?.getUsername()}</span> | 
                Active clients: <span className="font-medium">{clients.length}</span> | 
                Connected: <span className="font-medium">{clients.filter(c => c.connected).length}</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/single-client')}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              🔌 Single Client Mode
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
        {/* Left Panel - New Client Form */}
        <div className="w-80 bg-white border-r overflow-y-auto p-4">
          <h2 className="text-lg font-semibold mb-4 text-gray-900">Add New Client</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Chat IDs (comma-separated) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newClientChatIds}
                onChange={(e) => setNewClientChatIds(e.target.value)}
                placeholder="chat-123,chat-456"
                className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Subscribe to multiple chats by separating IDs with commas
              </p>
            </div>
            <button
              onClick={createClient}
              disabled={!newClientChatIds.trim()}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
            >
              ➕ Add Client
            </button>
          </div>

          <div className="mt-6 pt-6 border-t">
            <div className="text-sm text-gray-600 space-y-2">
              <p className="font-medium">Quick Tips:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>Create multiple clients with different User IDs</li>
                <li>Each client maintains its own WebSocket connection</li>
                <li>Test P2P messaging between clients</li>
                <li>Monitor all connections in the log panel</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Center Panel - Client Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {clients.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-500">
                <div className="text-6xl mb-4">🔌</div>
                <h3 className="text-xl font-semibold mb-2">No Clients Yet</h3>
                <p className="text-sm">Add a new client from the left panel to get started</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
              {clients.map(client => (
                <ClientCard
                  key={client.id}
                  client={client}
                  onConnect={() => connectClient(client.id)}
                  onDisconnect={() => disconnectClient(client.id)}
                  onRemove={() => removeClient(client.id)}
                  onSendP2P={sendP2PMessage}
                  onSendA2P={sendA2PMessage}
                  onClearMessages={() => clearClientMessages(client.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right Panel - Connection Log */}
        <ConnectionLog logs={connectionLog} onClear={clearLogs} />
      </div>
    </div>
  );
}
