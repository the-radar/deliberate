import * as crypto from 'crypto';

export interface RedactionResult {
  redacted: string;
  found?: Array<{
    type: string;
    position?: { start: number; end: number };
    redacted?: boolean;
    value?: string;
  }>;
  count?: number;
  sensitive?: boolean;
  type?: string;
  preservedStructure?: boolean;
  visibleChars?: { prefix: number; suffix: number };
  components?: Record<string, string>;
  envVar?: string;
  pii?: boolean;
  customPatternUsed?: string;
  matchedPattern?: string;
  redactionCount?: number;
  performanceMs?: number;
  cached?: boolean;
  validation?: {
    originalSensitiveCount: number;
    remainingSensitiveCount: number;
    success: boolean;
  };
  recovery?: {
    hash: string;
    timestamp: number;
    context: string;
  };
}

export interface RedactionPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
  priority?: number;
}

export interface RedactionOptions {
  preserveStructure?: boolean;
  redactEmails?: boolean;
  enableRecovery?: boolean;
}

export class SensitiveDataRedactor {
  private patterns: Map<string, RedactionPattern> = new Map();
  private compiledPatterns: Map<string, RegExp> = new Map();
  private redactionCache: Map<string, RedactionResult> = new Map();

  constructor() {
    this.initializePatterns();
  }

  /**
   * Initialize built-in redaction patterns
   */
  private initializePatterns(): void {
    // API Keys
    this.addPattern({
      name: 'bearer_token',
      pattern: /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi,
      replacement: 'Bearer [REDACTED_API_KEY]',
    });

    this.addPattern({
      name: 'openai_key',
      pattern: /sk-[A-Za-z0-9]{20,}/gi,
      replacement: '[REDACTED_API_KEY]',
    });

    this.addPattern({
      name: 'aws_access_key',
      pattern: /AKIA[0-9A-Z]{16}/gi,
      replacement: '[REDACTED_AWS_KEY]',
    });

    this.addPattern({
      name: 'google_api_key',
      pattern: /AIza[0-9A-Za-z\-_]{35}/gi,
      replacement: '[REDACTED_API_KEY]',
    });

    this.addPattern({
      name: 'github_token',
      pattern: /ghp_[A-Za-z0-9]{36}/gi,
      replacement: '[REDACTED_GITHUB_TOKEN]',
    });

    // Passwords
    this.addPattern({
      name: 'password_param',
      pattern: /(\b(?:password|passwd|pwd|pass)\s*[=:]\s*)([^\s&;]+)/gi,
      replacement: '$1[REDACTED]',
    });

    this.addPattern({
      name: 'mysql_password',
      pattern: /(-p)([^\s]+)/g,
      replacement: '-p[REDACTED_PASSWORD]',
    });

    this.addPattern({
      name: 'url_credentials',
      pattern: /:\/\/([^:]+):([^@]+)@/g,
      replacement: '://$1:[REDACTED]@',
    });

    // SSH Keys
    this.addPattern({
      name: 'ssh_private_key',
      pattern: /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----[\s\S]+?-----END\s+(?:RSA|DSA|EC|OPENSSH)\s+PRIVATE\s+KEY-----/gi,
      replacement: '[REDACTED_SSH_PRIVATE_KEY]',
    });

    this.addPattern({
      name: 'ssh_public_key',
      pattern: /ssh-rsa\s+[A-Za-z0-9+\/=]+/gi,
      replacement: '[REDACTED_SSH_KEY]',
    });

    this.addPattern({
      name: 'certificate',
      pattern: /-----BEGIN\s+CERTIFICATE-----[\s\S]+?-----END\s+CERTIFICATE-----/gi,
      replacement: '[REDACTED_CERTIFICATE]',
    });

    // Credit Cards
    this.addPattern({
      name: 'credit_card',
      pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
      replacement: '[REDACTED_CC]',
    });

    // SSN
    this.addPattern({
      name: 'ssn',
      pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
      replacement: '[REDACTED_SSN]',
    });

    // Email (optional)
    this.addPattern({
      name: 'email',
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      replacement: '[REDACTED_EMAIL]',
    });

    // Environment variables
    this.addPattern({
      name: 'env_secret',
      pattern: /(AWS_SECRET_ACCESS_KEY|DATABASE_PASSWORD|DB_PASSWORD|API_KEY|SECRET_KEY|PRIVATE_KEY|JWT_SECRET)\s*=\s*([^\s]+)/gi,
      replacement: '$1=[REDACTED]',
    });
  }

  /**
   * Add custom redaction pattern
   */
  addPattern(pattern: RedactionPattern): void {
    this.patterns.set(pattern.name, pattern);
    this.compiledPatterns.set(pattern.name, pattern.pattern);
    // Clear cache when patterns change
    this.redactionCache.clear();
  }

  /**
   * Redact sensitive data from text
   */
  async redact(text: string, options: RedactionOptions = {}): Promise<RedactionResult> {
    const startTime = Date.now();

    // Check cache
    const cacheKey = `${text}:${JSON.stringify(options)}`;
    const cached = this.redactionCache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true, performanceMs: Date.now() - startTime };
    }

    let redacted = text;
    const found: any[] = [];
    let sensitiveCount = 0;

    // Apply patterns in priority order
    const sortedPatterns = Array.from(this.patterns.values())
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const pattern of sortedPatterns) {
      // Skip email pattern if not requested
      if (pattern.name === 'email' && !options.redactEmails) {
        continue;
      }

      const matches = text.matchAll(pattern.pattern);
      for (const match of matches) {
        sensitiveCount++;
        found.push({
          type: pattern.name,
          position: { start: match.index!, end: match.index! + match[0].length },
          redacted: true,
          value: options.enableRecovery ? this.hashValue(match[0]) : undefined,
        });

        if (options.preserveStructure && pattern.name.includes('key')) {
          // Preserve some structure for debugging
          redacted = redacted.replace(match[0], this.preserveStructure(match[0]));
        } else {
          redacted = redacted.replace(match[0], pattern.replacement);
        }
      }
    }

    const result: RedactionResult = {
      redacted,
      found,
      count: found.length,
      sensitive: found.length > 0,
      performanceMs: Date.now() - startTime,
    };

    // Add recovery information if requested
    if (options.enableRecovery && found.length > 0) {
      result.recovery = {
        hash: this.hashValue(text),
        timestamp: Date.now(),
        context: 'redaction',
      };
    }

    // Add validation
    result.validation = {
      originalSensitiveCount: sensitiveCount,
      remainingSensitiveCount: this.countRemainingSensitive(redacted),
      success: this.countRemainingSensitive(redacted) === 0,
    };

    // Cache result
    this.redactionCache.set(cacheKey, result);

    return result;
  }

  /**
   * Redact sensitive data from command
   */
  async redactCommand(command: string): Promise<string> {
    const result = await this.redact(command);
    return result.redacted;
  }

  /**
   * Redact sensitive data from output
   */
  async redactOutput(output: string): Promise<string> {
    const result = await this.redact(output);
    return result.redacted;
  }

  /**
   * Redact sensitive data from logs
   */
  async redactLogs(logs: string): Promise<RedactionResult> {
    const lines = logs.split('\n');
    const redactedLines: string[] = [];
    let totalRedactionCount = 0;

    for (const line of lines) {
      const result = await this.redact(line);
      redactedLines.push(result.redacted);
      totalRedactionCount += result.count || 0;
    }

    return {
      redacted: redactedLines.join('\n'),
      redactionCount: totalRedactionCount,
      preservedStructure: true,
    };
  }

  /**
   * Detect sensitive data without redacting
   */
  async detectSensitiveData(text: string): Promise<any> {
    const found: any[] = [];

    for (const [name, pattern] of this.patterns.entries()) {
      const matches = text.matchAll(pattern.pattern);
      for (const match of matches) {
        found.push({
          type: name,
          position: { start: match.index!, end: match.index! + match[0].length },
          preview: this.getPreview(text, match.index!, match[0].length),
        });
      }
    }

    return found;
  }

  /**
   * Check if text has been properly redacted
   */
  async isRedacted(text: string): Promise<boolean> {
    // Check for common sensitive patterns
    const sensitivePatterns = [
      /sk-[A-Za-z0-9]{20,}/,  // API keys
      /password\s*[=:]\s*[^\s\[]/i,  // Unredacted passwords
      /-----BEGIN.*PRIVATE.*KEY-----/,  // Private keys
      /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,  // Credit cards
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(text)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get redaction patterns
   */
  getRedactionPatterns(): RedactionPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Add custom pattern
   */
  async addCustomPattern(pattern: RedactionPattern): Promise<void> {
    this.addPattern(pattern);
  }

  /**
   * Preserve structure of sensitive data
   */
  private preserveStructure(value: string): string {
    if (value.length <= 10) {
      return value.substring(0, 2) + '*'.repeat(value.length - 2);
    }
    return value.substring(0, 7) + '*'.repeat(value.length - 7);
  }

  /**
   * Hash value for recovery
   */
  private hashValue(value: string): string {
    return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
  }

  /**
   * Count remaining sensitive data
   */
  private countRemainingSensitive(text: string): number {
    let count = 0;
    for (const pattern of this.patterns.values()) {
      const matches = text.matchAll(pattern.pattern);
      for (const match of matches) {
        if (!match[0].includes('[REDACTED')) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Get preview of sensitive data location
   */
  private getPreview(text: string, index: number, length: number): string {
    const start = Math.max(0, index - 20);
    const end = Math.min(text.length, index + length + 20);
    const preview = text.substring(start, end);
    const relativeIndex = index - start;
    
    return (
      preview.substring(0, relativeIndex) +
      '[***]' +
      preview.substring(relativeIndex + length)
    );
  }
}