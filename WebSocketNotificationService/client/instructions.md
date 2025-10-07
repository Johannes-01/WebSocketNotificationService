Create a web typescript, next.js, react web application that uses tailwind with shad.cn for styling to integrate a WebSocket-based notification service built on AWS, designed for real-time message broadcasting. The web application is for testing the service.

# Features
- [ ] login and signup for cognito client
- [ ] a WebSocket connection manager
  - [ ] connecting
    - [ ] When connecting set the accessToken as 'token' query parameter
    - [ ] also set query parameters for userId, orgId, hubId, and optionally projectId
  - [ ] disconnecting with retrying to connect
  - [ ] error handling
  - [ ] publishing service messages via sending json data over WebSocket to the server
- [ ] a UI to simulate multiple webSocket client, so data can be send from one client to another client
- [ ] Once a websocket connection is established via the ui a chat box is to be created when received messages are displayed and messages can be send. Make default messages that look like the message structure, make userId, hubId and orgId settable in with a user input for every websocket connection
- [ ] Another UI to Publish Data is with HTTP Application to Client (A2C), POST endpoint with json message in body
- [ ] The message json structure is as follows
```javascript
   {
     "messageId": "123456",
     "timestamp": "2025-10-03T14:00:00Z",
     "targetChannel": "WebSocket",
     "payload": {
       "targetId": "abc123xyz",
       "targetClass": "user", // user, org, hub, project
       "eventType": "notification",
       "content": "Message content"
     }
   }
```
- [ ] all credentials like congito credentials, http publishing endpoint, websocket endpoint are dynamically configurable via a .env file