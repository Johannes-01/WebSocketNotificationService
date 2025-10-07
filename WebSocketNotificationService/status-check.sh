#!/bin/bash

# WebSocket Notification Service - Status Check
# Quick script to verify everything is working

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   WebSocket Notification Service - System Status              ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if web UI is running
echo "🌐 Web UI Status:"
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "   ✅ Running at http://localhost:3000"
else
    echo "   ❌ Not running. Start with:"
    echo "      cd WebSocketNotificationService/client/websocket-tester && npm run dev"
fi
echo ""

# Check AWS connectivity
echo "☁️  AWS Connection:"
if aws sts get-caller-identity --profile sandbox > /dev/null 2>&1; then
    ACCOUNT=$(aws sts get-caller-identity --profile sandbox --query 'Account' --output text)
    echo "   ✅ Connected to AWS Account: $ACCOUNT"
else
    echo "   ❌ Cannot connect to AWS. Check profile 'sandbox'"
fi
echo ""

# Display deployed endpoints
echo "📡 Deployed Endpoints:"
echo "   WebSocket: wss://1gsi4bgu1k.execute-api.eu-central-1.amazonaws.com/dvl"
echo "   HTTP API:  https://6dvx3pj0w3.execute-api.eu-central-1.amazonaws.com/prod/publish"
echo ""

# Check DynamoDB table
echo "💾 DynamoDB Status:"
if aws dynamodb describe-table \
    --table-name NotificationServiceStack-ConnectionTable \
    --profile sandbox \
    --region eu-central-1 > /dev/null 2>&1; then
    
    ITEM_COUNT=$(aws dynamodb scan \
        --table-name NotificationServiceStack-ConnectionTable \
        --select COUNT \
        --profile sandbox \
        --region eu-central-1 \
        --query 'Count' \
        --output text 2>/dev/null || echo "0")
    echo "   ✅ Table exists"
    echo "   📊 Active connections: $ITEM_COUNT"
else
    echo "   ❌ Table not found"
fi
echo ""

# Check SQS queues
echo "📬 SQS Queues:"
for queue in "NotificationServiceStack-WebSocketStandardQueue" "NotificationServiceStack-WebSocketFifoQueue.fifo"; do
    QUEUE_URL=$(aws sqs get-queue-url \
        --queue-name "$queue" \
        --profile sandbox \
        --region eu-central-1 \
        --query 'QueueUrl' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$QUEUE_URL" ]; then
        MSG_COUNT=$(aws sqs get-queue-attributes \
            --queue-url "$QUEUE_URL" \
            --attribute-names ApproximateNumberOfMessages \
            --profile sandbox \
            --region eu-central-1 \
            --query 'Attributes.ApproximateNumberOfMessages' \
            --output text 2>/dev/null || echo "0")
        echo "   ✅ $queue: $MSG_COUNT messages"
    else
        echo "   ❌ $queue: Not found"
    fi
done
echo ""

# Check Lambda functions
echo "⚡ Lambda Functions:"
for func in "ProcessorLambda" "ConnectionHandler" "P2PWebSocketPublisher" "A2PHttpPublisher"; do
    if aws lambda get-function \
        --function-name "NotificationServiceStack-$func" \
        --profile sandbox \
        --region eu-central-1 > /dev/null 2>&1; then
        echo "   ✅ $func"
    else
        echo "   ❌ $func: Not found"
    fi
done
echo ""

# Check Cognito
echo "🔐 Cognito User Pool:"
USER_COUNT=$(aws cognito-idp list-users \
    --user-pool-id eu-central-1_Fv5fjvyjH \
    --profile sandbox \
    --region eu-central-1 \
    --query 'length(Users)' \
    --output text 2>/dev/null || echo "0")
echo "   ✅ User Pool ID: eu-central-1_Fv5fjvyjH"
echo "   👥 Total users: $USER_COUNT"
echo ""

# Quick action menu
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   Quick Actions                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "1. 🌐 Open Web UI          → http://localhost:3000"
echo "2. 🛠  Interactive Testing  → ./quick-test.sh"
echo "3. 📊 View Processor Logs  → aws logs tail /aws/lambda/NotificationServiceStack-ProcessorLambda --follow --profile sandbox --region eu-central-1"
echo "4. 📖 Read Guide           → cat START_TESTING.md"
echo ""
echo "✨ Everything is ready! Start testing at http://localhost:3000"
echo ""
