The NotificationService is a basic example of how to create a WebSocket API + AWS SNS integration for broadcasting to all WebSocket clients.

Components:

1. cdk: The CDK as Infrastructure as a Service (IaaS) that defines every AWS structure needed for deployment
2. connection-handler: The connection handler is part of the WebSocketAPI and is triggered when server and client connects/disconnects.
3. Publisher: The Publisher is a REST Api that publishes to sns (for outside the websocket communication to the clients).
4. Processor: The Processor is a lambda subscribed to SNS, that forwards messages to the WebSocket clients.
5. Client: The client is for testing.