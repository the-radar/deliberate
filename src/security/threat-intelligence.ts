import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';
import { SecureAuditLogger } from '../audit/audit-logger';

interface ThreatIndicator {
  id: string;
  type: 'command' | 'pattern' | 'behavior' | 'signature';
  severity: 'low' | 'medium' | 'high' | 'critical';
  indicator: string;
  description: string;
  metadata: {
    source: string;
    dateAdded: number;
    lastSeen?: number;
    hitCount: number;
    falsePositives: number;
  };
  mitigations: string[];
  tags: string[];
}

interface ThreatFeed {
  name: string;
  url: string;
  type: 'json' | 'csv' | 'stix';
  updateFrequency: number; // hours
  lastUpdate: number;
  trustScore: number;
}

interface ThreatReport {
  timestamp: number;
  matches: ThreatMatch[];
  riskScore: number;
  recommendations: string[];
}

interface ThreatMatch {
  indicator: ThreatIndicator;
  confidence: number;
  context: any;
}

export class ThreatIntelligenceSystem extends EventEmitter {
  private static instance: ThreatIntelligenceSystem;
  private logger: Logger;
  private indicators: Map<string, ThreatIndicator> = new Map();
  private feeds: Map<string, ThreatFeed> = new Map();
  private cache: Map<string, ThreatReport> = new Map();
  private dataDir: string;
  private updateInterval: NodeJS.Timer | null = null;
  
  // Known malicious patterns
  private readonly maliciousPatterns = [
    // Cryptominers
    { pattern: /xmrig|cgminer|bfgminer|ethminer|nheqminer/, tags: ['cryptominer'] },
    // Backdoors
    { pattern: /nc\s+-l|-e\s+\/bin\/(ba)?sh|socat.*EXEC/, tags: ['backdoor'] },
    // Data exfiltration
    { pattern: /curl.*\|\s*base64|wget.*-O\s*-.*\|/, tags: ['exfiltration'] },
    // Persistence
    { pattern: /crontab.*@reboot|systemctl.*enable|rc\.local/, tags: ['persistence'] },
    // Privilege escalation
    { pattern: /sudo\s+-l|find.*-perm.*4000|pkexec/, tags: ['privesc'] },
    // Log tampering
    { pattern: /history\s+-c|unset\s+HISTFILE|rm.*\.log/, tags: ['anti-forensics'] },
    // Process hiding
    { pattern: /LD_PRELOAD|process_hiding|rootkit/, tags: ['rootkit'] },
    // Network scanning
    { pattern: /nmap|masscan|zmap|nikto|dirb/, tags: ['recon'] }
  ];
  
  private constructor() {
    super();
    this.logger = new Logger('threat-intelligence');
    this.dataDir = path.join(process.env.HOME || '', '.deliberate', 'threat-intel');
    this.initializeSystem();
  }
  
  static getInstance(): ThreatIntelligenceSystem {
    if (!ThreatIntelligenceSystem.instance) {
      ThreatIntelligenceSystem.instance = new ThreatIntelligenceSystem();
    }
    return ThreatIntelligenceSystem.instance;
  }
  
  /**
   * Initialize threat intelligence system
   */
  private initializeSystem(): void {
    // Create data directory
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create data directory:', error);
    }
    
    // Load saved indicators
    this.loadIndicators();
    
    // Initialize default feeds
    this.initializeFeeds();
    
    // Start update cycle
    this.startUpdateCycle();
    
    // Load built-in indicators
    this.loadBuiltInIndicators();
  }
  
  /**
   * Load saved indicators
   */
  private loadIndicators(): void {
    try {
      const indicatorsFile = path.join(this.dataDir, 'indicators.json');
      if (fs.existsSync(indicatorsFile)) {
        const data = JSON.parse(fs.readFileSync(indicatorsFile, 'utf-8'));
        for (const indicator of data) {
          this.indicators.set(indicator.id, indicator);
        }
        this.logger.info(`Loaded ${this.indicators.size} threat indicators`);
      }
    } catch (error) {
      this.logger.error('Failed to load indicators:', error);
    }
  }
  
  /**
   * Initialize threat feeds
   */
  private initializeFeeds(): void {
    // Example threat feeds (in production, use real feeds)
    this.feeds.set('abuse-ch', {
      name: 'abuse.ch',
      url: 'https://urlhaus.abuse.ch/downloads/json/',
      type: 'json',
      updateFrequency: 1,
      lastUpdate: 0,
      trustScore: 0.9
    });
    
    this.feeds.set('emerging-threats', {
      name: 'Emerging Threats',
      url: 'https://rules.emergingthreats.net/open/indicators.json',
      type: 'json',
      updateFrequency: 6,
      lastUpdate: 0,
      trustScore: 0.85
    });
    
    this.feeds.set('custom-blocklist', {
      name: 'Custom Blocklist',
      url: 'file://' + path.join(this.dataDir, 'custom-blocklist.json'),
      type: 'json',
      updateFrequency: 24,
      lastUpdate: 0,
      trustScore: 1.0
    });
  }
  
  /**
   * Load built-in threat indicators
   */
  private loadBuiltInIndicators(): void {
    const builtInIndicators: Partial<ThreatIndicator>[] = [
      {
        type: 'command',
        severity: 'critical',
        indicator: 'rm -rf --no-preserve-root /',
        description: 'Attempts to delete entire filesystem',
        mitigations: ['Block command', 'Alert administrator'],
        tags: ['destructive', 'system-damage']
      },
      {
        type: 'pattern',
        severity: 'high',
        indicator: ':(){ :|:& };:',
        description: 'Fork bomb - denial of service attack',
        mitigations: ['Block command', 'Resource limits'],
        tags: ['dos', 'fork-bomb']
      },
      {
        type: 'command',
        severity: 'high',
        indicator: 'dd if=/dev/random of=/dev/sda',
        description: 'Attempts to overwrite disk with random data',
        mitigations: ['Block command', 'Require confirmation'],
        tags: ['destructive', 'data-loss']
      },
      {
        type: 'pattern',
        severity: 'medium',
        indicator: 'curl .* | sh',
        description: 'Downloads and executes remote script',
        mitigations: ['Warn user', 'Scan downloaded content'],
        tags: ['remote-execution', 'supply-chain']
      }
    ];
    
    for (const indicator of builtInIndicators) {
      const fullIndicator: ThreatIndicator = {
        id: crypto.randomUUID(),
        type: indicator.type!,
        severity: indicator.severity!,
        indicator: indicator.indicator!,
        description: indicator.description!,
        metadata: {
          source: 'built-in',
          dateAdded: Date.now(),
          hitCount: 0,
          falsePositives: 0
        },
        mitigations: indicator.mitigations!,
        tags: indicator.tags!
      };
      
      this.indicators.set(fullIndicator.id, fullIndicator);
    }
  }
  
  /**
   * Start update cycle for threat feeds
   */
  private startUpdateCycle(): void {
    // Initial update
    this.updateThreatFeeds();
    
    // Schedule periodic updates
    this.updateInterval = setInterval(
      () => this.updateThreatFeeds(),
      60 * 60 * 1000 // Every hour
    );
  }
  
  /**
   * Update threat feeds
   */
  private async updateThreatFeeds(): Promise<void> {
    for (const [feedId, feed] of this.feeds) {
      try {
        // Check if update needed
        const hoursSinceUpdate = (Date.now() - feed.lastUpdate) / (1000 * 60 * 60);
        if (hoursSinceUpdate < feed.updateFrequency) {
          continue;
        }
        
        this.logger.info(`Updating threat feed: ${feed.name}`);
        
        // Fetch and parse feed
        const indicators = await this.fetchFeed(feed);
        
        // Update indicators
        let newCount = 0;
        for (const indicator of indicators) {
          if (!this.indicators.has(indicator.id)) {
            newCount++;
          }
          this.indicators.set(indicator.id, indicator);
        }
        
        feed.lastUpdate = Date.now();
        
        this.logger.info(`Updated ${feed.name}: ${newCount} new indicators`);
        this.emit('feed-updated', { feedId, newIndicators: newCount });
        
      } catch (error) {
        this.logger.error(`Failed to update feed ${feedId}:`, error);
      }
    }
    
    // Save indicators
    this.saveIndicators();
  }
  
  /**
   * Fetch threat feed
   */
  private async fetchFeed(_feed: ThreatFeed): Promise<ThreatIndicator[]> {
    // In production, implement actual feed fetching
    // For now, return empty array
    return [];
  }
  
  /**
   * Analyze command for threats
   */
  async analyzeCommand(
    command: string,
    args: string[],
    context: any = {}
  ): Promise<ThreatReport> {
    const cacheKey = crypto
      .createHash('sha256')
      .update(`${command}:${args.join(':')}`)
      .digest('hex');
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached;
    }
    
    const matches: ThreatMatch[] = [];
    const fullCommand = `${command} ${args.join(' ')}`;
    
    // Check against indicators
    for (const indicator of this.indicators.values()) {
      const match = this.checkIndicator(fullCommand, indicator, context);
      if (match) {
        matches.push(match);
        
        // Update indicator stats
        indicator.metadata.lastSeen = Date.now();
        indicator.metadata.hitCount++;
      }
    }
    
    // Check against malicious patterns
    for (const { pattern, tags } of this.maliciousPatterns) {
      if (pattern.test(fullCommand)) {
        matches.push({
          indicator: {
            id: crypto.randomUUID(),
            type: 'pattern',
            severity: 'high',
            indicator: pattern.source,
            description: `Matches malicious pattern: ${tags.join(', ')}`,
            metadata: {
              source: 'pattern-matching',
              dateAdded: Date.now(),
              hitCount: 1,
              falsePositives: 0
            },
            mitigations: ['Review command', 'Block if confirmed malicious'],
            tags
          },
          confidence: 0.8,
          context: { pattern: pattern.source }
        });
      }
    }
    
    // Calculate risk score
    const riskScore = this.calculateRiskScore(matches);
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(matches, riskScore);
    
    const report: ThreatReport = {
      timestamp: Date.now(),
      matches,
      riskScore,
      recommendations
    };
    
    // Cache report
    this.cache.set(cacheKey, report);
    
    // Log high-risk commands
    if (riskScore > 0.7) {
      this.logThreatDetection(command, args, report);
    }
    
    return report;
  }
  
  /**
   * Check command against indicator
   */
  private checkIndicator(
    command: string,
    indicator: ThreatIndicator,
    context: any
  ): ThreatMatch | null {
    let confidence = 0;
    
    switch (indicator.type) {
      case 'command':
        if (command === indicator.indicator) {
          confidence = 1.0;
        } else if (command.includes(indicator.indicator)) {
          confidence = 0.8;
        }
        break;
        
      case 'pattern':
        try {
          const regex = new RegExp(indicator.indicator, 'i');
          if (regex.test(command)) {
            confidence = 0.9;
          }
        } catch {
          // Invalid regex
        }
        break;
        
      case 'behavior':
        // Would analyze command behavior
        confidence = this.analyzeBehavior(command, indicator);
        break;
        
      case 'signature':
        // Would check cryptographic signatures
        confidence = this.checkSignature(command, indicator);
        break;
    }
    
    if (confidence > 0.5) {
      return {
        indicator,
        confidence,
        context
      };
    }
    
    return null;
  }
  
  /**
   * Analyze command behavior
   */
  private analyzeBehavior(_command: string, _indicator: ThreatIndicator): number {
    // Simplified behavior analysis
    // In production, use more sophisticated analysis
    return 0;
  }
  
  /**
   * Check command signature
   */
  private checkSignature(_command: string, _indicator: ThreatIndicator): number {
    // Simplified signature check
    // In production, implement proper signature verification
    return 0;
  }
  
  /**
   * Calculate risk score
   */
  private calculateRiskScore(matches: ThreatMatch[]): number {
    if (matches.length === 0) return 0;
    
    let maxSeverity = 0;
    let totalConfidence = 0;
    
    for (const match of matches) {
      const severityScore = {
        'low': 0.25,
        'medium': 0.5,
        'high': 0.75,
        'critical': 1.0
      }[match.indicator.severity];
      
      const weightedScore = severityScore * match.confidence;
      maxSeverity = Math.max(maxSeverity, weightedScore);
      totalConfidence += match.confidence;
    }
    
    // Consider trust scores of sources
    const avgTrustScore = matches.reduce((sum, m) => {
      const source = m.indicator.metadata.source;
      const feed = Array.from(this.feeds.values()).find(f => f.name === source);
      return sum + (feed?.trustScore || 0.5);
    }, 0) / matches.length;
    
    // Final risk score
    return Math.min(1, maxSeverity * avgTrustScore);
  }
  
  /**
   * Generate recommendations
   */
  private generateRecommendations(
    matches: ThreatMatch[],
    riskScore: number
  ): string[] {
    const recommendations: string[] = [];
    
    if (riskScore > 0.8) {
      recommendations.push('🚨 BLOCK: High-risk command detected');
      recommendations.push('Notify security team immediately');
    } else if (riskScore > 0.6) {
      recommendations.push('⚠️ WARNING: Potentially dangerous command');
      recommendations.push('Require additional authentication');
      recommendations.push('Log command for security review');
    } else if (riskScore > 0.4) {
      recommendations.push('ℹ️ CAUTION: Command matches threat indicators');
      recommendations.push('Review command carefully before execution');
    }
    
    // Add specific mitigations
    const mitigations = new Set<string>();
    for (const match of matches) {
      for (const mitigation of match.indicator.mitigations) {
        mitigations.add(mitigation);
      }
    }
    
    recommendations.push(...Array.from(mitigations));
    
    return recommendations;
  }
  
  /**
   * Log threat detection
   */
  private async logThreatDetection(
    command: string,
    args: string[],
    report: ThreatReport
  ): Promise<void> {
    const auditLogger = SecureAuditLogger.getInstance();
    
    await auditLogger.log({
      event_type: 'security_violation',
      command,
      args,
      risk_level: report.riskScore > 0.8 ? 'CRITICAL' : 'HIGH',
      verdict: 'THREAT_DETECTED',
      metadata: {
        threat_matches: report.matches.length,
        risk_score: report.riskScore,
        indicators: report.matches.map(m => ({
          id: m.indicator.id,
          type: m.indicator.type,
          severity: m.indicator.severity,
          confidence: m.confidence
        }))
      }
    });
  }
  
  /**
   * Report false positive
   */
  async reportFalsePositive(indicatorId: string, context: any): Promise<void> {
    const indicator = this.indicators.get(indicatorId);
    if (indicator) {
      indicator.metadata.falsePositives++;
      
      // Reduce trust if too many false positives
      if (indicator.metadata.falsePositives > indicator.metadata.hitCount * 0.3) {
        this.logger.warn(`High false positive rate for indicator ${indicatorId}`);
        // Could remove or downgrade indicator
      }
      
      this.emit('false-positive-reported', { indicatorId, context });
      this.saveIndicators();
    }
  }
  
  /**
   * Add custom indicator
   */
  async addCustomIndicator(indicator: Partial<ThreatIndicator>): Promise<string> {
    const fullIndicator: ThreatIndicator = {
      id: crypto.randomUUID(),
      type: indicator.type || 'pattern',
      severity: indicator.severity || 'medium',
      indicator: indicator.indicator!,
      description: indicator.description || 'Custom threat indicator',
      metadata: {
        source: 'custom',
        dateAdded: Date.now(),
        hitCount: 0,
        falsePositives: 0
      },
      mitigations: indicator.mitigations || ['Review command'],
      tags: indicator.tags || ['custom']
    };
    
    this.indicators.set(fullIndicator.id, fullIndicator);
    this.saveIndicators();
    
    this.emit('indicator-added', fullIndicator);
    return fullIndicator.id;
  }
  
  /**
   * Save indicators to disk
   */
  private saveIndicators(): void {
    try {
      const indicatorsFile = path.join(this.dataDir, 'indicators.json');
      const data = Array.from(this.indicators.values());
      fs.writeFileSync(indicatorsFile, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error('Failed to save indicators:', error);
    }
  }
  
  /**
   * Get statistics
   */
  getStatistics(): any {
    const stats = {
      totalIndicators: this.indicators.size,
      indicatorsByType: {} as any,
      indicatorsBySeverity: {} as any,
      feedStats: [] as any[],
      cacheSize: this.cache.size,
      topThreats: [] as any[]
    };
    
    // Count by type and severity
    for (const indicator of this.indicators.values()) {
      stats.indicatorsByType[indicator.type] = (stats.indicatorsByType[indicator.type] || 0) + 1;
      stats.indicatorsBySeverity[indicator.severity] = (stats.indicatorsBySeverity[indicator.severity] || 0) + 1;
    }
    
    // Feed stats
    for (const [id, feed] of this.feeds) {
      stats.feedStats.push({
        id,
        name: feed.name,
        lastUpdate: feed.lastUpdate ? new Date(feed.lastUpdate).toISOString() : 'Never',
        trustScore: feed.trustScore
      });
    }
    
    // Top threats by hit count
    stats.topThreats = Array.from(this.indicators.values())
      .sort((a, b) => b.metadata.hitCount - a.metadata.hitCount)
      .slice(0, 10)
      .map(i => ({
        id: i.id,
        type: i.type,
        severity: i.severity,
        description: i.description,
        hitCount: i.metadata.hitCount,
        lastSeen: i.metadata.lastSeen ? new Date(i.metadata.lastSeen).toISOString() : 'Never'
      }));
    
    return stats;
  }
  
  /**
   * Stop threat intelligence system
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval as unknown as number);
      this.updateInterval = null;
    }
    
    this.saveIndicators();
    this.logger.info('Threat intelligence system stopped');
  }
}