#!/bin/bash

# DAST Test Runner
# Runs Dynamic Application Security Testing against a real Deliberate installation

set -e

echo "🔒 Deliberate DAST (Dynamic Application Security Testing) Suite"
echo "=============================================================="
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Ensure we're in the project root
cd "$(dirname "$0")/../.."

# Build the project first
echo "📦 Building Deliberate..."
npm run build

# Make scripts executable
chmod +x tests/dast/setup-test-env.sh

# Run DAST tests
echo
echo "🧪 Running DAST Security Tests..."
echo "This will test Deliberate against real-world attack scenarios"
echo

# Run with increased timeout for DAST tests
npm test -- tests/dast/security-dast.test.ts --testTimeout=30000 --verbose

# Check results
if [ $? -eq 0 ]; then
    echo
    echo -e "${GREEN}✅ DAST tests passed!${NC}"
    echo "Deliberate successfully defended against:"
    echo "  - Direct binary execution bypasses"
    echo "  - Environment variable manipulation" 
    echo "  - PTY wrapper attacks"
    echo "  - Shell feature bypasses"
    echo "  - Command injection attempts"
    echo "  - AI authentication bypasses"
    echo "  - Timing attacks"
    echo "  - Sensitive data exposure"
else
    echo
    echo -e "${RED}❌ DAST tests failed!${NC}"
    echo "Security vulnerabilities detected that need fixing"
    exit 1
fi

echo
echo "📊 DAST Summary:"
echo "  - Tests run against real Deliberate installation"
echo "  - Simulated actual attack scenarios"
echo "  - Verified both security and functionality"
echo