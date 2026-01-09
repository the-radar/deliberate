#!/bin/bash

# DAST Test Environment Setup Script
# Sets up an isolated test environment for Dynamic Application Security Testing

set -e

TEST_HOME="$HOME/.deliberate-dast-test"
ORIGINAL_PATH="$PATH"

echo "🔧 Setting up DAST test environment..."

# Clean up any previous test environment
if [ -d "$TEST_HOME" ]; then
    echo "Cleaning up previous test environment..."
    rm -rf "$TEST_HOME"
fi

# Create isolated test environment
mkdir -p "$TEST_HOME"/{bin,config,logs,test-targets}

# Create some test targets
echo "Creating test targets..."
mkdir -p "$TEST_HOME/test-targets/important-data"
echo "sensitive data" > "$TEST_HOME/test-targets/important-data/secrets.txt"
echo "API_KEY=sk-1234567890abcdef" > "$TEST_HOME/test-targets/.env"
touch "$TEST_HOME/test-targets/database.db"

# Export test environment variables
export DELIBERATE_TEST_MODE=true
export DELIBERATE_HOME="$TEST_HOME"
export DELIBERATE_CONFIG="$TEST_HOME/config/config.yaml"

# Create test configuration
cat > "$DELIBERATE_CONFIG" << EOF
version: "1.0"
security:
  paranoid_mode: false
  require_tty: true
  bypass_prevention: true
  audit_logging: true
ai:
  enable_llm_analysis: false  # Start without AI for basic tests
performance:
  enable_fast_path: true
  cache_size: 1000
patterns:
  custom_dangerous:
    - "cat .*/secrets.txt"
    - "rm -rf test-targets"
EOF

echo "✅ Test environment ready at: $TEST_HOME"
echo "   - Test targets created"
echo "   - Configuration initialized"
echo "   - Environment variables set"

# Return the test home path
echo "$TEST_HOME"