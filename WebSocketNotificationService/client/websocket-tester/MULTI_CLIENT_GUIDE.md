# Multi-Client WebSocket Tester

## Overview
The Multi-Client WebSocket Tester allows you to manage multiple WebSocket connections simultaneously, making it perfect for testing complex scenarios like client-to-client messaging, load testing, and simulating multiple users.

## Features

### ✨ Key Capabilities
- **Multiple Simultaneous Connections**: Create and manage unlimited WebSocket clients
- **Independent Client Configuration**: Each client can have unique User ID, Hub ID, Org ID, and Project ID
- **Per-Client Chat Interface**: Each client has its own message history and input area
- **P2P and A2P Messaging**: Send messages via WebSocket (P2P) or HTTP API (A2P) from any client
- **Centralized Connection Log**: Monitor all client activities in a single log panel
- **Individual Message Settings**: Configure target class, event type, message type, and group ID per client
- **Real-time Status Indicators**: Visual feedback for connection state (connected, connecting, disconnected)

## User Interface

### Layout
```
┌─────────────────────────────────────────────────────────────────┐
│                          Header                                  │
│  [← Home] [Single Client Mode] [Sign Out]                      │
├──────────────┬──────────────────────────────────┬───────────────┤
│              │                                   │               │
│ Add New      │      Client Grid View             │  Connection  │
│ Client Form  │  (Multiple client cards)          │      Log     │
│              │                                   │               │
│              │  ┌─────────┐ ┌─────────┐         │               │
│              │  │Client 1 │ │Client 2 │         │               │
│              │  │         │ │         │         │               │
│              │  │Messages │ │Messages │         │               │
│              │  │  Input  │ │  Input  │         │               │
│              │  └─────────┘ └─────────┘         │               │
│              │                                   │               │
└──────────────┴──────────────────────────────────┴───────────────┘
```

### Left Panel - Add New Client
- **User ID** (required): Unique identifier for the client
- **Hub ID**: Optional hub identifier
- **Org ID**: Optional organization identifier  
- **Project ID**: Optional project identifier
- **Add Client** button: Creates a new client card

### Center Panel - Client Grid
Each client card displays:
- **Header**: Connection status indicator, User ID, and remove button
- **Client Info**: Hub, Org, and Project IDs (if configured)
- **Connection Controls**: Connect/Disconnect button and Settings toggle
- **Settings Panel** (collapsible):
  - Target Class (user/org/hub/project)
  - Target ID
  - Event Type
  - Message Type (standard/FIFO)
  - Message Group ID (for FIFO messages)
- **Message Area**: Scrollable message history
- **Input Area**: Message input with P2P, A2P, and Clear buttons

### Right Panel - Connection Log
- Real-time log of all client activities
- Color-coded entries with timestamps
- Client ID prefixes for easy tracking
- Clear button to reset the log

## Usage Guide

### Creating Clients

1. **Add a New Client**:
   - Fill in the User ID (required)
   - Optionally add Hub ID, Org ID, and Project ID
   - Click "Add Client"

2. **Configure Multiple Clients**:
   - Create clients with different User IDs to simulate multiple users
   - Use the same Org/Hub IDs to test group messaging
   - Mix configurations to test various targeting scenarios

### Connecting Clients

1. **Connect Individual Client**:
   - Click the "Connect" button on any client card
   - Watch the status indicator change to yellow (connecting) then green (connected)
   - Connection details appear in the log panel

2. **Manage Connections**:
   - Each client connects independently
   - You can have any combination of connected/disconnected clients
   - Disconnect button appears when connected

### Sending Messages

#### P2P (Person-to-Person) Messages
- **Requires**: Active WebSocket connection
- **How**: Type message and click "P2P" button
- **Advantage**: Lower latency, real-time delivery
- **Use Case**: Chat messages, live notifications

#### A2P (Application-to-Person) Messages  
- **Requires**: Valid authentication token (no active connection needed)
- **How**: Type message and click "A2P" button
- **Advantage**: Works without active connection, reliable delivery
- **Use Case**: System notifications, scheduled messages

### Configuring Message Settings

1. **Open Settings**:
   - Click the ⚙️ button in the client header
   - Settings panel expands below the header

2. **Configure Target**:
   - **Target Class**: Select who should receive the message (user/org/hub/project)
   - **Target ID**: Specify the exact recipient (e.g., "user456")
   - **Event Type**: Define the message category (e.g., "notification", "chat")

3. **Configure Message Type**:
   - **Standard**: High throughput, best-effort delivery (recommended for most cases)
   - **FIFO**: Ordered delivery, sequential processing (for message ordering)
   - **Message Group ID**: Group related FIFO messages together (optional)

### Testing Scenarios

#### Scenario 1: Client-to-Client Messaging
```
1. Create Client A (userId: "user1")
2. Create Client B (userId: "user2")
3. Connect both clients
4. In Client A settings:
   - Target Class: "user"
   - Target ID: "user2"
5. Send P2P message from Client A
6. Watch message appear in Client B's message area
```

#### Scenario 2: Broadcast to Organization
```
1. Create multiple clients with same Org ID (e.g., "org1")
2. Connect all clients
3. Use A2P to send message with:
   - Target Class: "org"
   - Target ID: "org1"
4. All clients in org1 receive the message
```

#### Scenario 3: FIFO Message Ordering
```
1. Create a client and connect
2. Enable FIFO message type in settings
3. Set Message Group ID (e.g., "conversation-123")
4. Send multiple messages rapidly
5. Messages are processed in order they were sent
```

## Message Display

### Message Card Components
- **Type Badge**: Color-coded indicator (P2P = purple, A2P = green)
- **Direction**: "📨 Received" or sent indicator
- **Timestamp**: When the message was sent/received
- **Content**: The actual message text
- **Payload Details**: Expandable section showing full message structure

### Message Colors
- **Blue background**: Messages you sent
- **White background**: Messages you received

## Connection States

### Visual Indicators
- 🟢 **Green (pulsing)**: Connected and active
- 🟡 **Yellow (pulsing)**: Connecting in progress
- ⚪ **Gray**: Disconnected

### Connection Lifecycle
1. **Disconnected**: Initial state, can edit connection parameters
2. **Connecting**: WebSocket handshake in progress
3. **Connected**: Active connection, can send/receive messages
4. **Disconnected**: Connection closed or failed

## Log Entries

### Log Entry Format
```
[HH:MM:SS] [CLIENT_ID] Message
```

### Common Log Messages
- ✅ `Client created`: New client added to grid
- 🔌 `Connecting to WebSocket...`: Connection attempt started
- ✅ `Connected successfully`: WebSocket connection established
- 📨 `Received message`: Incoming message detected
- 📤 `Sent P2P to...`: P2P message sent via WebSocket
- 📤 `Sending A2P via HTTP...`: A2P message sent via REST API
- ✅ `A2P sent - MessageId: ...`: A2P delivery confirmed
- 🔌 `Disconnected`: Connection closed
- 🗑️ `Client removed`: Client deleted from grid
- 🧹 `Messages cleared`: Message history reset

## Tips and Best Practices

### Performance
- **Limit Active Connections**: While you can create many clients, keep active connections reasonable (10-20 max)
- **Clear Messages Regularly**: Use the 🧹 button to clear old messages and improve performance
- **Clear Logs**: Periodically clear the connection log to keep it readable

### Testing Strategies
1. **Start Simple**: Begin with 2 clients to understand the flow
2. **Test One Feature**: Focus on one messaging scenario at a time
3. **Monitor Logs**: Keep an eye on the log panel for errors or warnings
4. **Use Meaningful IDs**: Use descriptive User IDs to track clients easily

### Troubleshooting
- **Connection Fails**: Check authentication token, verify endpoint configuration
- **Messages Not Received**: Verify target ID matches recipient's User/Org/Hub ID
- **Slow Performance**: Reduce number of active connections, clear old messages
- **FIFO Messages Out of Order**: Ensure Message Group ID is consistent

## Keyboard Shortcuts
- **Enter**: Send P2P message (when message input is focused and client is connected)

## Advanced Features

### Message Group IDs
When using FIFO message type, the Message Group ID allows you to:
- Group related messages together
- Ensure messages within a group are processed in order
- Isolate different conversation threads

Example:
```
Group ID: "chat-room-123" → All messages in this chat room are ordered
Group ID: "task-updates"   → All task updates are ordered separately
```

## Integration Examples

### Testing Multi-User Chat
```
1. Create 3 clients: Alice, Bob, Carol
2. All connect to the same Hub ID
3. Each sends messages to the hub
4. All receive each other's messages
```

### Testing Organizational Broadcasts
```
1. Create 5 clients in "org1", 3 clients in "org2"
2. Connect all clients
3. Send A2P message targeting "org1"
4. Only org1 clients receive the message
```

### Load Testing
```
1. Create 10-15 clients with unique User IDs
2. Connect all simultaneously
3. Send rapid messages from multiple clients
4. Monitor log for performance and errors
```

## Technical Details

### WebSocket Connection URL
```
wss://{endpoint}?token={authToken}&userId={userId}&hubId={hubId}&orgId={orgId}&projectId={projectId}
```

### P2P Message Format
```json
{
  "action": "sendMessage",
  "targetChannel": "WebSocket",
  "messageType": "standard|fifo",
  "messageGroupId": "optional-group-id",
  "payload": {
    "targetId": "recipient-id",
    "targetClass": "user|org|hub|project",
    "eventType": "notification|chat|etc",
    "content": "message content",
    "timestamp": "ISO-8601 timestamp"
  }
}
```

### A2P HTTP Request
```bash
POST /publish
Authorization: Bearer {token}
Content-Type: application/json

{
  "targetChannel": "WebSocket",
  "messageType": "standard|fifo",
  "messageGroupId": "optional-group-id",
  "payload": {
    "targetId": "recipient-id",
    "targetClass": "user|org|hub|project",
    "eventType": "notification|chat|etc",
    "content": "message content",
    "timestamp": "ISO-8601 timestamp"
  }
}
```

## Comparison: Single vs Multi-Client Mode

| Feature | Single Client | Multi-Client |
|---------|---------------|--------------|
| Connections | 1 | Unlimited |
| Interface | Full screen chat | Grid of client cards |
| Configuration | Left panel | Per-client settings |
| Use Case | Simple testing | Complex scenarios |
| Message View | Large, detailed | Compact, focused |
| Best For | Learning, debugging | Load testing, P2P testing |

## Navigation

- **Home**: Returns to the mode selection screen
- **Single Client Mode**: Switches to single-client tester
- **Sign Out**: Disconnects all clients and logs out

## Future Enhancements (Planned)

- [ ] Client templates for quick setup
- [ ] Message history export
- [ ] Connection statistics dashboard
- [ ] Bulk client creation
- [ ] Message scheduling
- [ ] Performance metrics per client
- [ ] WebSocket reconnection with exponential backoff
- [ ] Toast notifications for important events
