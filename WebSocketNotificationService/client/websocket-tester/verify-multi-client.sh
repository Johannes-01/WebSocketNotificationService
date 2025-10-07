#!/bin/bash

# Multi-Client UI Test Script
# This script helps verify that all components are in place

echo "🔍 Checking Multi-Client UI Implementation..."
echo ""

# Check if required files exist
echo "📁 Checking for required files..."

files=(
  "src/components/MultiClientTester.tsx"
  "src/components/websocket/ClientCard.tsx"
  "src/components/websocket/ConnectionLog.tsx"
  "src/app/multi-client/page.tsx"
  "src/app/single-client/page.tsx"
  "src/app/page.tsx"
)

all_found=true
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ $file (NOT FOUND)"
    all_found=false
  fi
done

echo ""

# Check documentation
echo "📚 Checking for documentation..."

docs=(
  "MULTI_CLIENT_GUIDE.md"
  "MULTI_CLIENT_QUICK_START.md"
  "MULTI_CLIENT_UI_GUIDE.md"
  "MULTI_CLIENT_IMPLEMENTATION_SUMMARY.md"
)

for doc in "${docs[@]}"; do
  if [ -f "$doc" ]; then
    echo "  ✅ $doc"
  else
    echo "  ❌ $doc (NOT FOUND)"
    all_found=false
  fi
done

echo ""

# Check if dev server is running
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
  echo "🟢 Dev server is running on port 3000"
elif lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
  echo "🟢 Dev server is running on port 3001"
else
  echo "⚪ Dev server is not running"
  echo "   Run: npm run dev"
fi

echo ""

if [ "$all_found" = true ]; then
  echo "✅ All required files are present!"
  echo ""
  echo "🎉 Multi-Client UI is ready to use!"
  echo ""
  echo "📖 Quick Start:"
  echo "  1. npm run dev"
  echo "  2. Open http://localhost:3000 (or 3001)"
  echo "  3. Sign in with your credentials"
  echo "  4. Choose 'Multi-Client Tester'"
  echo "  5. Start creating clients!"
  echo ""
  echo "📚 Documentation:"
  echo "  - MULTI_CLIENT_QUICK_START.md - Getting started guide"
  echo "  - MULTI_CLIENT_GUIDE.md - Comprehensive documentation"
  echo "  - MULTI_CLIENT_UI_GUIDE.md - UI visual guide"
else
  echo "❌ Some files are missing. Please check the implementation."
fi
