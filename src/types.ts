export interface CommandContext {
  cwd?: string;
  user?: string;
  timestamp?: number;
  env?: Record<string, string>;
}

export interface CommandInterceptionResult {
  allowed: boolean;
  exitCode?: number;
  message?: string;
  authCode?: string;
  reason?: string;
}

export interface AuthToken {
  code: string;
  command: string;
  args: string[];
  timestamp: number;
  agentId?: string;
  used?: boolean;
}

export interface AgentDetectionResult {
  detected: boolean;
  agentType?: string;
  confidence?: number;
  factors?: {
    ssePort?: boolean;
    processName?: boolean;
    environment?: boolean;
    parentProcess?: boolean;
  };
}

export interface SafetyCheckResult {
  safe: boolean;
  category?: string;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requiresApproval?: boolean;
  message?: string;
}