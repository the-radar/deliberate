import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger';
import { ConfigManager } from '../config/config-manager';
import { IncrementalModelUpdater } from './model-updater';

interface FederatedNode {
  id: string;
  publicKey: string;
  endpoint?: string;
  lastSeen: number;
  trustScore: number;
  contributions: number;
}

interface ModelUpdate {
  nodeId: string;
  timestamp: number;
  gradients: Map<string, number[]>;
  sampleCount: number;
  signature: string;
}

interface AggregatedUpdate {
  id: string;
  timestamp: number;
  participantCount: number;
  totalSamples: number;
  aggregatedGradients: Map<string, number[]>;
  consensusReached: boolean;
}

export class FederatedLearningCoordinator extends EventEmitter {
  private static instance: FederatedLearningCoordinator;
  private logger: Logger;
  private nodes: Map<string, FederatedNode> = new Map();
  private pendingUpdates: Map<string, ModelUpdate[]> = new Map();
  private aggregationRounds: number = 0;
  private privateKey!: string;
  private isCoordinating: boolean = false;
  
  private constructor() {
    super();
    this.logger = new Logger('federated-coordinator');
    this.generateKeyPair();
    this.loadTrustedNodes();
    
    // Start coordination if enabled
    const config = ConfigManager.getInstance();
    if (config.getPath('learning.federated_learning')) {
      this.startCoordination();
    }
  }
  
  static getInstance(): FederatedLearningCoordinator {
    if (!FederatedLearningCoordinator.instance) {
      FederatedLearningCoordinator.instance = new FederatedLearningCoordinator();
    }
    return FederatedLearningCoordinator.instance;
  }
  
  /**
   * Generate key pair for secure communication
   */
  private generateKeyPair(): void {
    // In production, use proper cryptographic key generation
    this.privateKey = crypto.randomBytes(32).toString('hex');
    // Generate public key for future use
    crypto
      .createHash('sha256')
      .update(this.privateKey)
      .digest('hex');
  }
  
  /**
   * Load trusted nodes from configuration
   */
  private loadTrustedNodes(): void {
    throw new Error('NotImplementedError: Trusted node loading not implemented. This requires secure key management and node discovery infrastructure.');
    
    // TODO: Implement loading from secure configuration
    // const trustedNodes = await loadFromSecureConfig();
    // for (const node of trustedNodes) {
    //   this.nodes.set(node.id, {
    //     ...node,
    //     lastSeen: Date.now(),
    //     contributions: 0
    //   });
    // }
  }
  
  /**
   * Start federated learning coordination
   */
  private startCoordination(): void {
    if (this.isCoordinating) return;
    
    this.isCoordinating = true;
    this.logger.info('Starting federated learning coordination');
    
    // Schedule periodic aggregation rounds
    setInterval(() => this.performAggregationRound(), 30 * 60 * 1000); // Every 30 minutes
    
    // Start node discovery
    this.startNodeDiscovery();
  }
  
  /**
   * Start node discovery process
   */
  private startNodeDiscovery(): void {
    // In production, implement proper peer discovery
    // Could use DHT, broadcast, or registry service
    this.emit('discovery-started');
  }
  
  /**
   * Register a new federated node
   */
  async registerNode(nodeInfo: {
    id: string;
    publicKey: string;
    endpoint?: string;
  }): Promise<boolean> {
    // Verify node identity
    if (!this.verifyNodeIdentity(nodeInfo)) {
      this.logger.warn(`Failed to verify node ${nodeInfo.id}`);
      return false;
    }
    
    // Add to trusted nodes
    this.nodes.set(nodeInfo.id, {
      ...nodeInfo,
      lastSeen: Date.now(),
      trustScore: 0.5, // Start with neutral trust
      contributions: 0
    });
    
    this.logger.info(`Registered new federated node: ${nodeInfo.id}`);
    this.emit('node-registered', nodeInfo.id);
    
    return true;
  }
  
  /**
   * Verify node identity
   */
  private verifyNodeIdentity(nodeInfo: any): boolean {
    // Implement proper identity verification
    // For now, basic validation
    return !!(nodeInfo.id && nodeInfo.publicKey);
  }
  
  /**
   * Submit local model update
   */
  async submitLocalUpdate(
    gradients: Map<string, number[]>,
    sampleCount: number
  ): Promise<void> {
    const update: ModelUpdate = {
      nodeId: 'local',
      timestamp: Date.now(),
      gradients,
      sampleCount,
      signature: this.signUpdate(gradients)
    };
    
    // Add to pending updates
    const roundId = this.getCurrentRoundId();
    if (!this.pendingUpdates.has(roundId)) {
      this.pendingUpdates.set(roundId, []);
    }
    
    this.pendingUpdates.get(roundId)!.push(update);
    
    // Broadcast to other nodes if we have peers
    if (this.nodes.size > 0) {
      await this.broadcastUpdate(update);
    }
  }
  
  /**
   * Receive update from federated node
   */
  async receiveUpdate(update: ModelUpdate): Promise<void> {
    // Verify update signature
    if (!this.verifyUpdateSignature(update)) {
      this.logger.warn(`Invalid signature from node ${update.nodeId}`);
      this.updateTrustScore(update.nodeId, -0.1);
      return;
    }
    
    // Validate update
    if (!this.validateUpdate(update)) {
      this.logger.warn(`Invalid update from node ${update.nodeId}`);
      this.updateTrustScore(update.nodeId, -0.05);
      return;
    }
    
    // Add to pending updates
    const roundId = this.getCurrentRoundId();
    if (!this.pendingUpdates.has(roundId)) {
      this.pendingUpdates.set(roundId, []);
    }
    
    this.pendingUpdates.get(roundId)!.push(update);
    
    // Update node stats
    const node = this.nodes.get(update.nodeId);
    if (node) {
      node.lastSeen = Date.now();
      node.contributions++;
      this.updateTrustScore(update.nodeId, 0.01);
    }
    
    this.emit('update-received', update);
  }
  
  /**
   * Perform aggregation round
   */
  private async performAggregationRound(): Promise<void> {
    const roundId = this.getCurrentRoundId();
    const updates = this.pendingUpdates.get(roundId) || [];
    
    if (updates.length < 2) {
      this.logger.info('Insufficient updates for aggregation');
      return;
    }
    
    this.logger.info(`Starting aggregation round ${this.aggregationRounds}`);
    
    try {
      // Filter updates by trust score
      const trustedUpdates = updates.filter(u => {
        const node = this.nodes.get(u.nodeId);
        return !node || node.trustScore >= 0.3;
      });
      
      // Perform secure aggregation
      const aggregated = await this.secureAggregation(trustedUpdates);
      
      // Apply aggregated update
      await this.applyAggregatedUpdate(aggregated);
      
      // Clean up
      this.pendingUpdates.delete(roundId);
      this.aggregationRounds++;
      
      this.emit('aggregation-completed', aggregated);
      
    } catch (error) {
      this.logger.error('Aggregation failed:', error);
      this.emit('aggregation-failed', error);
    }
  }
  
  /**
   * Perform secure aggregation
   */
  private async secureAggregation(
    updates: ModelUpdate[]
  ): Promise<AggregatedUpdate> {
    const aggregated: Map<string, number[]> = new Map();
    const totalSamples = updates.reduce((sum, u) => sum + u.sampleCount, 0);
    
    // Get all gradient keys
    const gradientKeys = new Set<string>();
    for (const update of updates) {
      for (const key of update.gradients.keys()) {
        gradientKeys.add(key);
      }
    }
    
    // Weighted average aggregation
    for (const key of gradientKeys) {
      const weightedSum: number[] = [];
      let totalWeight = 0;
      
      for (const update of updates) {
        const gradient = update.gradients.get(key);
        if (!gradient) continue;
        
        const weight = update.sampleCount / totalSamples;
        
        if (weightedSum.length === 0) {
          weightedSum.push(...gradient.map(g => g * weight));
        } else {
          for (let i = 0; i < gradient.length; i++) {
            const ws = weightedSum[i];
            const g = gradient[i];
            if (ws !== undefined && g !== undefined) {
              weightedSum[i] = ws + g * weight;
            }
          }
        }
        
        totalWeight += weight;
      }
      
      // Normalize if needed
      if (totalWeight > 0 && totalWeight !== 1) {
        for (let i = 0; i < weightedSum.length; i++) {
          const ws = weightedSum[i];
          if (ws !== undefined) {
            weightedSum[i] = ws / totalWeight;
          }
        }
      }
      
      aggregated.set(key, weightedSum);
    }
    
    // Check for consensus
    const consensusReached = this.checkConsensus(updates);
    
    return {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      participantCount: updates.length,
      totalSamples,
      aggregatedGradients: aggregated,
      consensusReached
    };
  }
  
  /**
   * Check if consensus is reached
   */
  private checkConsensus(updates: ModelUpdate[]): boolean {
    if (updates.length < 3) return false;
    
    // Simple consensus: check if gradients are similar
    // In production, use more sophisticated consensus mechanisms
    const threshold = 0.1;
    
    const firstUpdate = updates[0];
    if (!firstUpdate) return false;
    
    for (const key of firstUpdate.gradients.keys()) {
      const gradients = updates
        .map(u => u.gradients.get(key))
        .filter(g => g !== undefined) as number[][];
      
      if (gradients.length < updates.length * 0.8) {
        return false; // Not enough nodes have this gradient
      }
      
      // Check variance
      const firstGradient = gradients[0];
      if (!firstGradient) return false;
      
      for (let i = 0; i < firstGradient.length; i++) {
        const values = gradients.map(g => g[i]).filter(v => v !== undefined);
        if (values.length === 0) continue;
        
        const mean = values.reduce((a, b) => (a ?? 0) + (b ?? 0), 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow((v ?? 0) - mean, 2), 0) / values.length;
        
        if (Math.sqrt(variance) > threshold) {
          return false; // Too much variance
        }
      }
    }
    
    return true;
  }
  
  /**
   * Apply aggregated update
   */
  private async applyAggregatedUpdate(
    aggregated: AggregatedUpdate
  ): Promise<void> {
    if (!aggregated.consensusReached) {
      this.logger.warn('Applying update without consensus');
    }
    
    // Convert to format expected by model updater
    const modelUpdater = IncrementalModelUpdater.getInstance();
    
    // In production, properly integrate with model updater
    // For now, trigger a regular update
    await modelUpdater.scheduleUpdate(
      aggregated.consensusReached ? 'normal' : 'low'
    );
    
    this.logger.info(`Applied federated update from ${aggregated.participantCount} nodes`);
  }
  
  /**
   * Sign update for authentication
   */
  private signUpdate(gradients: Map<string, number[]>): string {
    const data = JSON.stringify(Array.from(gradients.entries()));
    return crypto
      .createHmac('sha256', this.privateKey)
      .update(data)
      .digest('hex');
  }
  
  /**
   * Verify update signature
   */
  private verifyUpdateSignature(update: ModelUpdate): boolean {
    // In production, use proper signature verification
    return !!update.signature;
  }
  
  /**
   * Validate update content
   */
  private validateUpdate(update: ModelUpdate): boolean {
    // Check for reasonable values
    if (update.sampleCount < 1 || update.sampleCount > 10000) {
      return false;
    }
    
    // Check gradient sizes
    for (const [, gradient] of update.gradients) {
      if (!Array.isArray(gradient) || gradient.length === 0) {
        return false;
      }
      
      // Check for NaN or infinite values
      if (gradient.some(v => !isFinite(v))) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Broadcast update to peers
   */
  private async broadcastUpdate(_update: ModelUpdate): Promise<void> {
    const activeNodes = Array.from(this.nodes.values()).filter(
      node => node.endpoint && Date.now() - node.lastSeen < 60 * 60 * 1000
    );
    
    for (const node of activeNodes) {
      try {
        // In production, implement proper networking
        this.logger.debug(`Would broadcast to ${node.id}`);
      } catch (error) {
        this.logger.warn(`Failed to broadcast to ${node.id}:`, error);
      }
    }
  }
  
  /**
   * Update node trust score
   */
  private updateTrustScore(nodeId: string, delta: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.trustScore = Math.max(0, Math.min(1, node.trustScore + delta));
    }
  }
  
  /**
   * Get current aggregation round ID
   */
  private getCurrentRoundId(): string {
    const hour = Math.floor(Date.now() / (60 * 60 * 1000));
    return `round-${hour}`;
  }
  
  /**
   * Get federation statistics
   */
  getStatistics(): any {
    const activeNodes = Array.from(this.nodes.values()).filter(
      node => Date.now() - node.lastSeen < 60 * 60 * 1000
    ).length;
    
    return {
      totalNodes: this.nodes.size,
      activeNodes,
      aggregationRounds: this.aggregationRounds,
      pendingUpdates: Array.from(this.pendingUpdates.entries()).map(
        ([roundId, updates]) => ({
          roundId,
          updateCount: updates.length,
          totalSamples: updates.reduce((sum, u) => sum + u.sampleCount, 0)
        })
      ),
      nodeStats: Array.from(this.nodes.values()).map(node => ({
        id: node.id,
        trustScore: node.trustScore,
        contributions: node.contributions,
        lastSeen: new Date(node.lastSeen).toISOString()
      }))
    };
  }
  
  /**
   * Stop coordination
   */
  stop(): void {
    this.isCoordinating = false;
    this.logger.info('Stopped federated learning coordination');
  }
}