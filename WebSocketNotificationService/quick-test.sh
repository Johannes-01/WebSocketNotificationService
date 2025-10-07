#!/bin/bash

# WebSocket Notification Service - Quick Test Script
# This script helps you quickly test the deployed service

set -e

PROFILE="sandbox"
REGION="eu-central-1"
USER_POOL_ID="eu-central-1_Fv5fjvyjH"
CLIENT_ID="1lf9sv60pmbvfbasjmu5ab7dcv"
WS_URL="wss://1gsi4bgu1k.execute-api.eu-central-1.amazonaws.com/dvl"
HTTP_URL="https://6dvx3pj0w3.execute-api.eu-central-1.amazonaws.com/prod/publish"

echo "🚀 WebSocket Notification Service - Quick Test"
echo "=============================================="
echo ""

# Function to create a test user
create_test_user() {
    local email=$1
    local password=$2
    
    echo "👤 Creating test user: $email"
    
    aws cognito-idp sign-up \
        --client-id "$CLIENT_ID" \
        --username "$email" \
        --password "$password" \
        --profile "$PROFILE" \
        --region "$REGION" \
        --output json
    
    echo "✅ User created. Confirming user..."
    
    aws cognito-idp admin-confirm-sign-up \
        --user-pool-id "$USER_POOL_ID" \
        --username "$email" \
        --profile "$PROFILE" \
        --region "$REGION"
    
    echo "✅ User confirmed"
}

# Function to get authentication token
get_token() {
    local email=$1
    local password=$2
    
    echo "🔐 Getting authentication token..."
    
    local token=$(aws cognito-idp initiate-auth \
        --client-id "$CLIENT_ID" \
        --auth-flow USER_PASSWORD_AUTH \
        --auth-parameters USERNAME="$email",PASSWORD="$password" \
        --profile "$PROFILE" \
        --region "$REGION" \
        --query 'AuthenticationResult.IdToken' \
        --output text)
    
    echo "$token"
}

# Function to test A2P HTTP publishing
test_a2p() {
    local token=$1
    local target_id=${2:-"user123"}
    local target_class=${3:-"user"}
    
    echo "📡 Testing A2P HTTP publish to $target_class:$target_id"
    
    curl -X POST "$HTTP_URL" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{
            \"targetChannel\": \"WebSocket\",
            \"messageType\": \"standard\",
            \"payload\": {
                \"targetId\": \"$target_id\",
                \"targetClass\": \"$target_class\",
                \"eventType\": \"test\",
                \"content\": \"Test message from quick-test script at $(date)\",
                \"priority\": \"normal\"
            }
        }"
    
    echo ""
    echo "✅ A2P message sent"
}

# Function to check connection table
check_connections() {
    echo "📊 Checking active connections..."
    
    aws dynamodb scan \
        --table-name NotificationServiceStack-ConnectionTable \
        --profile "$PROFILE" \
        --region "$REGION" \
        --max-items 10 \
        --output json | jq '.Items[] | {connectionId: .connectionId.S, userId: .userId.S, orgId: .orgId.S}'
}

# Function to tail logs
tail_logs() {
    local lambda_name=$1
    
    echo "📜 Tailing logs for $lambda_name..."
    echo "   (Press Ctrl+C to stop)"
    echo ""
    
    aws logs tail "/aws/lambda/NotificationServiceStack-$lambda_name" \
        --follow \
        --profile "$PROFILE" \
        --region "$REGION"
}

# Function to check queue status
check_queues() {
    echo "📊 Checking SQS queues..."
    
    for queue_name in "NotificationServiceStack-WebSocketStandardQueue" "NotificationServiceStack-WebSocketFifoQueue.fifo"; do
        echo ""
        echo "Queue: $queue_name"
        
        local queue_url=$(aws sqs get-queue-url \
            --queue-name "$queue_name" \
            --profile "$PROFILE" \
            --region "$REGION" \
            --query 'QueueUrl' \
            --output text 2>/dev/null || echo "Not found")
        
        if [ "$queue_url" != "Not found" ]; then
            aws sqs get-queue-attributes \
                --queue-url "$queue_url" \
                --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
                --profile "$PROFILE" \
                --region "$REGION" \
                --output json | jq '.Attributes'
        fi
    done
}

# Main menu
show_menu() {
    echo ""
    echo "What would you like to do?"
    echo "1. Create a test user"
    echo "2. Get authentication token"
    echo "3. Test A2P HTTP publish"
    echo "4. Check active connections"
    echo "5. Tail processor logs"
    echo "6. Check SQS queues"
    echo "7. Full test (create user + send message)"
    echo "8. Exit"
    echo ""
    read -p "Enter choice [1-8]: " choice
    
    case $choice in
        1)
            read -p "Email: " email
            read -sp "Password: " password
            echo ""
            create_test_user "$email" "$password"
            ;;
        2)
            read -p "Email: " email
            read -sp "Password: " password
            echo ""
            token=$(get_token "$email" "$password")
            echo "✅ Token: $token"
            echo ""
            echo "Export this token:"
            echo "export TOKEN='$token'"
            ;;
        3)
            read -p "Email: " email
            read -sp "Password: " password
            echo ""
            read -p "Target ID (default: user123): " target_id
            target_id=${target_id:-user123}
            read -p "Target Class (user/org/hub/project, default: user): " target_class
            target_class=${target_class:-user}
            
            token=$(get_token "$email" "$password")
            test_a2p "$token" "$target_id" "$target_class"
            ;;
        4)
            check_connections
            ;;
        5)
            tail_logs "ProcessorLambda"
            ;;
        6)
            check_queues
            ;;
        7)
            echo "🧪 Running full test..."
            test_email="test-$(date +%s)@example.com"
            test_password="TestPassword123!"
            
            create_test_user "$test_email" "$test_password"
            sleep 2
            
            token=$(get_token "$test_email" "$test_password")
            test_a2p "$token" "testuser" "user"
            
            echo ""
            echo "✅ Full test complete!"
            echo "   Email: $test_email"
            echo "   Password: $test_password"
            ;;
        8)
            echo "👋 Goodbye!"
            exit 0
            ;;
        *)
            echo "❌ Invalid choice"
            ;;
    esac
    
    show_menu
}

# Check dependencies
command -v aws >/dev/null 2>&1 || { echo "❌ AWS CLI not found. Please install it."; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "⚠️  jq not found. Some features will be limited."; }

# Show menu
show_menu
