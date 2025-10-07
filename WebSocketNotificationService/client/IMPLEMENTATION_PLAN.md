# Implementation Plan: WebSocket Notification Test Client

## Phase 1: Project Setup and Authentication

1. **Initial Project Setup**
   - [x] Set up Next.js project with TypeScript
   - [x] Install and configure Tailwind CSS
   - [x] Install and configure shadcn/ui components
   - [x] Set up environment variables structure
   ```env
   NEXT_PUBLIC_COGNITO_USER_POOL_ID=
   NEXT_PUBLIC_COGNITO_CLIENT_ID=
   NEXT_PUBLIC_WEBSOCKET_ENDPOINT=
   NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT=
   ```

2. **Authentication Components**
   - [x] Implement Cognito authentication service
   - [x] Create SignIn component with email/password form
   - [x] Create SignUp component with registration form
   - [x] Add authentication state management (AuthContext)
   - [x] Implement protected route middleware

## Phase 2: WebSocket Connection Manager

1. **WebSocket Service Class**
   ```typescript
   interface WSConnectionConfig {
     accessToken: string;
     userId?: string;
     orgId?: string;
     hubId?: string;
   }
   ```
   - [x] Implement connection with query parameters
   - [ ] Add reconnection logic with exponential backoff
   - [x] Add event handlers (open, close, message, error)
   - [ ] Implement message queue for offline/reconnecting states

2. **Connection State Management**
   - [x] Create WebSocket context provider (integrated in WebSocketTester component)
   - [x] Implement connection state tracking
   - [x] Add connection status indicators
   - [x] Create hooks for WebSocket operations (useAuth hook implemented)

## Phase 3: Multi-Client UI Implementation

1. **Client Manager Interface**
   - [x] Create client connection form
     - Fields: userId, orgId, hubId, projectId
     - Connect/Disconnect buttons
   - [x] Implement client list/grid view
   - [x] Add client status indicators
   - [x] Create client removal functionality

2. **Chat Interface per Client**
   - [x] Design chat box component (ClientCard component)
     - Message history view
     - Message input form
     - Connection status indicator
   - [x] Implement message formatting
   - [x] Add timestamp display
   - [x] Create message type indicators (P2P/A2P badges)

## Phase 4: HTTP Publishing Interface

1. **HTTP Client Implementation**
   - [x] Create HTTP publishing service (implemented in WebSocketTester component)
   - [x] Implement authentication header injection
   - [x] Add error handling and retries
   - [x] Create response handling

2. **Publishing UI**
   - [x] Create message composer form
     - Target selection (user/org/hub/project)
     - Target ID input
     - Message content editor
     - Priority selection
   - [x] Add message preview (via payload details dropdown)
   - [x] Implement success/error feedback (via connection log)

## Phase 5: Message Handling and Display

1. **Message Processing**
   - [x] Implement message validation
   - [x] Create message formatters
   - [x] Add message type handlers (P2P and A2P)
   - [x] Implement message storage/history (in-memory state)

2. **Message Display Components**
   - [x] Create message list component
   - [x] Implement message type styling (color-coded P2P/A2P badges)
   - [x] Add timestamp formatting
   - [x] Create message status indicators (direction: sent/received)

## Phase 6: Testing and Polish

1. **Testing Setup**
   - [ ] Add unit tests for services
   - [ ] Create integration tests
   - [ ] Implement E2E test scenarios
   - [ ] Add connection stress tests

2. **UI Polish**
   - [x] Implement loading states (connection/disconnection states)
   - [ ] Add error boundaries
   - [ ] Create toast notifications
   - [x] Improve responsive design (basic responsive layout implemented)

## Component Structure

```
src/
  ├── components/
  │   ├── auth/
  │   │   ├── SignIn.tsx ✅
  │   │   └── SignUp.tsx ✅
  │   ├── websocket/
  │   │   ├── ClientCard.tsx ✅ (individual client chat interface)
  │   │   └── ConnectionLog.tsx ✅ (shared connection log)
  │   ├── WebSocketTester.tsx ✅ (single client tester)
  │   ├── MultiClientTester.tsx ✅ (multi-client manager)
  │   └── ui/
  │       ├── button.tsx ✅
  │       ├── card.tsx ✅
  │       └── input.tsx ✅
  ├── services/
  │   ├── websocket.ts ❌ (logic in components)
  │   ├── auth.ts ✅
  │   └── http.ts ❌ (logic in components)
  ├── contexts/
  │   ├── AuthContext.tsx ✅
  │   └── WebSocketContext.tsx ❌ (not needed, state managed per client)
  ├── hooks/
  │   └── useAuth.ts ✅ (exported from AuthContext)
  └── app/
      ├── page.tsx ✅ (mode selection landing page)
      ├── single-client/
      │   └── page.tsx ✅
      └── multi-client/
          └── page.tsx ✅
```

## Implementation Order

1. ✅ Basic project structure and authentication
2. ✅ WebSocket connection manager service (basic implementation)
3. ✅ Multi-client UI framework (fully implemented)
4. ✅ Basic message sending/receiving
5. ✅ HTTP publishing interface
6. ✅ Enhanced message display and history
7. ⚠️ Polish and testing (partially done, tests missing)

## Implementation Status Summary

### ✅ Completed Features
- Next.js + TypeScript + Tailwind CSS setup
- Cognito authentication (sign in, sign up, sign out)
- Protected routes with middleware
- **NEW: Mode selection landing page**
- **Single Client Tester:**
  - Single WebSocket client connection
  - P2P messaging via WebSocket
  - A2P messaging via HTTP REST API
  - Real-time message display with type indicators
  - Connection log panel
  - Message payload inspection
  - Configurable message settings (target class, type, priority)
- **NEW: Multi-Client Tester:**
  - Create unlimited client instances
  - Independent WebSocket connections per client
  - Grid layout with individual client cards
  - Per-client message history and chat interface
  - Per-client configuration (target, event type, message type)
  - Connection state indicators (connected/connecting/disconnected)
  - Centralized connection log for all clients
  - Add/remove clients dynamically
  - P2P and A2P messaging from any client
- Navigation between single and multi-client modes
- Basic responsive layout

### ⚠️ Partially Implemented
- WebSocket service (integrated in components, not separate service)
- Error handling (basic implementation, no error boundaries)
- Reconnection logic (manual reconnect only)

### ❌ Not Implemented
- WebSocket reconnection with exponential backoff
- Message queue for offline states
- Separate service files (websocket.ts, http.ts)
- Unit/integration/E2E tests
- Error boundaries
- Toast notifications
- Connection stress tests
- Message history virtualization (for very long lists)

## New Features Added

### Multi-Client Testing Interface
The multi-client tester provides a comprehensive environment for testing complex scenarios:

1. **Client Management**
   - Add clients with custom User ID, Hub ID, Org ID, Project ID
   - Visual status indicators for connection state
   - Remove clients with automatic cleanup

2. **Independent Client Cards**
   - Compact chat interface per client
   - Collapsible settings panel
   - Per-client message configuration
   - Individual message history

3. **Centralized Monitoring**
   - Unified connection log across all clients
   - Client ID prefixes for easy tracking
   - System-level event logging

4. **Flexible Messaging**
   - Send P2P messages (requires connection)
   - Send A2P messages (works without connection)
   - Configure targeting per client
   - FIFO message grouping support

### Navigation Improvements
- Landing page with mode selection
- Easy switching between single and multi-client modes
- Consistent navigation across all pages
- Visual comparison of features

## Development Guidelines

1. **State Management**
   - Use React Context for global states
   - Implement custom hooks for reusable logic
   - Keep connection state centralized

2. **Error Handling**
   - Implement consistent error boundaries
   - Add retry mechanisms for connections
   - Provide clear user feedback

3. **Performance**
   - Implement message batching
   - Use virtualization for long message lists
   - Optimize reconnection strategies

4. **Security**
   - Secure token handling
   - Implement proper logout cleanup
   - Validate message formats