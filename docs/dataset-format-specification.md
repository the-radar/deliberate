# Deliberate Dataset Format Specification

## Overview

This document defines the data format and schema for Deliberate's continuous learning system. The dataset is used to collect command execution patterns, user decisions, and safety classifications for improving the AI models over time.

## Version

Specification Version: 1.0.0
Last Updated: 2025-01-07

## File Format

Datasets are stored as newline-delimited JSON (NDJSON) files with the following structure:
- One JSON object per line
- UTF-8 encoding
- File extension: `.ndjson`
- Compressed with gzip for storage (`.ndjson.gz`)

## Schema Definition

### Core Dataset Entry

```typescript
interface DatasetEntry {
  // Unique identifier for this entry
  id: string;  // UUID v4
  
  // Timestamp when the command was executed
  timestamp: string;  // ISO 8601 format
  
  // Version of the dataset schema
  schemaVersion: string;  // "1.0.0"
  
  // Command information
  command: CommandInfo;
  
  // Execution context
  context: ExecutionContext;
  
  // Classification results
  classification: ClassificationResult;
  
  // AI analysis results (if AI mode was enabled)
  aiAnalysis?: AIAnalysisResult;
  
  // User decision and feedback
  userDecision: UserDecision;
  
  // Performance metrics
  performance: PerformanceMetrics;
  
  // Privacy and security metadata
  privacy: PrivacyMetadata;
}
```

### Command Information

```typescript
interface CommandInfo {
  // The command name/binary
  command: string;
  
  // Command arguments (redacted)
  args: string[];
  
  // Full command line (redacted)
  fullCommand: string;
  
  // Command type classification
  type: 'system' | 'user' | 'builtin' | 'alias' | 'function';
  
  // Whether command contained redirections or pipes
  hasRedirection: boolean;
  hasPipe: boolean;
  
  // Shell expansion indicators
  hasGlobbing: boolean;
  hasVariableExpansion: boolean;
  hasCommandSubstitution: boolean;
}
```

### Execution Context

```typescript
interface ExecutionContext {
  // User information (anonymized)
  user: {
    id: string;  // Hashed user ID
    isRoot: boolean;
    isSudo: boolean;
  };
  
  // Environment information
  environment: {
    shell: string;  // e.g., "bash", "zsh"
    terminal: string;  // e.g., "xterm-256color"
    isInteractive: boolean;
    isTTY: boolean;
    isPTY: boolean;
  };
  
  // Working directory (anonymized path)
  workingDirectory: {
    type: 'home' | 'system' | 'tmp' | 'project' | 'other';
    depth: number;  // Directory depth from root
  };
  
  // Parent process information
  parentProcess?: {
    name: string;
    pid: number;
    isShell: boolean;
    isScript: boolean;
  };
  
  // System state
  systemState: {
    loadAverage: number[];
    memoryUsagePercent: number;
    diskUsagePercent: number;
  };
}
```

### Classification Result

```typescript
interface ClassificationResult {
  // Risk level from classifier
  riskLevel: 'safe' | 'moderate' | 'dangerous';
  
  // Confidence score (0-1)
  confidence: number;
  
  // Detected patterns
  patterns: {
    patternId: string;
    patternName: string;
    matched: boolean;
  }[];
  
  // Bypass attempt detection
  bypassDetection: {
    detected: boolean;
    techniques: string[];  // e.g., ["direct_execution", "ld_preload"]
    confidence: number;
  };
  
  // Fast path eligibility
  fastPathEligible: boolean;
  fastPathReason?: string;
}
```

### AI Analysis Result

```typescript
interface AIAnalysisResult {
  // Whether AI analysis was performed
  performed: boolean;
  
  // Model consensus
  consensus: {
    decision: 'allow' | 'deny' | 'prompt';
    confidence: number;
    agreement: number;  // Percentage of models that agreed
  };
  
  // Individual model results
  models: {
    modelId: string;
    decision: 'allow' | 'deny' | 'prompt';
    confidence: number;
    reasoning: string;  // Summarized reasoning
    responseTime: number;  // Milliseconds
  }[];
  
  // Risk factors identified
  riskFactors: {
    factor: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
  }[];
  
  // Suggested alternatives
  alternatives?: {
    command: string;
    explanation: string;
    safetyImprovement: number;  // Percentage
  }[];
}
```

### User Decision

```typescript
interface UserDecision {
  // What the user decided
  action: 'execute' | 'cancel' | 'modify' | 'timeout';
  
  // Modified command if user changed it
  modifiedCommand?: string;
  
  // Time taken to decide (milliseconds)
  decisionTime: number;
  
  // User feedback (if provided)
  feedback?: {
    helpful: boolean;
    accurate: boolean;
    comment?: string;  // Free text, sanitized
  };
  
  // Whether user marked this as a false positive/negative
  correction?: {
    type: 'false_positive' | 'false_negative';
    correctClassification: 'safe' | 'moderate' | 'dangerous';
  };
}
```

### Performance Metrics

```typescript
interface PerformanceMetrics {
  // Total processing time (milliseconds)
  totalTime: number;
  
  // Breakdown of processing stages
  stages: {
    interception: number;
    classification: number;
    bypassDetection: number;
    sensitiveDataRedaction: number;
    aiAnalysis?: number;
    userPrompt?: number;
  };
  
  // Resource usage
  resources: {
    cpuPercent: number;
    memoryMB: number;
    cacheHit: boolean;
  };
}
```

### Privacy Metadata

```typescript
interface PrivacyMetadata {
  // Whether sensitive data was detected and redacted
  sensitiveDataDetected: boolean;
  
  // Types of sensitive data found
  sensitiveDataTypes: string[];  // e.g., ["api_key", "password", "ssn"]
  
  // Redaction statistics
  redactionStats: {
    redactedCount: number;
    redactionPatterns: string[];  // Pattern IDs, not actual patterns
  };
  
  // Data retention policy
  retention: {
    expiresAt: string;  // ISO 8601
    retentionDays: number;
    anonymizationLevel: 'minimal' | 'standard' | 'maximum';
  };
  
  // Consent and compliance
  consent: {
    collectionConsent: boolean;
    sharingConsent: boolean;
    improvementConsent: boolean;
  };
}
```

## Data Collection Rules

### What IS Collected

1. **Command Structure**: Command names, argument patterns (not values)
2. **Classification Results**: Risk levels, confidence scores, patterns matched
3. **User Decisions**: Whether commands were executed, cancelled, or modified
4. **Performance Metrics**: Processing times, resource usage
5. **Anonymized Context**: Shell type, terminal type, directory depth
6. **AI Analysis**: Model decisions, consensus, identified risks

### What is NOT Collected

1. **Actual File Paths**: Replaced with anonymized types (home, system, etc.)
2. **File Contents**: Never collected
3. **Credentials**: All passwords, API keys, tokens are redacted
4. **Personal Information**: Names, emails, IPs are anonymized or removed
5. **Actual Command Arguments**: Only patterns and types are recorded
6. **Environment Variables**: Only existence, not values

## Redaction Examples

### Command Redaction
```json
{
  "original": "curl -H 'Authorization: Bearer sk-1234567890' https://api.example.com",
  "redacted": "curl -H 'Authorization: Bearer [REDACTED_API_KEY]' https://[REDACTED_DOMAIN]"
}
```

### Path Redaction
```json
{
  "original": "/home/johndoe/projects/secret-project/src/main.py",
  "redacted": "[HOME]/[PROJECT]/[SUBDIR]/[FILE]"
}
```

### Argument Redaction
```json
{
  "original": ["mysql", "-u", "admin", "-p", "MyP@ssw0rd"],
  "redacted": ["mysql", "-u", "[REDACTED_USER]", "-p", "[REDACTED_PASSWORD]"]
}
```

## File Organization

### Directory Structure
```
~/.deliberate/learning-data/
├── current/
│   └── 2025-01-07.ndjson      # Today's data
├── archive/
│   ├── 2025-01-06.ndjson.gz   # Compressed historical data
│   ├── 2025-01-05.ndjson.gz
│   └── ...
├── aggregated/
│   ├── weekly-2025-01.json    # Weekly aggregations
│   └── monthly-2024-12.json   # Monthly aggregations
└── metadata.json               # Dataset metadata
```

### Metadata File
```json
{
  "version": "1.0.0",
  "created": "2025-01-07T10:00:00Z",
  "lastUpdated": "2025-01-07T15:30:00Z",
  "statistics": {
    "totalEntries": 15234,
    "uniqueCommands": 342,
    "userCorrections": 23,
    "avgProcessingTime": 12.5
  },
  "retention": {
    "currentPolicy": "90days",
    "anonymizationLevel": "standard"
  }
}
```

## Privacy and Compliance

### Anonymization Levels

1. **Minimal**: Basic redaction of sensitive data
2. **Standard**: Path and user anonymization, argument patterns only
3. **Maximum**: Complete anonymization, statistical data only

### Data Retention

- **Default**: 90 days of detailed data
- **Aggregated**: 1 year of statistical summaries
- **User-controlled**: Can be deleted at any time

### GDPR Compliance

- Right to access: Users can export their data
- Right to erasure: Users can delete all learning data
- Data portability: Export in standard JSON format
- Purpose limitation: Only used for safety improvement

## Usage Examples

### Reading Dataset
```typescript
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { parse } from 'ndjson';

const stream = createReadStream('learning-data/archive/2025-01-06.ndjson.gz')
  .pipe(createGunzip())
  .pipe(parse());

stream.on('data', (entry: DatasetEntry) => {
  console.log(`Command: ${entry.command.command}`);
  console.log(`Risk: ${entry.classification.riskLevel}`);
  console.log(`User action: ${entry.userDecision.action}`);
});
```

### Writing Dataset Entry
```typescript
const entry: DatasetEntry = {
  id: generateUUID(),
  timestamp: new Date().toISOString(),
  schemaVersion: "1.0.0",
  command: {
    command: "rm",
    args: ["[REDACTED_FILE]"],
    fullCommand: "rm [REDACTED_FILE]",
    type: "system",
    hasRedirection: false,
    hasPipe: false,
    hasGlobbing: false,
    hasVariableExpansion: false,
    hasCommandSubstitution: false
  },
  // ... rest of the entry
};

// Append to current day's file
appendFileSync(
  'learning-data/current/2025-01-07.ndjson',
  JSON.stringify(entry) + '\n'
);
```

## Validation

### JSON Schema

A complete JSON Schema for validation is available at:
`schemas/dataset-entry.schema.json`

### Validation Tool

```bash
# Validate a dataset file
deliberate validate-dataset learning-data/current/2025-01-07.ndjson

# Check privacy compliance
deliberate check-privacy learning-data/archive/2025-01-06.ndjson.gz
```

## Future Considerations

### Version 2.0 Additions
- Federated learning metadata
- Multi-user correlation data (anonymized)
- Extended AI model feedback
- Command sequence patterns
- System-wide threat indicators

### Migration Strategy
- Backward compatible with 1.0
- Automatic migration tool provided
- Graceful handling of missing fields

## Appendix: Common Patterns

### Safe Command Patterns
```json
[
  {"pattern": "ls", "variants": ["ls -la", "ls -l", "ls *.txt"]},
  {"pattern": "cd", "variants": ["cd ~", "cd ..", "cd /path"]},
  {"pattern": "echo", "variants": ["echo $VAR", "echo 'text'"]}
]
```

### Dangerous Command Patterns
```json
[
  {"pattern": "rm -rf", "variants": ["rm -rf /", "rm -rf ~"]},
  {"pattern": "chmod 777", "variants": ["chmod 777 .", "chmod -R 777"]},
  {"pattern": "curl | sh", "variants": ["curl URL | sh", "wget -O- | bash"]}
]
```