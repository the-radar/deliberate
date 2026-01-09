# Deliberate Deployment & Installation Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Installation Methods](#installation-methods)
3. [Configuration](#configuration)
4. [Model Setup](#model-setup)
5. [Security Considerations](#security-considerations)
6. [Troubleshooting](#troubleshooting)
7. [Uninstallation](#uninstallation)

## Prerequisites

### System Requirements
- **OS**: Linux, macOS, or Windows with WSL2
- **Node.js**: v16.0.0 or higher
- **Memory**: Minimum 8GB RAM (16GB recommended for AI features)
- **Storage**: 10GB free space for models and logs
- **CPU**: 4+ cores recommended for parallel analysis

### Optional Requirements
- **Ollama**: For local LLM support (AI features)
- **Docker**: For containerized deployment
- **Git**: For development installation

## Installation Methods

### Method 1: NPM Global Install (Recommended)

```bash
# Install globally
npm install -g deliberate

# Verify installation
deliberate --version
```

### Method 2: Development Installation

```bash
# Clone repository
git clone https://github.com/yourusername/deliberate.git
cd deliberate

# Install dependencies
npm install

# Build TypeScript
npm run build

# Link globally
npm link

# Verify
deliberate --version
```

### Method 3: Docker Installation

```bash
# Pull official image
docker pull deliberate/deliberate:latest

# Create alias for easy usage
alias deliberate='docker run -it --rm \
  -v $HOME/.deliberate:/root/.deliberate \
  -v /var/run/docker.sock:/var/run/docker.sock \
  deliberate/deliberate:latest'

# Test installation
deliberate --version
```

### Method 4: System Package Managers

#### macOS (Homebrew)
```bash
brew tap deliberate/tap
brew install deliberate
```

#### Linux (APT)
```bash
echo "deb https://apt.deliberate.ai stable main" | sudo tee /etc/apt/sources.list.d/deliberate.list
curl -fsSL https://apt.deliberate.ai/gpg | sudo apt-key add -
sudo apt update
sudo apt install deliberate
```

## Initial Setup

### 1. Install PATH Shims

```bash
# Install shims for command interception
deliberate install

# This will:
# - Create ~/.deliberate/bin directory
# - Generate shims for dangerous commands
# - Add shim directory to PATH (requires shell restart)
```

### 2. Configure Shell

Add to your shell configuration file:

**Bash (~/.bashrc)**
```bash
# Deliberate command protection
export PATH="$HOME/.deliberate/bin:$PATH"
source "$HOME/.deliberate/shell/deliberate.bash"
```

**Zsh (~/.zshrc)**
```bash
# Deliberate command protection
export PATH="$HOME/.deliberate/bin:$PATH"
source "$HOME/.deliberate/shell/deliberate.zsh"
```

**Fish (~/.config/fish/config.fish)**
```fish
# Deliberate command protection
set -gx PATH $HOME/.deliberate/bin $PATH
source $HOME/.deliberate/shell/deliberate.fish
```

### 3. Verify Installation

```bash
# Restart shell or source config
source ~/.bashrc  # or ~/.zshrc

# Test interception
deliberate test

# Should show:
# ✓ PATH shims installed
# ✓ Command interception working
# ✓ TTY detection functional
# ✓ Security checks passed
```

## Configuration

### Basic Configuration

Create `~/.deliberate/config.yaml`:

```yaml
# Security settings
security:
  paranoid_mode: false        # Extra security checks
  require_tty: true          # Require TTY for dangerous commands
  allow_sudo: false          # Allow sudo bypass
  blocked_commands:          # Always block these
    - "rm -rf --no-preserve-root /"
    - ":(){ :|:& };:"

# AI settings (optional)
ai:
  enable_llm_analysis: false  # Enable local LLM
  timeout_ms: 5000           # AI timeout
  models:
    - name: qwen2
      enabled: true
      context_size: 2048
    - name: smollm2
      enabled: true
      context_size: 2048
    - name: deepseek-r1
      enabled: true
      context_size: 4096

# Performance
performance:
  parallel_analysis: true    # Use parallel pipeline
  cache_ttl_ms: 300000      # 5 minutes
  fast_path_enabled: true   # Skip analysis for safe commands

# Privacy
privacy:
  redact_sensitive: true    # Redact sensitive data
  local_only: true         # No external connections
  audit_commands: true     # Log commands (encrypted)

# Learning
learning:
  enable_continuous_learning: false
  federated_learning: false
  privacy_level: high      # high, medium, low
```

### Enterprise Configuration

For enterprise deployments, create `/etc/deliberate/config.yaml`:

```yaml
# Organization-wide settings
organization:
  name: "ACME Corp"
  security_team_email: "security@acme.com"

# Centralized policies
security:
  paranoid_mode: true
  enforce_policies: true
  custom_rules:
    - pattern: "aws s3 rm.*--recursive"
      action: "block"
      reason: "Bulk S3 deletion requires approval"
    
# Threat intelligence feeds
threat_intelligence:
  feeds:
    - name: "acme-blocklist"
      url: "https://security.acme.com/deliberate/threats.json"
      update_frequency: 3600

# Audit settings
audit:
  centralized_logging: true
  syslog_server: "logs.acme.com:514"
  encrypt_logs: true
```

## Model Setup (AI Features)

### Installing Ollama

```bash
# macOS/Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Verify
ollama --version
```

### Downloading Models

```bash
# Download required models
ollama pull qwen2:1.5b-instruct-q4_0
ollama pull smollm2:360m-instruct-q4_0
ollama pull deepseek-r1:1.5b-instruct-q4_0

# Verify models
ollama list
```

### Enable AI Features

```bash
# Enable in config
deliberate config set ai.enable_llm_analysis true

# Test AI analysis
echo "Testing AI" | deliberate analyze "rm -rf /tmp/test"
```

## Security Considerations

### 1. File Permissions

```bash
# Secure configuration files
chmod 600 ~/.deliberate/config.yaml
chmod 700 ~/.deliberate

# Secure audit logs
chmod 600 ~/.deliberate/audit/*.log
```

### 2. Bypass Prevention

```bash
# Test bypass prevention
deliberate security-test

# Should detect attempts like:
# - Direct binary execution
# - LD_PRELOAD injection
# - PTY allocation tricks
```

### 3. Audit Log Encryption

Audit logs are automatically encrypted. To read:

```bash
# View recent audit entries
deliberate audit show --limit 10

# Export for analysis
deliberate audit export --format json > audit-export.json
```

### 4. Update Security

```bash
# Check for security updates
deliberate update check

# Auto-update (if enabled)
deliberate config set updates.auto_install true
```

## Performance Tuning

### For Large Teams

```yaml
performance:
  parallel_analysis: true
  max_workers: 8
  cache_ttl_ms: 600000      # 10 minutes
  fast_path_enabled: true
  
  # Preload common safe commands
  preload_patterns:
    - "git *"
    - "npm *"
    - "docker ps*"
```

### For High-Security Environments

```yaml
security:
  paranoid_mode: true
  bypass_detection:
    memory_integrity: true
    timing_analysis: true
    process_chain_depth: 10
    
ai:
  enable_llm_analysis: true
  require_consensus: true    # All 3 models must agree
  confidence_threshold: 0.9
```

## Monitoring

### Health Check

```bash
# System health
deliberate health

# Performance stats
deliberate stats

# AI model status
deliberate ai status
```

### Metrics Export

```bash
# Prometheus format
deliberate metrics --format prometheus > metrics.txt

# JSON format for custom monitoring
deliberate metrics --format json
```

## Troubleshooting

### Common Issues

#### 1. Commands Not Intercepted

```bash
# Check PATH order
echo $PATH | grep -q ".deliberate/bin" || echo "Shim path not in PATH"

# Regenerate shims
deliberate install --force

# Verify specific command
which rm  # Should show ~/.deliberate/bin/rm
```

#### 2. AI Analysis Timeout

```bash
# Increase timeout
deliberate config set ai.timeout_ms 10000

# Check model status
ollama ps  # Should show running models

# Restart model service
deliberate ai restart
```

#### 3. Permission Denied

```bash
# Fix permissions
chmod +x ~/.deliberate/bin/*
chmod 755 ~/.deliberate/bin

# For system-wide install
sudo deliberate install --system
```

#### 4. High Memory Usage

```bash
# Reduce model context
deliberate config set ai.models.0.context_size 1024

# Disable parallel analysis
deliberate config set performance.parallel_analysis false

# Clear cache
deliberate cache clear
```

### Debug Mode

```bash
# Enable debug logging
export DELIBERATE_DEBUG=1
deliberate --debug [command]

# Check logs
tail -f ~/.deliberate/logs/deliberate.log
```

## Uninstallation

### Complete Removal

```bash
# Uninstall command
deliberate uninstall

# Manual cleanup
rm -rf ~/.deliberate
npm uninstall -g deliberate

# Remove from shell config
# Remove lines added to .bashrc/.zshrc/.config/fish/config.fish
```

### Preserve Configuration

```bash
# Backup configuration
cp -r ~/.deliberate/config* ~/deliberate-backup/

# Uninstall but keep config
deliberate uninstall --keep-config
```

## Updates

### Manual Updates

```bash
# Check for updates
deliberate update check

# Install update
deliberate update install
```

### Automatic Updates

```bash
# Enable auto-updates
deliberate config set updates.auto_check true
deliberate config set updates.auto_install true

# Configure update channel
deliberate config set updates.channel stable  # or: beta, nightly
```

## Support

### Getting Help

```bash
# Built-in help
deliberate help
deliberate [command] --help

# Documentation
deliberate docs

# Report issues
deliberate feedback
```

### Community

- GitHub Issues: https://github.com/yourusername/deliberate/issues
- Discord: https://discord.gg/deliberate
- Security Issues: security@deliberate.ai

## License

Deliberate is licensed under the MIT License. See LICENSE file for details.