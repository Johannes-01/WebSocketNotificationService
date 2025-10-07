# WebSocket Notification Service Tester

A comprehensive testing interface for the WebSocket Notification Service, built with Next.js, TypeScript, and AWS Cognito authentication.

## 🚀 Features

### Two Testing Modes

#### 🔌 Single Client Tester
Perfect for basic testing and debugging:
- Single WebSocket connection with full control
- P2P (Person-to-Person) messaging via WebSocket
- A2P (Application-to-Person) messaging via HTTP API
- Detailed connection logs
- Message payload inspection
- Configurable message settings

#### 🔌🔌🔌 Multi-Client Tester
Ideal for complex scenarios and load testing:
- **Multiple simultaneous WebSocket connections**
- **Independent client management** - each with unique configuration
- **Client-to-client messaging** - test real-world P2P scenarios
- **Grid layout** - manage up to 15+ clients at once
- **Centralized logging** - monitor all client activities
- **Per-client settings** - configure target, type, and grouping individually

### Core Capabilities
- ✅ AWS Cognito authentication (sign up, sign in, sign out)
- ✅ Protected routes with authentication middleware
- ✅ Real-time WebSocket connections
- ✅ P2P messaging (low latency via WebSocket)
- ✅ A2P messaging (reliable delivery via HTTP API)
- ✅ FIFO message support with message grouping
- ✅ Flexible targeting (user/org/hub/project)
- ✅ Responsive design
- ✅ TypeScript for type safety

## 📋 Prerequisites

- Node.js 18+ and npm
- AWS Cognito User Pool configured
- WebSocket API endpoint deployed
- HTTP publish endpoint available

## 🛠️ Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the root directory:

```env
NEXT_PUBLIC_COGNITO_USER_POOL_ID=your-user-pool-id
NEXT_PUBLIC_COGNITO_CLIENT_ID=your-client-id
NEXT_PUBLIC_WEBSOCKET_ENDPOINT=wss://your-api-gateway-url/stage
NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT=https://your-api-gateway-url/stage/publish
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for Production

```bash
npm run build
npm start
```

## 📖 Usage Guide

### Getting Started

1. **Sign Up / Sign In**
   - Create an account or sign in with existing credentials
   - Email verification may be required (check email)

2. **Choose Testing Mode**
   - **Single Client**: For basic testing and learning
   - **Multi-Client**: For advanced scenarios and load testing

### Single Client Mode

1. Configure connection parameters (User ID, Hub ID, Org ID, Project ID)
2. Click "Connect" to establish WebSocket connection
3. Configure message settings (target class, target ID, event type)
4. Type message and click:
   - **P2P**: Send via WebSocket (requires connection)
   - **A2P**: Send via HTTP API (works without connection)
5. Watch messages appear in the chat area
6. Monitor connection events in the log panel

### Multi-Client Mode

1. **Add Clients**:
   - Fill in User ID (required)
   - Optionally add Hub ID, Org ID, Project ID
   - Click "Add Client"
   - Repeat to create multiple clients

2. **Connect Clients**:
   - Click "Connect" on each client card
   - Watch status indicators (gray → yellow → green)

3. **Configure & Send**:
   - Click ⚙️ to open settings panel
   - Set target class and target ID
   - Type message and send via P2P or A2P

4. **Monitor**:
   - Each client shows its own message history
   - Centralized log shows all activities
   - Color-coded status indicators

### Testing Scenarios

#### User-to-User Messaging
```
1. Create client "alice" and client "bob"
2. Connect both
3. In alice's settings: target "user" → "bob"
4. Send message from alice
5. Message appears in bob's chat
```

#### Organization Broadcast
```
1. Create 3 clients with same Org ID
2. Connect all clients
3. Send A2P targeting the organization
4. All clients receive the message
```

#### FIFO Message Ordering
```
1. Create 2 clients and connect
2. Set message type to "FIFO"
3. Set message group ID (e.g., "chat-123")
4. Send multiple rapid messages
5. Messages arrive in order
```

## 📚 Documentation

- **[MULTI_CLIENT_GUIDE.md](MULTI_CLIENT_GUIDE.md)** - Comprehensive multi-client documentation
- **[MULTI_CLIENT_QUICK_START.md](MULTI_CLIENT_QUICK_START.md)** - Quick start and common scenarios
- **[MULTI_CLIENT_UI_GUIDE.md](MULTI_CLIENT_UI_GUIDE.md)** - Visual interface guide
- **[MULTI_CLIENT_IMPLEMENTATION_SUMMARY.md](MULTI_CLIENT_IMPLEMENTATION_SUMMARY.md)** - Technical implementation details
- **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)** - Full implementation status
- **[AUTH_FLOW.md](AUTH_FLOW.md)** - Authentication flow documentation
- **[EMAIL_VERIFICATION_GUIDE.md](EMAIL_VERIFICATION_GUIDE.md)** - Email verification guide

## 🏗️ Architecture

### Tech Stack
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Authentication**: AWS Cognito
- **Real-time**: WebSocket API (AWS API Gateway)
- **HTTP API**: REST API with Cognito authorization

### Project Structure
```
src/
├── app/
│   ├── page.tsx                    # Landing page with mode selection
│   ├── signin/page.tsx             # Sign in page
│   ├── signup/page.tsx             # Sign up page
│   ├── single-client/page.tsx      # Single client tester
│   └── multi-client/page.tsx       # Multi-client tester
├── components/
│   ├── auth/
│   │   ├── SignIn.tsx              # Sign in component
│   │   └── SignUp.tsx              # Sign up component
│   ├── websocket/
│   │   ├── ClientCard.tsx          # Individual client UI
│   │   └── ConnectionLog.tsx       # Shared connection log
│   ├── WebSocketTester.tsx         # Single client interface
│   ├── MultiClientTester.tsx       # Multi-client manager
│   └── ui/                         # shadcn/ui components
├── contexts/
│   └── AuthContext.tsx             # Authentication context
└── middleware.ts                   # Route protection
```

## 🔧 Configuration

### Message Types
- **Standard**: High throughput, best-effort delivery
- **FIFO**: Ordered delivery, sequential processing

### Target Classes
- **user**: Individual user targeting
- **org**: Organization-level broadcast
- **hub**: Hub-level broadcast
- **project**: Project-level broadcast

### Connection Parameters
- **User ID**: Unique identifier (required)
- **Hub ID**: Hub association (optional)
- **Org ID**: Organization association (optional)
- **Project ID**: Project association (optional)

## 🎯 Key Features Explained

### P2P vs A2P Messaging

**P2P (Person-to-Person)**:
- Sent via WebSocket connection
- Lower latency (~50-100ms)
- Requires active connection
- Best for: Real-time chat, live notifications

**A2P (Application-to-Person)**:
- Sent via HTTP REST API
- Higher reliability
- Works without active connection
- Best for: System notifications, scheduled messages

### FIFO Message Ordering

When FIFO is enabled:
- Messages are processed in the exact order they were sent
- Use Message Group ID to group related messages
- Messages within same group are strictly ordered
- Different groups can process in parallel

Example:
```json
{
  "messageType": "fifo",
  "messageGroupId": "chat-room-123",
  "payload": {
    "targetId": "user456",
    "targetClass": "user",
    "content": "Hello!"
  }
}
```

## 🚨 Troubleshooting

### Connection Issues
- **Problem**: Cannot connect to WebSocket
- **Solution**: Check `.env.local` configuration, verify endpoint URL, ensure valid auth token

### Messages Not Received
- **Problem**: Sent message doesn't appear in recipient
- **Solution**: Verify target ID matches recipient's User/Org/Hub ID, check connection status

### Authentication Errors
- **Problem**: Sign in fails or redirects immediately
- **Solution**: Verify Cognito configuration, check User Pool ID and Client ID

### Performance Issues
- **Problem**: UI becomes slow with many clients
- **Solution**: Limit active connections to 10-15, clear old messages regularly

## 📈 Performance Tips

1. **Limit Active Connections**: Keep to 10-15 simultaneous connections
2. **Clear Messages**: Use 🧹 button to clear message history regularly
3. **Clear Logs**: Periodically clear the connection log
4. **Use Standard Type**: Use "standard" message type for better throughput
5. **Batch Testing**: Test in small batches rather than all at once

## 🔐 Security

- All routes protected with authentication middleware
- JWT tokens validated on every request
- WebSocket connections authenticated via query parameter
- HTTP API secured with bearer token
- Automatic token refresh handled by Cognito

## 🧪 Testing

### Manual Testing Checklist
- [ ] Sign up new user
- [ ] Sign in with credentials
- [ ] Single client: Connect and send P2P
- [ ] Single client: Send A2P without connection
- [ ] Multi-client: Create 3+ clients
- [ ] Multi-client: Connect all clients
- [ ] Multi-client: Send messages between clients
- [ ] Multi-client: Test organization broadcast
- [ ] Multi-client: Test FIFO ordering
- [ ] Sign out and verify redirect

## 🚀 Deployment

### Vercel (Recommended)
```bash
vercel --prod
```

### Docker
```bash
docker build -t websocket-tester .
docker run -p 3000:3000 websocket-tester
```

### Environment Variables for Production
Ensure all environment variables are configured in your deployment platform.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

See LICENSE file for details.

## 🆘 Support

For issues or questions:
1. Check the documentation files
2. Review troubleshooting section
3. Check AWS Cognito configuration
4. Verify WebSocket endpoint connectivity

## 🎓 Learn More

### Next.js Resources
- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)

### AWS Resources
- [AWS Cognito Documentation](https://docs.aws.amazon.com/cognito/)
- [AWS API Gateway WebSocket APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html)

### Project Resources
- [WebSocket Notification Service Architecture](../../ARCHITECTURE_OVERVIEW.md)
- [Deployment Guide](../../DEPLOYMENT_CHECKLIST.md)
- [Testing Guide](../../TESTING_GUIDE.md)

---

**Built with ❤️ using Next.js, TypeScript, and AWS**
