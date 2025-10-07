# A2P HTTP Publishing Troubleshooting Guide

## Issues Found

### 1. CORS Configuration Problem
**Issue:** The REST API Gateway was configured with restrictive CORS settings that only allowed `localhost:3000` as origin with `allowCredentials: true`.

**Problem:**
- The CORS origin needed to match the exact protocol and port (e.g., `http://localhost:3000`)
- Using `allowCredentials: true` with wildcard origins is not allowed
- Browser requests from Next.js development server were being blocked

**Fix Applied:**
```typescript
// BEFORE (Restrictive)
defaultCorsPreflightOptions: {
  allowOrigins: ['localhost:3000'],  // ❌ Missing protocol
  allowMethods: ['POST', 'OPTIONS'],
  allowHeaders: [...apigateway.Cors.DEFAULT_HEADERS, 'Authorization'],
  allowCredentials: true,  // ❌ Incompatible with wildcard
}

// AFTER (Fixed)
defaultCorsPreflightOptions: {
  allowOrigins: apigateway.Cors.ALL_ORIGINS,  // ✅ Allows all origins
  allowMethods: ['POST', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-Amz-Date',
    'X-Api-Key',
    'X-Amz-Security-Token',
  ],
  allowCredentials: false,  // ✅ Required for wildcard origins
}
```

### 2. Missing Stage Name Configuration
**Issue:** The RestApi didn't have an explicit stage name configured, defaulting to `prod` instead of matching the WebSocket API stage `dvl`.

**Fix Applied:**
```typescript
const notificationApi = new apigateway.RestApi(this, 'NotificationApi', {
  restApiName: `${stackName}-NotificationApi`,
  description: 'HTTP API for publishing notifications (A2P)',
  deployOptions: {
    stageName: 'dvl',  // ✅ Now matches WebSocket API stage
  },
  // ... CORS config
});
```

### 3. Missing CloudFormation Output
**Issue:** The REST API endpoint URL was not exported as a CloudFormation output, making it difficult to find the correct endpoint.

**Fix Applied:**
```typescript
new cdk.CfnOutput(this, 'NotificationApiUrl', {
  value: notificationApi.url + 'publish',
  description: 'HTTP REST API endpoint for A2P message publishing',
});
```

### 4. Poor Error Handling in Client
**Issue:** The client component didn't provide detailed error messages when A2P requests failed.

**Fix Applied in `WebSocketTester.tsx`:**
```typescript
// Added comprehensive error logging
- Check if endpoint is configured
- Log the full request details (endpoint, message, token preview)
- Log response status and body
- Display detailed error messages in the connection log
- Console log for debugging
```

## Updated Environment Variable

After deployment, update `.env.local`:
```env
# The endpoint should now be at the 'dvl' stage
NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT=https://<api-id>.execute-api.eu-central-1.amazonaws.com/dvl/publish
```

You can get the correct URL from CloudFormation outputs:
```bash
aws cloudformation describe-stacks \
  --stack-name NotificationServiceStack \
  --query 'Stacks[0].Outputs[?OutputKey==`NotificationApiUrl`].OutputValue' \
  --output text
```

## Testing A2P After Fix

1. **Deploy the updated stack:**
   ```bash
   cd WebSocketNotificationService/cdk
   npm run build
   cdk deploy
   ```

2. **Update the environment variable:**
   - Get the new API URL from CloudFormation outputs
   - Update `NEXT_PUBLIC_HTTP_PUBLISH_ENDPOINT` in `.env.local`
   - Restart the Next.js development server

3. **Test the A2P endpoint:**
   - Open the WebSocket tester UI
   - Fill in the message form
   - Click the "📡 A2P" button
   - Check the connection log for detailed status

4. **Expected successful response:**
   ```
   [HH:MM:SS] 📤 Sending A2P message via HTTP to https://...
   [HH:MM:SS] ✅ A2P message sent successfully - MessageId: abc123...
   ```

## Common Errors and Solutions

### CORS Error in Browser Console
```
Access to fetch at '...' from origin 'http://localhost:3000' has been blocked by CORS policy
```
**Solution:** Ensure CORS is configured with `ALL_ORIGINS` and `allowCredentials: false`

### 401 Unauthorized
```
❌ A2P message failed: 401 Unauthorized
```
**Solution:** Check that the Cognito ID token is valid and not expired. Try signing out and back in.

### 403 Forbidden
```
❌ A2P message failed: 403 Forbidden
```
**Solution:** Verify the Cognito authorizer is correctly configured and the user pool matches.

### 404 Not Found
```
❌ A2P message failed: 404 Not Found
```
**Solution:** Check that the endpoint URL includes the correct stage name (`/dvl/publish`) and resource path.

## Architecture Flow (A2P)

```
Client (Next.js)
    │
    │ POST /dvl/publish
    │ Authorization: Bearer <token>
    │
    ▼
API Gateway (REST API)
    │
    │ Cognito Authorizer validates token
    │
    ▼
Lambda: A2PHttpPublisher
    │
    │ Publishes to SNS Topic
    │ (FIFO or Standard based on messageType)
    │
    ▼
SNS Topic (with targetChannel filter)
    │
    ▼
SQS Queue (WebSocket queue)
    │
    ▼
Lambda: Processor
    │
    ▼
WebSocket API (broadcasts to connected clients)
```

## Additional Outputs Added

The following CloudFormation outputs are now available:

- `WebSocketApiUrl` - WebSocket API endpoint URL
- `NotificationApiUrl` - HTTP REST API endpoint for A2P publishing
- `UserPoolId` - Cognito User Pool ID
- `UserPoolClientId` - Cognito User Pool Client ID
