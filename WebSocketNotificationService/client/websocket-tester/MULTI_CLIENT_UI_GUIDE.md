# Multi-Client UI - Visual Guide

## 🎨 User Interface Overview

### Landing Page (/)
```
┌──────────────────────────────────────────────────────────────────┐
│  WebSocket Notification Service                    [Sign Out]    │
│  Signed in as: user@example.com                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│              Choose Your Testing Interface                       │
│         Select the appropriate interface for your                │
│                    testing needs                                 │
│                                                                   │
│  ┌───────────────────────────┐  ┌────────────────────────────┐ │
│  │          🔌                │  │        🔌🔌🔌              │ │
│  │  Single Client Tester      │  │  Multi-Client Tester       │ │
│  │                            │  │                            │ │
│  │  Test with a single        │  │  Manage multiple WebSocket │ │
│  │  WebSocket connection.     │  │  connections simultaneously│ │
│  │  Ideal for basic testing   │  │  Perfect for testing       │ │
│  │  and debugging.            │  │  client-to-client messaging│ │
│  │                            │  │                            │ │
│  │  ✓ Simple interface        │  │  ✓ Multiple connections    │ │
│  │  ✓ P2P and A2P messaging   │  │  ✓ Client-to-client msgs   │ │
│  │  ✓ Detailed logs           │  │  ✓ Independent configs     │ │
│  │  ✓ Payload inspection      │  │  ✓ Centralized monitoring  │ │
│  │                            │  │                            │ │
│  │  [Launch Single Client →]  │  │  [Launch Multi-Client →]   │ │
│  └───────────────────────────┘  └────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Quick Guide                                                  ││
│  │ Single Client: Focus on one connection at a time            ││
│  │ Multi-Client: Simulate multiple users simultaneously        ││
│  │ P2P vs A2P: P2P=WebSocket (low latency), A2P=HTTP (reliable)││
│  └─────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### Multi-Client Interface (/multi-client)
```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [← Home] Multi-Client WebSocket Tester        [Single Mode] [Sign Out]          │
│ Signed in as: user@example.com | Active: 3 | Connected: 2                       │
├─────────────────┬────────────────────────────────────────────┬──────────────────┤
│                 │                                             │                  │
│ Add New Client  │          Client Grid View                  │ Connection Log   │
│                 │                                             │                  │
│ User ID *       │  ┌────────────┐ ┌────────────┐            │ [Clear]          │
│ [alice_____]    │  │ 🟢 alice   │ │ 🟢 bob     │ [✕]        │                  │
│                 │  │ Hub: hub1  │ │ Hub: hub1  │            │ [12:30:45]       │
│ Hub ID          │  │ Org: org1  │ │ Org: org1  │            │ [alice...] ✅    │
│ [hub1______]    │  │            │ │            │            │ Connected        │
│                 │  │[Disconnect]│ │[Disconnect]│ [⚙️]       │                  │
│ Org ID          │  ├────────────┤ ├────────────┤            │ [12:30:52]       │
│ [org1______]    │  │ 📨 Recv    │ │ 📨 Recv    │            │ [bob...] 📨      │
│                 │  │ Hello!     │ │ How are you│            │ Received msg     │
│ Project ID      │  │ 12:30:45   │ │ 12:30:50   │            │                  │
│ [__________]    │  │            │ │            │            │ [12:30:55]       │
│                 │  │ P2P sent   │ │ P2P sent   │            │ [alice...] 📤    │
│ [Add Client]    │  │ Hi Bob!    │ │ Good!      │            │ Sent P2P to      │
│                 │  │ 12:30:48   │ │ 12:30:53   │            │ user:bob         │
│ Quick Tips:     │  │            │ │            │            │                  │
│ • Create        │  │ [Payload▼] │ │            │            │ [12:31:00]       │
│   multiple      │  ├────────────┤ ├────────────┤            │ [charlie...] ✅  │
│   clients       │  │[message__]│  │[message__]│             │ Client created   │
│ • Each has own  │  │[P2P][A2P] │  │[P2P][A2P] │             │                  │
│   connection    │  │     [🧹]  │  │     [🧹]  │             │                  │
│ • Test P2P      │  └────────────┘ └────────────┘            │                  │
│   messaging     │                                             │                  │
│ • Monitor logs  │  ┌────────────┐                            │                  │
│                 │  │ ⚪ charlie │ [✕]                        │                  │
│                 │  │ Hub: hub2  │                            │                  │
│                 │  │ Org: org2  │                            │                  │
│                 │  │            │                            │                  │
│                 │  │ [Connect]  │ [⚙️]                       │                  │
│                 │  ├────────────┤                            │                  │
│                 │  │ No messages│                            │                  │
│                 │  │    yet     │                            │                  │
│                 │  │            │                            │                  │
│                 │  ├────────────┤                            │                  │
│                 │  │[message__]│                             │                  │
│                 │  │[P2P][A2P] │                             │                  │
│                 │  │     [🧹]  │                             │                  │
│                 │  └────────────┘                            │                  │
└─────────────────┴────────────────────────────────────────────┴──────────────────┘
```

### Client Card - Settings Expanded
```
┌────────────────────────────┐
│ 🟢 alice              [✕]  │
│ Hub: hub1                  │
│ Org: org1                  │
│ [Disconnect]          [⚙️] │
├────────────────────────────┤
│ ⚙️ Settings                │
│ Target Class   Target ID   │
│ [User ▼]      [bob____]    │
│                            │
│ Event Type                 │
│ [notification_________]    │
│                            │
│ Message Type   Group ID    │
│ [FIFO ▼]      [chat-1__]   │
│                            │
│ ℹ️ Messages with same      │
│    group ID are ordered    │
├────────────────────────────┤
│ 📨 Received                │
│ Hello Alice!               │
│ 12:30:45          [Payload]│
│                            │
│ P2P sent                   │
│ Hi Bob!                    │
│ 12:30:48                   │
├────────────────────────────┤
│ [Type message here......] │
│ [P2P] [A2P] [🧹]          │
└────────────────────────────┘
```

### Single Client Interface (/single-client)
```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [← Home] Single Client Tester                 [Multi Mode] [Sign Out]           │
│ Signed in as: user@example.com                                                   │
├─────────────────┬────────────────────────────────────────────┬──────────────────┤
│                 │                                             │                  │
│ Connection      │          Messages                          │ Connection Log   │
│                 │                                             │                  │
│ User ID         │  No messages yet. Connect and send a       │ [Clear]          │
│ [user123___]    │  message to get started!                   │                  │
│                 │                                             │                  │
│ Hub ID          │  OR                                         │                  │
│ [hub1______]    │                                             │                  │
│                 │  📨 Received          12:30:45              │                  │
│ Org ID          │  Welcome message from server               │                  │
│ [org1______]    │  [View payload ▼]                          │                  │
│                 │                                             │                  │
│ Project ID      │  P2P sent             12:30:50              │                  │
│ [project1__]    │  Hello from client                         │                  │
│                 │                                             │                  │
│ [🔌 Connect]    │  A2P sent             12:31:00              │                  │
│                 │  HTTP API message                          │                  │
│ Message Settings│                                             │                  │
│                 │                                             │                  │
│ Target Class    │                                             │                  │
│ [User ▼]        │                                             │                  │
│                 │                                             │                  │
│ Target ID       │                                             │                  │
│ [user123___]    │                                             │                  │
│                 │                                             │                  │
│ Event Type      ├─────────────────────────────────────────────┤                  │
│ [notification]  │ [Type your message.....................]    │                  │
│                 │ [📤 P2P] [📡 A2P] [🧹]                      │                  │
│ Message Type    │                                             │                  │
│ [Standard ▼]    │ P2P: Via WebSocket | A2P: Via HTTP API     │                  │
│                 │                                             │                  │
└─────────────────┴────────────────────────────────────────────┴──────────────────┘
```

## 🎨 Color Scheme

### Status Indicators
- **🟢 Green (pulsing)**: Connected
- **🟡 Yellow (pulsing)**: Connecting
- **⚪ Gray**: Disconnected

### Message Type Badges
- **Purple background**: P2P messages
- **Green background**: A2P messages

### Message Backgrounds
- **Blue (light)**: Sent messages
- **White**: Received messages

### Buttons
- **Blue**: Primary actions (Connect, Single Mode)
- **Purple**: Multi-client mode
- **Green**: Success actions (P2P send)
- **Red**: Destructive actions (Disconnect, Sign Out, Remove)
- **Gray**: Neutral actions (Clear, Settings)

## 📱 Responsive Layout

### Desktop (2xl: 1536px+)
```
┌────────┬─────────────────┬─────────────────┬─────────────────┬────────┐
│ Sidebar│   Client Card   │   Client Card   │   Client Card   │  Log   │
│        │                 │                 │                 │        │
└────────┴─────────────────┴─────────────────┴─────────────────┴────────┘
3 columns for client cards
```

### Laptop (xl: 1280px)
```
┌────────┬─────────────────┬─────────────────┬────────┐
│ Sidebar│   Client Card   │   Client Card   │  Log   │
│        │                 │                 │        │
└────────┴─────────────────┴─────────────────┴────────┘
2 columns for client cards
```

### Tablet (Default)
```
┌────────┬─────────────────┬────────┐
│ Sidebar│   Client Card   │  Log   │
│        │                 │        │
└────────┴─────────────────┴────────┘
1 column for client cards
```

## 🔄 State Flow Diagram

```
User Actions → State Updates → UI Re-render

1. Create Client
   └→ Add to clients array
      └→ Client card appears in grid

2. Connect Client
   └→ Set connecting=true
      └→ Yellow indicator
         └→ WebSocket handshake
            └→ Set connected=true, ws=WebSocket
               └→ Green indicator

3. Send P2P Message
   └→ ws.send(message)
      └→ Add to client.messages
         └→ Message appears in chat

4. Receive Message
   └→ ws.onmessage triggered
      └→ Add to client.messages
         └→ Message appears in chat

5. Disconnect Client
   └→ ws.close()
      └→ Set connected=false, ws=null
         └→ Gray indicator

6. Remove Client
   └→ ws.close() if connected
      └→ Remove from clients array
         └→ Card disappears from grid
```

## 💡 UI Interaction Patterns

### Adding a Client
```
1. Fill form fields
2. Click "Add Client"
3. Card appears in grid
4. Form resets for next client
```

### Connecting
```
1. Click "Connect" on card
2. Button changes to "Connecting..."
3. Dot turns yellow and pulses
4. On success:
   - Button changes to "Disconnect"
   - Dot turns green and pulses
   - Log shows success message
```

### Sending Messages
```
1. Optionally open settings (⚙️)
2. Configure target and type
3. Type message in input
4. Click "P2P" or "A2P"
5. Message appears in chat area
6. Input field clears
7. Log shows send confirmation
```

### Settings Toggle
```
1. Click ⚙️ in header
2. Panel expands/collapses
3. Settings persist when collapsed
4. Can configure without expanding
```

## 🎯 Visual Feedback

### Actions and Their Visual Responses

| Action | Visual Feedback |
|--------|----------------|
| Create client | New card appears in grid |
| Connect | Yellow → Green dot, button text changes |
| Disconnect | Green → Gray dot, button text changes |
| Send message | Message bubble appears, input clears |
| Receive message | Message bubble appears, auto-scroll |
| Remove client | Card fades and disappears |
| Clear messages | Message area empties |
| Clear log | Log panel empties |
| Toggle settings | Panel slides in/out |

## 📏 Layout Specifications

### Client Card Dimensions
- **Width**: Flexible (grid-responsive)
- **Height**: Fixed at 600px
- **Padding**: 12px (0.75rem)
- **Border**: 1px solid gray-200
- **Border Radius**: 8px (rounded-lg)
- **Shadow**: Medium shadow (shadow-md)

### Grid Spacing
- **Gap between cards**: 16px (1rem)
- **Panel padding**: 16px (1rem)

### Typography
- **Headers**: 
  - Page title: 2xl (24px), bold
  - Section title: lg (18px), semibold
  - Card title: sm (14px), semibold
- **Body text**: 
  - Regular: sm (14px)
  - Small: xs (12px)
  - Tiny: [10px] for timestamps

### Message Bubbles
- **Max width**: 85% of container
- **Padding**: 8px (0.5rem)
- **Border radius**: 4px (rounded)
- **Shadow**: sm (shadow-sm)

## 🎨 Animation Details

### Pulsing Indicators
```css
/* Green/Yellow dots pulse */
animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite
```

### Smooth Scrolling
```javascript
// Auto-scroll to latest message
messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
```

### Hover Effects
- Buttons: Darken on hover (bg-*-600 → bg-*-700)
- Cards: Shadow increase on hover
- Links: Color change on hover

## 🖼️ Icon Usage

| Icon | Meaning | Location |
|------|---------|----------|
| 🔌 | Connection | Headers, buttons |
| 🟢 | Connected | Status indicator |
| 🟡 | Connecting | Status indicator |
| ⚪ | Disconnected | Status indicator |
| ⚙️ | Settings | Client card header |
| ✕ | Remove/Close | Client card header |
| 📨 | Received | Message badge |
| 📤 | Sent P2P | Button, log |
| 📡 | Sent A2P | Button, log |
| 🧹 | Clear | Buttons |
| ← | Back | Navigation |
| ✓ | Success | Feature lists, logs |
| ❌ | Error | Logs |
| ✅ | Completed | Logs |
| 🗑️ | Removed | Logs |

---

**Visual design complete!** The UI is clean, intuitive, and provides clear feedback for all user actions. 🎨
