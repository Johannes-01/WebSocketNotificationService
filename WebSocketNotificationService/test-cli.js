#!/usr/bin/env node

/**
 * WebSocket Notification Service - CLI Tester
 * 
 * Usage:
 *   node test-cli.js --email test@example.com --password TestPassword123!
 */

const WebSocket = require('ws');
const https = require('https');
const readline = require('readline');

// Configuration
const CONFIG = {
  REGION: 'eu-central-1',
  USER_POOL_ID: 'eu-central-1_Fv5fjvyjH',
  CLIENT_ID: '1lf9sv60pmbvfbasjmu5ab7dcv',
  WS_URL: 'wss://1gsi4bgu1k.execute-api.eu-central-1.amazonaws.com/dvl',
  HTTP_URL: 'https://6dvx3pj0w3.execute-api.eu-central-1.amazonaws.com/prod/publish',
};

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : null;
};

const email = getArg('email');
const password = getArg('password');
const userId = getArg('userId') || 'test-user-123';
const hubId = getArg('hubId') || 'hub1';
const orgId = getArg('orgId') || 'org1';
const projectId = getArg('projectId') || 'project1';

if (!email || !password) {
  console.error('❌ Missing required arguments');
  console.log('\nUsage:');
  console.log('  node test-cli.js --email <email> --password <password> [options]');
  console.log('\nOptions:');
  console.log('  --userId <id>      User ID for connection (default: test-user-123)');
  console.log('  --hubId <id>       Hub ID for connection (default: hub1)');
  console.log('  --orgId <id>       Org ID for connection (default: org1)');
  console.log('  --projectId <id>   Project ID for connection (default: project1)');
  process.exit(1);
}

// Helper function to make AWS Cognito API calls
function cognitoRequest(action, params) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(params);
    
    const options = {
      hostname: `cognito-idp.${CONFIG.REGION}.amazonaws.com`,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Cognito error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function authenticate() {
  console.log('🔐 Authenticating...');
  
  try {
    const response = await cognitoRequest('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CONFIG.CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    if (response.AuthenticationResult && response.AuthenticationResult.IdToken) {
      console.log('✅ Authentication successful');
      return response.AuthenticationResult.IdToken;
    } else {
      throw new Error('No token in response');
    }
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    throw error;
  }
}

async function connectWebSocket(token) {
  console.log('🔌 Connecting to WebSocket...');
  
  const wsUrl = `${CONFIG.WS_URL}?token=${token}&userId=${userId}&hubId=${hubId}&orgId=${orgId}&projectId=${projectId}`;
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('✅ WebSocket connected');
      console.log(`   User ID: ${userId}`);
      console.log(`   Hub ID: ${hubId}`);
      console.log(`   Org ID: ${orgId}`);
      console.log(`   Project ID: ${projectId}\n`);
      resolve(ws);
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      reject(error);
    });

    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket closed: ${code} - ${reason || 'No reason'}`);
    });

    ws.on('message', (data) => {
      console.log('\n📨 Received message:');
      try {
        const parsed = JSON.parse(data.toString());
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(data.toString());
      }
      console.log('');
    });
  });
}

async function sendP2PMessage(ws, targetClass, targetId, content) {
  const message = {
    action: 'sendMessage',
    targetChannel: 'WebSocket',
    messageType: 'standard',
    payload: {
      targetId,
      targetClass,
      eventType: 'cli_test',
      content,
      priority: 'normal',
      timestamp: new Date().toISOString(),
    },
  };

  ws.send(JSON.stringify(message));
  console.log(`📤 Sent P2P message to ${targetClass}:${targetId}`);
}

async function sendA2PMessage(token, targetClass, targetId, content) {
  const message = {
    targetChannel: 'WebSocket',
    messageType: 'standard',
    payload: {
      targetId,
      targetClass,
      eventType: 'cli_test',
      content,
      priority: 'normal',
      timestamp: new Date().toISOString(),
    },
  };

  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.HTTP_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`✅ Sent A2P message to ${targetClass}:${targetId}`);
          resolve(data);
        } else {
          console.error(`❌ A2P failed: ${res.statusCode} - ${data}`);
          reject(new Error(data));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(message));
    req.end();
  });
}

async function interactiveMode(ws, token) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n📝 Interactive mode. Commands:');
  console.log('  p2p <targetClass> <targetId> <message>  - Send P2P message via WebSocket');
  console.log('  a2p <targetClass> <targetId> <message>  - Send A2P message via HTTP');
  console.log('  quit                                     - Exit\n');

  const prompt = () => {
    rl.question('> ', async (line) => {
      const parts = line.trim().split(' ');
      const command = parts[0];

      try {
        if (command === 'quit') {
          ws.close();
          rl.close();
          process.exit(0);
        } else if (command === 'p2p' && parts.length >= 4) {
          const targetClass = parts[1];
          const targetId = parts[2];
          const message = parts.slice(3).join(' ');
          await sendP2PMessage(ws, targetClass, targetId, message);
        } else if (command === 'a2p' && parts.length >= 4) {
          const targetClass = parts[1];
          const targetId = parts[2];
          const message = parts.slice(3).join(' ');
          await sendA2PMessage(token, targetClass, targetId, message);
        } else {
          console.log('❌ Invalid command');
        }
      } catch (error) {
        console.error('❌ Error:', error.message);
      }

      prompt();
    });
  };

  prompt();
}

async function main() {
  try {
    const token = await authenticate();
    const ws = await connectWebSocket(token);
    await interactiveMode(ws, token);
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
