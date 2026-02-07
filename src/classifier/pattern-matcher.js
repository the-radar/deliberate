/**
 * Pattern Matcher - Layer 1 of the classifier
 * Deterministic regex-based detection that cannot be prompt-injected.
 * This is the authoritative layer - if a pattern matches, the result is final.
 */

// Known dangerous command patterns
// NOTE: Patterns are checked in order. More specific patterns should come first.
// canOverride: false = hard block (catastrophic), true = warn but allow user override
const DANGEROUS_PATTERNS = [
  // Safe cleanup exceptions (must come before generic rm -rf handling)
  { pattern: /\brm\s+-rf\s+(\.\/)?node_modules\/?\s*$/, risk: 'SAFE', reason: 'Remove node_modules (common cleanup)', canOverride: false },
  { pattern: /\brm\s+-rf\s+(\.\/)?dist\/?\s*$/, risk: 'SAFE', reason: 'Remove dist folder (common cleanup)', canOverride: false },
  { pattern: /\brm\s+-rf\s+\.\/dist\/?\s*$/, risk: 'SAFE', reason: 'Remove dist folder (common cleanup)', canOverride: false },
  { pattern: /\brm\s+-rf\s+\/tmp\/[^\s]+/, risk: 'SAFE', reason: 'Remove temporary files (scoped path)', canOverride: false },

  // File system destruction - CATASTROPHIC (no override)
  { pattern: /\brm\s+-rf\s+\/\s*$/, risk: 'DANGEROUS', reason: 'Recursive deletion of root filesystem', canOverride: false },
  { pattern: /\brm\s+-rf\s+~\/?\s*$/, risk: 'DANGEROUS', reason: 'Recursive deletion of home directory', canOverride: false },
  { pattern: /\brm\s+-rf\s+\/\*/, risk: 'DANGEROUS', reason: 'Recursive deletion of root filesystem', canOverride: false },
  { pattern: /\brm\s+-rf\s+~\/\*\s*$/, risk: 'DANGEROUS', reason: 'Recursive deletion of entire home directory', canOverride: false },
  // File system destruction - DANGEROUS but overridable (specific paths/files)
  { pattern: /\brm\s+-rf\s+/, risk: 'DANGEROUS', reason: 'Force recursive deletion', canOverride: true },
  { pattern: /\brm\s+(-[rf]+\s+)*[\/~]/, risk: 'DANGEROUS', reason: 'File deletion from root or home', canOverride: true },
  { pattern: /\bmkfs\b/, risk: 'DANGEROUS', reason: 'Filesystem formatting' },
  { pattern: /\bdd\s+if=.*of=\/dev\//, risk: 'DANGEROUS', reason: 'Direct disk write' },
  { pattern: /\bshred\s+.*\s+\/dev\//, risk: 'DANGEROUS', reason: 'Secure disk wipe (shred)' },
  { pattern: /\bfind\s+\/\s+.*-delete\b/, risk: 'DANGEROUS', reason: 'Deleting files across root filesystem' },
  { pattern: /\btruncate\s+-s\s+0\s+\/var\/lib\/mysql\//, risk: 'DANGEROUS', reason: 'Truncating database storage files' },

  // Privilege escalation
  { pattern: /\bsu\s+-?\s*$/, risk: 'MODERATE', reason: 'Switch to root user' },
  { pattern: /\bchmod\s+777\b/, risk: 'DANGEROUS', reason: 'World-writable permissions' },
  { pattern: /\bchmod\s+\+s\b/, risk: 'DANGEROUS', reason: 'SetUID/SetGID bit' },
  { pattern: /\bchmod\s+4\d{3}\b/, risk: 'DANGEROUS', reason: 'SetUID bit via numeric chmod' },
  { pattern: /\bchown\s+root\b/, risk: 'MODERATE', reason: 'Changing ownership to root' },
  { pattern: />>\s*\/etc\/sudoers\b/, risk: 'DANGEROUS', reason: 'Modifying sudoers (privilege escalation)' },

  // Network exfiltration
  { pattern: /\bcurl\s+.*\|\s*(ba)?sh/, risk: 'DANGEROUS', reason: 'Remote code execution via curl pipe' },
  { pattern: /\bwget\s+.*\|\s*(ba)?sh/, risk: 'DANGEROUS', reason: 'Remote code execution via wget pipe' },
  { pattern: /\bcurl\s+.*(-d|--data).*\$\(/, risk: 'DANGEROUS', reason: 'Data exfiltration via curl' },
  { pattern: /\bnc\s+-e\s+\/bin\/(ba)?sh/, risk: 'DANGEROUS', reason: 'Reverse shell' },
  { pattern: /\bsocat\s+exec:/, risk: 'DANGEROUS', reason: 'Reverse shell (socat exec)' },
  { pattern: /\bfsockopen\s*\(/, risk: 'DANGEROUS', reason: 'Reverse shell (php fsockopen)' },
  { pattern: /\bTCPSocket\.open\b/, risk: 'DANGEROUS', reason: 'Reverse shell (ruby socket)' },

  // Credential access
  { pattern: /\bcat\s+.*\.(pem|key|passwd|shadow)/, risk: 'DANGEROUS', reason: 'Reading sensitive credentials' },
  { pattern: /\/etc\/shadow\b/, risk: 'DANGEROUS', reason: 'Accessing system password hash file' },
  { pattern: /\/\.ssh\/id_rsa/, risk: 'DANGEROUS', reason: 'Accessing SSH private key' },
  { pattern: /\/\.ssh\/id_ed25519/, risk: 'DANGEROUS', reason: 'Accessing SSH private key' },
  { pattern: /\/\.aws\/credentials/, risk: 'DANGEROUS', reason: 'Accessing AWS credentials' },
  { pattern: /\/\.env\b/, risk: 'MODERATE', reason: 'Accessing environment secrets' },
  { pattern: /\/\.gnupg\/private-keys-v1\.d\//, risk: 'DANGEROUS', reason: 'Accessing GPG private keys' },
  { pattern: /\bgrep\s+-i\s+password\b/, risk: 'DANGEROUS', reason: 'Searching for passwords in process or file content' },
  { pattern: /\bfind\s+.*\.pem.*-exec\s+cat\b/, risk: 'DANGEROUS', reason: 'Reading PEM keys found on disk' },
  { pattern: /\btar\s+.*(\.ssh|\.gnupg|\.aws)/, risk: 'DANGEROUS', reason: 'Bundling credential directories (exfil risk)' },
  { pattern: /\bchmod\s+600\s+.*id_(rsa|ed25519)\b/, risk: 'DANGEROUS', reason: 'Changing SSH private key permissions' },

  // Token and key file access (cat, less, more, head, tail, etc.)
  { pattern: /\b(cat|less|more|head|tail|bat|view)\s+.*token/i, risk: 'DANGEROUS', reason: 'Reading token file' },
  { pattern: /\b(cat|less|more|head|tail|bat|view)\s+.*secret/i, risk: 'DANGEROUS', reason: 'Reading secrets file' },
  { pattern: /\b(cat|less|more|head|tail|bat|view)\s+.*api[_-]?key/i, risk: 'DANGEROUS', reason: 'Reading API key file' },
  { pattern: /\b(cat|less|more|head|tail|bat|view)\s+.*\.key\b/, risk: 'DANGEROUS', reason: 'Reading key file' },
  { pattern: /\b(cat|less|more|head|tail|bat|view)\s+.*credential/i, risk: 'DANGEROUS', reason: 'Reading credentials file' },
  { pattern: /\b(cat|less|more|head|tail|bat|view)\s+.*password/i, risk: 'DANGEROUS', reason: 'Reading password file' },
  { pattern: /\b(cat|less|more|head|tail|bat|view)\s+.*\.pem\b/, risk: 'DANGEROUS', reason: 'Reading PEM certificate/key' },
  { pattern: /\b(cat|less|more|head|tail|bat|view)\s+.*private/i, risk: 'DANGEROUS', reason: 'Reading private key file' },
  { pattern: /\b(cat|less|more|head|tail|bat|view)\s+.*oauth/i, risk: 'DANGEROUS', reason: 'Reading OAuth token file' },
  { pattern: /\b(cat|less|more|head|tail|bat|view)\s+.*bearer/i, risk: 'DANGEROUS', reason: 'Reading bearer token file' },

  // Process/system manipulation
  { pattern: /\bkill\s+-9\s+(-1|1)\b/, risk: 'DANGEROUS', reason: 'Killing all processes' },
  { pattern: /\bkillall\b/, risk: 'MODERATE', reason: 'Killing processes by name' },
  { pattern: /\bpkill\b/, risk: 'MODERATE', reason: 'Killing processes by pattern' },
  { pattern: /:()\{\s*:\|:&\s*\};:/, risk: 'DANGEROUS', reason: 'Fork bomb detected' },

  // Database destruction
  { pattern: /\bDROP\s+(DATABASE|TABLE)\b/i, risk: 'DANGEROUS', reason: 'Database/table deletion' },
  { pattern: /\bDELETE\s+FROM\s+\w+\s*(;|$)/i, risk: 'DANGEROUS', reason: 'Unconditional DELETE' },
  { pattern: /\bmysql\s+-e\s+["']\s*TRUNCATE\s+TABLE\b/i, risk: 'MODERATE', reason: 'Database table truncation via mysql CLI' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, risk: 'DANGEROUS', reason: 'Table truncation' },
  { pattern: /\bredis-cli\s+FLUSHDB\b/i, risk: 'MODERATE', reason: 'Redis database flush' },
  { pattern: /\b(pg_dump|mongodump)\b/, risk: 'MODERATE', reason: 'Database backup/export' },

  // Cloud infrastructure - AWS
  { pattern: /\baws\s+.*\s+delete\b/, risk: 'DANGEROUS', reason: 'AWS resource deletion' },
  { pattern: /\baws\s+s3\s+rm\b/, risk: 'DANGEROUS', reason: 'S3 object/bucket deletion' },
  { pattern: /\baws\s+s3\s+rb\b/, risk: 'DANGEROUS', reason: 'S3 bucket removal' },
  { pattern: /\baws\s+s3\s+sync\b/, risk: 'MODERATE', reason: 'S3 data sync (potential exfiltration)' },
  { pattern: /\baws\s+ec2\s+terminate-instances\b/, risk: 'DANGEROUS', reason: 'EC2 instance termination' },
  { pattern: /\baws\s+.*--cidr\s+0\.0\.0\.0\/0/, risk: 'DANGEROUS', reason: 'Opening to all IPs (0.0.0.0/0)' },
  { pattern: /\baws\s+secretsmanager\s+get-secret-value\b/, risk: 'DANGEROUS', reason: 'Reading secrets' },
  { pattern: /\baws\s+ssm\s+get-parameter.*--with-decryption\b/, risk: 'DANGEROUS', reason: 'Reading decrypted parameters (likely secrets)' },
  { pattern: /\baws\s+iam\s+(create-user|create-access-key|attach-.*-policy)\b/, risk: 'DANGEROUS', reason: 'IAM privilege escalation' },
  { pattern: /\baws\s+iam\s+(put-user-policy|put-role-policy)\b/, risk: 'DANGEROUS', reason: 'IAM inline policy change' },
  { pattern: /\baws\s+s3api\s+put-bucket-policy\b/, risk: 'DANGEROUS', reason: 'Modifying bucket permissions' },
  { pattern: /\baws\s+lambda\s+update-function-code\b/, risk: 'MODERATE', reason: 'Lambda code deployment' },
  { pattern: /\baws\s+organizations\s+leave-organization\b/, risk: 'DANGEROUS', reason: 'AWS Organizations administrative action' },
  { pattern: /\baws\s+elasticache\s+reboot-cache-cluster\b/, risk: 'MODERATE', reason: 'ElastiCache reboot' },
  { pattern: /\bheroku\s+pg:reset\b/, risk: 'MODERATE', reason: 'Heroku Postgres reset' },
  { pattern: /\bgcloud\s+compute\s+instances\s+reset\b/, risk: 'MODERATE', reason: 'GCP instance reset' },
  { pattern: /\baz\s+vm\s+restart\b/, risk: 'MODERATE', reason: 'Azure VM restart' },
  { pattern: /\bgcloud\s+secrets\s+versions\s+access\b/, risk: 'DANGEROUS', reason: 'Accessing GCP secret value' },
  { pattern: /\baz\s+keyvault\s+secret\s+show\b/, risk: 'DANGEROUS', reason: 'Accessing Azure Key Vault secret value' },
  { pattern: /\bgcloud\s+projects\s+delete\b/, risk: 'DANGEROUS', reason: 'GCP project deletion' },
  { pattern: /\baz\s+group\s+delete\b/, risk: 'DANGEROUS', reason: 'Azure resource group deletion' },
  { pattern: /\bgcloud\s+compute\s+instances\s+delete\b/, risk: 'DANGEROUS', reason: 'GCP instance deletion' },
  { pattern: /\baz\s+vm\s+delete\b/, risk: 'DANGEROUS', reason: 'Azure VM deletion' },

  // Cloud infrastructure - Terraform/K8s
  { pattern: /\bterraform\s+destroy\b/, risk: 'DANGEROUS', reason: 'Infrastructure destruction' },
  { pattern: /\bgit\s+clean\s+-fdx\b/, risk: 'MODERATE', reason: 'Deleting untracked files and directories' },
  { pattern: /\bkubectl\s+delete\s+(namespace|ns)\b/, risk: 'DANGEROUS', reason: 'Kubernetes namespace deletion' },
  { pattern: /\bkubectl\s+delete\s+pod\b/, risk: 'MODERATE', reason: 'Kubernetes pod deletion' },
  { pattern: /\bkubectl\s+delete\s+--all\b/, risk: 'DANGEROUS', reason: 'Kubernetes mass deletion (--all)' },
  { pattern: /\bkubectl\s+exec\b/, risk: 'MODERATE', reason: 'Kubernetes pod shell access' },

  // Docker container escapes
  { pattern: /\bdocker\s+run\s+.*-v\s+\/[^:]*:/, risk: 'DANGEROUS', reason: 'Docker host filesystem mount' },
  { pattern: /\bdocker\s+run\s+.*--privileged/, risk: 'DANGEROUS', reason: 'Docker privileged mode' },
  { pattern: /\bnsenter\s+--target\s+1\b/, risk: 'DANGEROUS', reason: 'Host namespace entry (container escape)' },

  // Service operations (risky but generally recoverable)
  { pattern: /\bbrew\s+services\s+restart\b/, risk: 'MODERATE', reason: 'Restarting service' },
  { pattern: /\blaunchctl\s+unload\b/, risk: 'MODERATE', reason: 'Unloading launch daemon/service' },
  { pattern: /\bpm2\s+restart\b/, risk: 'MODERATE', reason: 'Restarting processes (pm2)' },
  { pattern: /\bsupervisorctl\s+restart\b/, risk: 'MODERATE', reason: 'Restarting supervised service' },

  // Package management with side effects
  { pattern: /\bpip\s+install\s+--upgrade\b/, risk: 'MODERATE', reason: 'Upgrading Python packages' },
  { pattern: /\bcargo\s+install\s+--force\b/, risk: 'MODERATE', reason: 'Installing Rust binary (forced)' },
  { pattern: /\bgem\s+update\s+--system\b/, risk: 'MODERATE', reason: 'Updating RubyGems system' },

  // File operations with risk
  { pattern: /\brsync\s+.*--delete\b/, risk: 'MODERATE', reason: 'File sync with deletions' },
  { pattern: /\bmv\s+~\/Documents\b/, risk: 'MODERATE', reason: 'Moving user documents' },
  { pattern: /\bchmod\s+-R\s+755\b/, risk: 'MODERATE', reason: 'Recursive permission change' },
  // Reverse shells (expanded)
  { pattern: /\/dev\/tcp\//, risk: 'DANGEROUS', reason: 'Bash /dev/tcp reverse shell' },
  { pattern: /\bncat\s+-e\s+/, risk: 'DANGEROUS', reason: 'Ncat reverse shell' },
  { pattern: /socket.*connect.*dup2.*subprocess/s, risk: 'DANGEROUS', reason: 'Python reverse shell pattern' },
  { pattern: /\barpspoof\b/, risk: 'DANGEROUS', reason: 'ARP spoofing attack' },
  { pattern: /\bettercap\b/, risk: 'DANGEROUS', reason: 'Network MITM tool (ettercap)' },
  { pattern: /\btcpdump\b.*-w\b/, risk: 'DANGEROUS', reason: 'Packet capture to file' },

  // Remote code execution (expanded)
  { pattern: /\bbash\s+-c\s+.*\$\(curl/, risk: 'DANGEROUS', reason: 'Curl subshell execution' },
  { pattern: /\bbash\s+-c\s+.*\$\(wget/, risk: 'DANGEROUS', reason: 'Wget subshell execution' },

  // Obfuscation
  { pattern: /base64\s+(-d|--decode).*\|\s*(ba)?sh/, risk: 'DANGEROUS', reason: 'Base64 decoded shell execution' },
  { pattern: /\bxxd\s+-r.*\|\s*(ba)?sh/, risk: 'DANGEROUS', reason: 'Hex decoded shell execution' },

  // Data exfiltration
  { pattern: /\benv\b.*\|\s*curl/, risk: 'DANGEROUS', reason: 'Environment variable exfiltration' },
  { pattern: /\bscp\s+.*\.ssh/, risk: 'DANGEROUS', reason: 'SSH key exfiltration' },
  { pattern: /\bscp\s+.*\.(pem|key|crt)/, risk: 'DANGEROUS', reason: 'Certificate/key exfiltration' },

  // Git credential manipulation
  { pattern: /\bgit\s+config\s+.*credential/, risk: 'MODERATE', reason: 'Git credential configuration' },
];

// Known safe command patterns (skip LLM analysis)
const SAFE_PATTERNS = [
  { pattern: /^\s*ls(\s+-[alh]+)*\s*$/, reason: 'List directory contents' },
  { pattern: /^\s*pwd\s*$/, reason: 'Print working directory' },
  { pattern: /^\s*echo\s+[^|;&`$]+$/, reason: 'Echo text (simple, no pipes/subshells)' },
  { pattern: /^\s*cat\s+[^|;&]+\.(txt|md|json|ya?ml|js|ts|py)(\s|$)/, reason: 'View text file' },
  // Head/tail are only considered safe for obviously non-sensitive text files.
  { pattern: /^\s*head\s+.*\.(txt|md|json|ya?ml|js|ts|py)(\s|$)/, reason: 'View file head' },
  { pattern: /^\s*tail\s+.*\.(txt|md|json|ya?ml|js|ts|py)(\s|$)/, reason: 'View file tail' },
  { pattern: /^\s*wc\s+/, reason: 'Word count' },
  { pattern: /^\s*which\s+/, reason: 'Locate command' },
  { pattern: /^\s*whoami\s*$/, reason: 'Current user' },
  { pattern: /^\s*date\s*$/, reason: 'Current date' },
  { pattern: /^\s*git\s+(status|log|diff|branch|show)\b/, reason: 'Git read operation' },
  { pattern: /^\s*git\s+stash\s+list\b/, reason: 'Git read operation' },
  { pattern: /^\s*git\s+remote\s+-v\b/, reason: 'Git read operation' },
  { pattern: /^\s*terraform\s+plan\b/, reason: 'Terraform plan (read-only preview)' },
  { pattern: /^\s*npm\s+(list|outdated|--version)\b/, reason: 'NPM info command' },
  { pattern: /^\s*pip\s+list\s+--outdated\b/, reason: 'Package info command' },
  { pattern: /^\s*bundle\s+outdated\b/, reason: 'Package info command' },
  { pattern: /^\s*cargo\s+tree\b/, reason: 'Package info command' },
  { pattern: /^\s*node\s+--version\s*$/, reason: 'Node version check' },
  { pattern: /^\s*python3?\s+--version\s*$/, reason: 'Python version check' },
  { pattern: /^\s*(rustc|go|java|swift)\s+--version\b/, reason: 'Tool version check' },
  { pattern: /^\s*dotnet\s+--list-sdks\b/, reason: 'Tool info command' },
  { pattern: /^\s*curl(\s+-[A-Za-z]+)*\s+https?:\/\/[^\s|;&`$]+(\s*)$/, reason: 'HTTP request (no pipes/subshells)' },
  { pattern: /^\s*docker\s+run\s+--rm\b/, reason: 'Ephemeral container run' },
  { pattern: /^\s*docker\s+exec\b/, reason: 'Execute command in existing container' },
  { pattern: /^\s*chmod\s+\+x\b/, reason: 'Mark file as executable' },
  { pattern: /^\s*aws\s+cloudwatch\s+get-metric-statistics\b/, reason: 'CloudWatch metric query (read-only)' },
  { pattern: /^\s*(lscpu|free\s+-h|df\s+-h|uptime|hostnamectl|timedatectl\s+status)\b/, reason: 'System info' },
  { pattern: /^\s*(ss\s+-tulpn|ip\s+route\s+show|dig\s+\S+|nslookup\s+\S+|traceroute\s+\S+)\b/, reason: 'Network info' },
  { pattern: /^\s*(gcloud\s+compute\s+zones\s+list|az\s+account\s+show|aws\s+iam\s+get-user|doctl\s+account\s+get|linode-cli\s+linodes\s+list)\b/, reason: 'Cloud read operation' },
  { pattern: /^\s*(docker\s+images\b|kubectl\s+get\s+namespaces\b|podman\s+ps\b|crictl\s+pods\b)\b/, reason: 'Container read operation' },
];

// File patterns for Write/Edit analysis
const DANGEROUS_FILE_PATTERNS = [
  { pattern: /\.(pem|key|crt|pfx)$/, risk: 'DANGEROUS', reason: 'Certificate/key file' },
  { pattern: /^\.env/, risk: 'MODERATE', reason: 'Environment configuration' },
  { pattern: /credentials|secrets?|password/i, risk: 'MODERATE', reason: 'Potential secrets file' },
  { pattern: /\/etc\//, risk: 'DANGEROUS', reason: 'System configuration' },
  { pattern: /\/usr\/bin\/|\/usr\/local\/bin\//, risk: 'DANGEROUS', reason: 'System binary location' },
  { pattern: /\.bashrc|\.zshrc|\.profile/, risk: 'MODERATE', reason: 'Shell configuration' },
  { pattern: /crontab|\.cron/, risk: 'MODERATE', reason: 'Scheduled task configuration' },
];

// Content patterns for Write/Edit analysis
const DANGEROUS_CONTENT_PATTERNS = [
  { pattern: /eval\s*\(.*\$/, risk: 'DANGEROUS', reason: 'Dynamic code execution' },
  { pattern: /exec\s*\(/, risk: 'MODERATE', reason: 'Process execution' },
  { pattern: /subprocess\.(run|call|Popen)/, risk: 'MODERATE', reason: 'Subprocess execution' },
  { pattern: /os\.system\s*\(/, risk: 'MODERATE', reason: 'System command execution' },
  { pattern: /child_process/, risk: 'MODERATE', reason: 'Child process spawning' },
  { pattern: /dangerouslySetInnerHTML/, risk: 'MODERATE', reason: 'XSS-prone React pattern' },
  { pattern: /innerHTML\s*=/, risk: 'MODERATE', reason: 'Potential XSS vector' },
  { pattern: /SELECT\s+.*\+\s*['"]?\s*\+/, risk: 'DANGEROUS', reason: 'SQL injection pattern' },
  { pattern: /password\s*[:=]\s*['"][^'"]+['"]/, risk: 'DANGEROUS', reason: 'Hardcoded password' },
  { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/, risk: 'DANGEROUS', reason: 'Hardcoded API key' },
  { pattern: /BEGIN\s+(RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY/, risk: 'DANGEROUS', reason: 'Private key in code' },
];

export class PatternMatcher {
  /**
   * Check a command against known patterns
   * @param {string} command - The command to check
   * @returns {{ matched: boolean, risk?: string, reason?: string, source: string }}
   */
  checkCommand(command) {
    // Normalize wrappers that do not materially change command semantics.
    // This keeps pattern matching deterministic for commands like:
    //   command rm -rf /
    //   env VAR=1 rm -rf /
    const normalized = String(command || '')
      .trim()
      // Treat sudo as a wrapper, we care about what it runs.
      // (We still catch dangerous underlying commands deterministically.)
      .replace(/^sudo\s+/, '')
      .replace(/^(command|\\command)\s+/, '')
      .replace(/^env\s+[^;|&]+?\s+/, '');

    // Check dangerous patterns first (order matters - more specific patterns first)
    for (const { pattern, risk, reason, canOverride } of DANGEROUS_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          matched: true,
          risk,
          reason,
          source: 'pattern',
          canOverride: canOverride !== undefined ? canOverride : false // Default to false if not specified
        };
      }
    }

    // Check safe patterns
    for (const { pattern, reason } of SAFE_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          matched: true,
          risk: 'SAFE',
          reason,
          source: 'pattern',
          canOverride: false
        };
      }
    }

    // No pattern match - needs classifier
    return { matched: false, source: 'pattern' };
  }

  /**
   * Check a file path against known patterns
   * @param {string} filePath - The file path to check
   * @returns {{ matched: boolean, risk?: string, reason?: string, source: string }}
   */
  checkFilePath(filePath) {
    for (const { pattern, risk, reason } of DANGEROUS_FILE_PATTERNS) {
      if (pattern.test(filePath)) {
        return {
          matched: true,
          risk,
          reason,
          source: 'pattern',
          canOverride: false
        };
      }
    }

    return { matched: false, source: 'pattern' };
  }

  /**
   * Check file content against known patterns
   * @param {string} content - The file content to check
   * @returns {{ matched: boolean, risk?: string, reason?: string, source: string }}
   */
  checkContent(content) {
    for (const { pattern, risk, reason } of DANGEROUS_CONTENT_PATTERNS) {
      if (pattern.test(content)) {
        return {
          matched: true,
          risk,
          reason,
          source: 'pattern',
          canOverride: false
        };
      }
    }

    return { matched: false, source: 'pattern' };
  }
}

export default PatternMatcher;
