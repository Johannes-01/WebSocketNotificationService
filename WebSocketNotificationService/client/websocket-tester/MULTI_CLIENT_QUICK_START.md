# Multi-Client Tester - Quick Start Guide

## 🚀 Getting Started

### 1. Access the Multi-Client Tester
- Navigate to the home page after signing in
- Click on **"Launch Multi-Client →"** button
- Or go directly to `/multi-client`

### 2. Create Your First Clients

**Example Setup: Testing User-to-User Messaging**

**Client A:**
```
User ID: alice
Hub ID: hub1
Org ID: org1
Project ID: (leave empty)
```

**Client B:**
```
User ID: bob
Hub ID: hub1
Org ID: org1
Project ID: (leave empty)
```

Click **"Add Client"** for each.

### 3. Connect the Clients
- Click the **"🔌 Connect"** button on both client cards
- Watch the status indicator turn yellow (connecting) then green (connected)
- Check the connection log on the right for confirmation

### 4. Configure Message Settings
On Client A's card:
- Click the **⚙️** settings button
- Set **Target Class**: `user`
- Set **Target ID**: `bob`
- Leave other settings as default

### 5. Send a Message
- Type "Hello Bob!" in Client A's message input
- Click **"P2P"** button
- Message appears in Client A as "sent" (blue background)
- If Bob's client is listening to messages for user "bob", it receives the message

## 📋 Common Testing Scenarios

### Scenario 1: Direct User Messages
```
Setup:
- Client 1: userId="user1"
- Client 2: userId="user2"

Action:
- From Client 1, target "user2"
- Send P2P message
- Watch Client 2 receive it
```

### Scenario 2: Organization Broadcast
```
Setup:
- Client 1: userId="admin", orgId="acme"
- Client 2: userId="employee1", orgId="acme"
- Client 3: userId="employee2", orgId="acme"

Action:
- Use A2P from any client
- Target Class: "org"
- Target ID: "acme"
- All three clients receive the message
```

### Scenario 3: Hub Communication
```
Setup:
- Client 1: userId="user1", hubId="sales"
- Client 2: userId="user2", hubId="sales"
- Client 3: userId="user3", hubId="engineering"

Action:
- Target Class: "hub"
- Target ID: "sales"
- Only Client 1 and 2 receive
```

### Scenario 4: FIFO Message Ordering
```
Setup:
- Client 1: userId="sender"
- Client 2: userId="receiver"

Action:
- On Client 1, open settings
- Set Message Type: "FIFO"
- Set Message Group ID: "chat-123"
- Send multiple messages rapidly
- Messages arrive in order at Client 2
```

## 💡 Pro Tips

### Performance Optimization
- **Limit Active Connections**: Keep 10-15 connections max for best performance
- **Clear Old Messages**: Use 🧹 button regularly to clear message history
- **Clear Logs**: Click "Clear" in the log panel when it gets long

### Effective Testing
1. **Start with 2 clients** - Understand the basics first
2. **Use descriptive User IDs** - Makes tracking easier (e.g., "alice", "bob", not "user1", "user2")
3. **Check the logs** - Monitor the connection log for errors or issues
4. **Test one feature at a time** - Don't try to test everything at once

### Troubleshooting
| Problem | Solution |
|---------|----------|
| Connection fails | Check token is valid, verify endpoint in .env.local |
| Messages not received | Verify target ID matches recipient's User/Org/Hub ID |
| Slow performance | Reduce active connections, clear messages |
| Can't connect multiple clients | Ensure each has unique User ID |

## 🎯 Testing Checklist

### Basic Functionality
- [ ] Create multiple clients with different User IDs
- [ ] Connect all clients successfully
- [ ] Send P2P message between two clients
- [ ] Send A2P message to a target
- [ ] Verify messages appear in correct client
- [ ] Disconnect a client
- [ ] Remove a client

### Advanced Features
- [ ] Test organization-level targeting
- [ ] Test hub-level targeting
- [ ] Test FIFO message ordering
- [ ] Test message grouping
- [ ] Test rapid message sending
- [ ] Test reconnection after disconnect

### Edge Cases
- [ ] Send message to non-existent target
- [ ] Send P2P without connection (should fail)
- [ ] Send A2P without connection (should work)
- [ ] Create 10+ clients simultaneously
- [ ] Send 50+ messages to one client

## 🔑 Keyboard Shortcuts
- **Enter** in message input: Send P2P message (if connected)

## 📊 Understanding the Interface

### Status Indicators
- 🟢 **Pulsing Green**: Connected and active
- 🟡 **Pulsing Yellow**: Connection in progress
- ⚪ **Gray**: Disconnected

### Message Badges
- **Purple P2P**: Sent via WebSocket (lower latency)
- **Green A2P**: Sent via HTTP API (higher reliability)

### Log Entry Icons
- ✅ Success operation
- ❌ Error or failure
- 🔌 Connection event
- 📨 Message received
- 📤 Message sent
- 🧹 Messages cleared
- 🗑️ Client removed

## 📖 Message Format Reference

### P2P Message (via WebSocket)
```json
{
  "action": "sendMessage",
  "targetChannel": "WebSocket",
  "messageType": "standard",
  "payload": {
    "targetId": "recipient-user-id",
    "targetClass": "user",
    "eventType": "notification",
    "content": "Your message here"
  }
}
```

### A2P Message (via HTTP)
```bash
POST https://{api-endpoint}/publish
Authorization: Bearer {token}

{
  "targetChannel": "WebSocket",
  "messageType": "standard",
  "payload": {
    "targetId": "recipient-user-id",
    "targetClass": "user",
    "eventType": "notification",
    "content": "Your message here"
  }
}
```

## 🔄 Switching Between Modes

### From Multi-Client to Single-Client
1. Click **"🔌 Single Client Mode"** button in header
2. All multi-client connections will be closed
3. You'll be redirected to single-client interface

### From Single-Client to Multi-Client
1. Click **"🔌 Multi-Client Mode"** button in header
2. Single-client connection will be closed
3. You'll be redirected to multi-client interface

### Return to Home
1. Click **"← Home"** link in header
2. All active connections will be closed
3. Choose your preferred testing mode again

## 🎓 Learning Path

### Beginner (First 15 minutes)
1. Create 2 clients with different User IDs
2. Connect both clients
3. Send a P2P message from one to the other
4. Observe the message in the recipient's chat

### Intermediate (Next 30 minutes)
5. Create clients with same Org ID
6. Send an A2P message targeting the organization
7. Test FIFO message ordering
8. Experiment with different event types

### Advanced (Next 1 hour)
9. Create 5+ clients with mixed configurations
10. Test complex targeting scenarios
11. Simulate a multi-user chat room
12. Test message delivery under load
13. Explore error conditions and recovery

## 🛠 Configuration Reference

### Required Fields
- **User ID**: Must be unique per client

### Optional Fields
- **Hub ID**: For hub-level message targeting
- **Org ID**: For organization-level message targeting
- **Project ID**: For project-level message targeting (if supported)

### Message Settings
- **Target Class**: Who receives the message (user/org/hub/project)
- **Target ID**: Specific identifier for the recipient
- **Event Type**: Category of message (notification/chat/alert/etc.)
- **Message Type**: Delivery mechanism (standard/FIFO)
- **Message Group ID**: Grouping for FIFO messages (optional)

## 📞 Need Help?

### Documentation
- See `MULTI_CLIENT_GUIDE.md` for comprehensive documentation
- Check `IMPLEMENTATION_PLAN.md` for technical details
- Review `ARCHITECTURE_OVERVIEW.md` for system design

### Common Questions

**Q: How many clients can I create?**  
A: Unlimited, but keep active connections to 10-15 for best performance.

**Q: Do all clients need to be connected?**  
A: No, you can have any mix of connected/disconnected clients.

**Q: Can I send messages to myself?**  
A: Yes, set the target ID to your own user ID.

**Q: What's the difference between P2P and A2P?**  
A: P2P requires WebSocket connection (lower latency). A2P uses HTTP API (works without connection).

**Q: How do I test message ordering?**  
A: Use FIFO message type with a Message Group ID.

**Q: Can I save my client configurations?**  
A: Not yet - this is a planned feature for future releases.

---

**Happy Testing! 🎉**
