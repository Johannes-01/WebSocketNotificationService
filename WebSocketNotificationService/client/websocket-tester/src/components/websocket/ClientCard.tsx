'use client';

import { useState, useRef, useEffect } from 'react';
import { Client, Message } from '../MultiClientTester';

interface ClientCardProps {
  client: Client;
  onConnect: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
  onSendP2P: (clientId: string, targetClass: string, targetId: string, eventType: string, content: string, messageType: string, messageGroupId?: string) => void;
  onSendA2P: (clientId: string, targetClass: string, targetId: string, eventType: string, content: string, messageType: string, messageGroupId?: string) => void;
  onClearMessages: () => void;
}

export default function ClientCard({
  client,
  onConnect,
  onDisconnect,
  onRemove,
  onSendP2P,
  onSendA2P,
  onClearMessages
}: ClientCardProps) {
  const [messageContent, setMessageContent] = useState('');
  const [targetClass, setTargetClass] = useState<'user' | 'org' | 'hub' | 'project'>('user');
  const [targetId, setTargetId] = useState('');
  const [eventType, setEventType] = useState('notification');
  const [messageType, setMessageType] = useState<'standard' | 'fifo'>('standard');
  const [messageGroupId, setMessageGroupId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [client.messages]);

  const handleSendP2P = () => {
    onSendP2P(client.id, targetClass, targetId, eventType, messageContent, messageType, messageGroupId);
    setMessageContent('');
  };

  const handleSendA2P = () => {
    onSendA2P(client.id, targetClass, targetId, eventType, messageContent, messageType, messageGroupId);
    setMessageContent('');
  };

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 flex flex-col h-[600px]">
      {/* Client Header */}
      <div className={`p-3 border-b ${client.connected ? 'bg-green-50' : client.connecting ? 'bg-yellow-50' : 'bg-gray-50'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${client.connected ? 'bg-green-500 animate-pulse' : client.connecting ? 'bg-yellow-500 animate-pulse' : 'bg-gray-400'}`} />
            <h3 className="font-semibold text-sm text-gray-900 truncate">
              {client.userId}
            </h3>
          </div>
          <button
            onClick={onRemove}
            className="text-red-600 hover:text-red-800 text-sm font-medium"
            title="Remove client"
          >
            ✕
          </button>
        </div>
        <div className="text-xs text-gray-600 space-y-0.5">
          {client.hubId && <div>Hub: {client.hubId}</div>}
          {client.orgId && <div>Org: {client.orgId}</div>}
          {client.projectId && <div>Project: {client.projectId}</div>}
        </div>
        <div className="mt-2 flex gap-2">
          {!client.connected && !client.connecting && (
            <button
              onClick={onConnect}
              className="flex-1 bg-green-600 text-white py-1 px-2 rounded text-xs hover:bg-green-700 transition-colors font-medium"
            >
              🔌 Connect
            </button>
          )}
          {client.connecting && (
            <button
              disabled
              className="flex-1 bg-yellow-500 text-white py-1 px-2 rounded text-xs cursor-not-allowed font-medium"
            >
              ⏳ Connecting...
            </button>
          )}
          {client.connected && (
            <button
              onClick={onDisconnect}
              className="flex-1 bg-red-600 text-white py-1 px-2 rounded text-xs hover:bg-red-700 transition-colors font-medium"
            >
              🔌 Disconnect
            </button>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="bg-gray-200 text-gray-700 py-1 px-2 rounded text-xs hover:bg-gray-300 transition-colors"
            title="Toggle settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="p-3 bg-gray-50 border-b space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-700 font-medium mb-1">Target Class</label>
              <select
                value={targetClass}
                onChange={(e) => setTargetClass(e.target.value as any)}
                className="w-full px-2 py-1 border rounded text-xs"
              >
                <option value="user">User</option>
                <option value="org">Org</option>
                <option value="hub">Hub</option>
                <option value="project">Project</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Target ID</label>
              <input
                type="text"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="e.g., user123"
                className="w-full px-2 py-1 border rounded text-xs"
              />
            </div>
          </div>
          <div>
            <label className="block text-gray-700 font-medium mb-1">Event Type</label>
            <input
              type="text"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              placeholder="e.g., notification"
              className="w-full px-2 py-1 border rounded text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-700 font-medium mb-1">Message Type</label>
              <select
                value={messageType}
                onChange={(e) => setMessageType(e.target.value as any)}
                className="w-full px-2 py-1 border rounded text-xs"
              >
                <option value="standard">Standard</option>
                <option value="fifo">FIFO</option>
              </select>
            </div>
            {messageType === 'fifo' && (
              <div>
                <label className="block text-gray-700 font-medium mb-1">Group ID</label>
                <input
                  type="text"
                  value={messageGroupId}
                  onChange={(e) => setMessageGroupId(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-2 py-1 border rounded text-xs"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-3 bg-gray-50 space-y-2">
        {client.messages.length === 0 ? (
          <div className="text-center text-gray-500 text-xs py-4">
            No messages yet
          </div>
        ) : (
          <>
            {client.messages.map((msg) => (
              <div
                key={msg.id}
                className={`p-2 rounded ${
                  msg.direction === 'sent'
                    ? 'bg-blue-100 ml-auto'
                    : 'bg-white'
                } max-w-[85%] shadow-sm`}
              >
                <div className="flex items-center justify-between mb-1">
                  {msg.direction === 'sent' ? (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      msg.type === 'P2P' ? 'bg-purple-200 text-purple-800' : 'bg-green-200 text-green-800'
                    }`}>
                      {msg.type}
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-gray-600">
                      📨 Received
                    </span>
                  )}
                  <span className="text-[10px] text-gray-500">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-xs text-gray-900 break-words">{msg.content}</div>
                {msg.payload && (
                  <details className="mt-1">
                    <summary className="text-[10px] text-gray-600 cursor-pointer">Payload</summary>
                    <pre className="text-[10px] bg-gray-100 p-1 rounded mt-1 overflow-x-auto">
                      {JSON.stringify(msg.payload, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Message Input */}
      <div className="p-2 border-t bg-white">
        <div className="flex gap-1 mb-1">
          <input
            type="text"
            value={messageContent}
            onChange={(e) => setMessageContent(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && client.connected && handleSendP2P()}
            placeholder="Type message..."
            className="flex-1 px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleSendP2P}
            disabled={!client.connected || !messageContent.trim()}
            className="px-2 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            title="Send via WebSocket (P2P)"
          >
            P2P
          </button>
          <button
            onClick={handleSendA2P}
            disabled={!messageContent.trim()}
            className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            title="Send via HTTP API (A2P)"
          >
            A2P
          </button>
          <button
            onClick={onClearMessages}
            className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300 transition-colors"
            title="Clear messages"
          >
            🧹
          </button>
        </div>
      </div>
    </div>
  );
}
