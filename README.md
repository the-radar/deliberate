# Deliberate 🛡️

<p align="center">
  <strong>Intelligent Command-Line Protection with Local AI</strong><br>
  <em>Prevent costly mistakes before they happen</em>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#security">Security</a> •
  <a href="#contributing">Contributing</a>
</p>

---

Deliberate is an intelligent command-line safety tool that intercepts dangerous commands and provides AI-powered analysis using local LLMs. It acts as a protective layer between you and potentially destructive operations, ensuring commands are executed only with proper understanding and authorization.

## 🎯 Why Deliberate?

Every year, countless hours and valuable data are lost due to accidental command execution:
- `rm -rf /` typed in the wrong directory
- Production database deletions
- Accidental cloud resource termination
- Malicious script execution

Deliberate prevents these disasters by:
- **Intercepting dangerous commands** before execution
- **Analyzing intent** with local AI models
- **Requiring explicit confirmation** for risky operations
- **Learning from your patterns** to reduce false positives

## ✨ Features

### 🧠 AI-Powered Analysis
- **Local LLM Integration**: Uses Ollama with privacy-preserving local models
- **Multi-Model Consensus**: Three specialized models analyze each command
- **Context-Aware Decisions**: Understands command intent and potential impact
- **Continuous Learning**: Improves accuracy based on your usage patterns

### 🔒 Security First
- **Advanced Bypass Prevention**: Detects and blocks circumvention attempts
- **Command Integrity Verification**: Cryptographic signing of approved commands
- **Sensitive Data Redaction**: Automatically redacts API keys, passwords, and PII
- **Audit Logging**: Encrypted, tamper-proof audit trail

### ⚡ Performance Optimized
- **Fast Path for Safe Commands**: <10ms overhead for common operations
- **Parallel Analysis Pipeline**: Concurrent processing for complex commands
- **Intelligent Caching**: Remembers previous decisions
- **Minimal System Impact**: Efficient resource usage

### 🔧 Enterprise Ready
- **Centralized Configuration**: Organization-wide policies
- **Threat Intelligence Integration**: Custom threat feeds
- **Federated Learning**: Share insights without sharing data
- **Compliance Support**: SOC2, HIPAA, PCI-DSS compatible

## 📦 Installation

### Prerequisites
- Node.js 18.0.0 or higher
- macOS, Linux, or WSL
- (Optional) Ollama for AI features

### Quick Install
```bash
npm install -g deliberate
deliberate install
```

### Install with AI Features
```bash
# First, install Ollama from https://ollama.ai
# Then install Deliberate with AI models
npm install -g deliberate
deliberate install --with-ai
```

This will:
1. Create command shims in `~/.deliberate/shims`
2. Update your shell configuration
3. Download required AI models (if --with-ai is used)

**Important**: Restart your shell or run:
```bash
export PATH="$HOME/.deliberate/shims:$PATH"
```

## 🚀 Usage

### Basic Usage
Once installed, Deliberate works transparently. Just use commands as normal:

```bash
# Safe commands pass through instantly
ls -la  # ✓ No intervention needed

# Dangerous commands require approval
rm -rf important_directory
# 🛡️ Deliberate Security Analysis
# Command: rm -rf important_directory
# Risk Level: DANGEROUS
# Reason: Recursively deletes directory and all contents
# 
# Do you want to proceed? [y/N]
```

### AI Agent Interface
For LLM agents that can't handle interactive prompts:

```bash
# First attempt generates an auth code
deliberate ai rm /etc/hosts
# 🤖 AI Agent Safety Analysis
# This command will delete the system hosts file...
# To execute deliberately, run:
# deliberate ai fast-fox-1234 rm /etc/hosts

# Use the auth code to execute
deliberate ai fast-fox-1234 rm /etc/hosts
# ✓ Auth code validated. Executing command...
```

### Command Management

```bash
# Check installation status
deliberate verify

# Update safety patterns
deliberate update

# View configuration
deliberate config show

# Apply team policy
deliberate config apply-policy /path/to/policy.yaml

# Uninstall
deliberate uninstall
```

## ⚙️ Configuration

Deliberate can be configured via `~/.deliberate/config.yaml`:

```yaml
version: "1.0.0"

security:
  enforcement_level: strict      # strict, moderate, permissive
  bypass_prevention: true
  require_tty: true
  audit_logging: true

performance:
  enable_fast_path: true
  cache_size: 10000
  parallel_analysis: true

ai:
  enable_llm_analysis: true
  models:
    primary: qwen2:1.5b
    secondary: smollm2:1.7b
    decision: deepseek-r1:1.5b
  confidence_threshold: 0.7

patterns:
  custom_dangerous:
    - "aws s3 rm.*--recursive"
    - "kubectl delete namespace"
  custom_safe:
    - "npm run build"
    - "yarn test"
```

### Team Policies

Organizations can create policy files to enforce consistent safety standards:

```yaml
# organization-policy.yaml
security:
  enforcement_level: strict
  
patterns:
  custom_dangerous:
    - "terraform destroy"
    - "DROP DATABASE"
  whitelist_commands:
    - "/opt/company/deploy.sh"

notifications:
  webhook_url: "https://hooks.slack.com/..."
  alert_on_dangerous: true
```

Apply with: `deliberate config apply-policy organization-policy.yaml`

## 🔒 Security

### Bypass Prevention
Deliberate implements multiple layers of security to prevent bypasses:
- **TTY Detection**: Direct terminal access required, prevents `echo y | deliberate`
- **Process Inspection**: Detects PTY wrappers like `script` and `expect`
- **Environment Protection**: Blocks LD_PRELOAD and PATH manipulation
- **Time-based Tokens**: Auth codes expire after 5 minutes

### Privacy
- **Local AI Models**: All AI analysis happens on your machine
- **Sensitive Data Redaction**: Passwords, API keys, and personal info are never sent to AI
- **Encrypted Audit Logs**: Logs are encrypted and tamper-proof

### Threat Model
Deliberate protects against:
- Accidental command execution
- Copy-paste mistakes
- Malicious scripts
- Compromised AI agents
- Social engineering attacks

## 📊 Performance

Deliberate is designed for minimal overhead:
- **Safe Commands**: <10ms overhead (often <5ms)
- **Pattern Analysis**: <50ms for complex commands
- **AI Analysis**: 200-500ms for full LLM consensus
- **Memory Usage**: ~50MB baseline, +2GB with AI models

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
```bash
git clone https://github.com/yourusername/deliberate.git
cd deliberate
npm install
npm run dev
```

### Running Tests
```bash
npm test                 # Unit tests
npm run test:security    # Security tests
npm run test:coverage    # Coverage report
```

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Built with [TypeScript](https://www.typescriptlang.org/) and [Node.js](https://nodejs.org/)
- AI models from [Qwen](https://github.com/QwenLM/Qwen), [SmolLM](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B), and [DeepSeek](https://github.com/deepseek-ai/DeepSeek-LLM)
- Inspired by `sudo` but for the AI age

---

<p align="center">
  <strong>Stay safe, stay deliberate 🛡️</strong>
</p>