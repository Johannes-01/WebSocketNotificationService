The NotificationService is a basic example of how to create a WebSocket API + AWS SNS integration for broadcasting to all WebSocket clients.

Components:

1. cdk: The CDK as Infrastructure as a Service (IaaS) that defines every AWS structure needed for deployment
2. connection-handler: The connection handler is part of the WebSocketAPI and is triggered when server and client connects/disconnects.
3. Publisher: The Publisher is a REST Api that publishes to sns.
4. Processor: The Processor is a lambda subscribed to SNS, that forwards messages to the WebSocket clients.
5. Client: The client is for testing.

## ⚠️ Use This Code At Your Own Risk ⚠️

This code was cobbled together with caffeine, Stack Overflow answers, and the desperate hope that it actually works. Side effects may include: spontaneous AWS bill increases, mysterious 502 errors that vanish when you're not looking, and an inexplicable urge to rewrite everything in Rust.

The author accepts no responsibility for any production outages, angry DevOps teams, or existential crises caused by attempting to understand WebSocket connection management at 3 AM.

Proceed with caution!