import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { AnalysisOrchestrator, AnalysisContext } from '../../../src/llm/analysis-orchestrator';
import { ModelManager } from '../../../src/llm/model-manager';
import { SensitiveDataRedactor } from '../../../src/core/redaction/redactor';
import { CommandClassifier } from '../../../src/core/classification/classifier';

jest.mock('../../../src/llm/model-manager');
jest.mock('../../../src/core/redaction/redactor');
jest.mock('../../../src/core/classification/classifier');

describe('AnalysisOrchestrator', () => {
  let orchestrator: AnalysisOrchestrator;
  let mockModelManager: jest.Mocked<ModelManager>;
  let mockRedactor: jest.Mocked<SensitiveDataRedactor>;
  let mockClassifier: jest.Mocked<CommandClassifier>;
  
  beforeEach(() => {
    orchestrator = new AnalysisOrchestrator();
    
    // Get mocked instances
    mockModelManager = (orchestrator as any).modelManager;
    mockRedactor = (orchestrator as any).redactor;
    mockClassifier = (orchestrator as any).classifier;
    
    // Setup default mock behaviors
    mockModelManager.isInitialized.mockReturnValue(true);
    mockRedactor.redact.mockResolvedValue({
      redacted: 'rm -rf <REDACTED>',
      replacements: []
    });
    mockRedactor.restore.mockImplementation(async (text) => text);
  });
  
  describe('analyze', () => {
    const context: AnalysisContext = {
      cwd: '/home/user',
      user: 'testuser',
      platform: 'linux',
      isSudo: false
    };
    
    test('should perform multi-model analysis', async () => {
      // Mock model responses
      mockModelManager.inference
        .mockResolvedValueOnce('Analysis 1: This command is dangerous')
        .mockResolvedValueOnce('Analysis 2: High risk of data loss')
        .mockResolvedValueOnce('BLOCK\nExplanation: Extremely dangerous\n- Risk 1\n- Risk 2');
      
      mockClassifier.classifyCommand.mockResolvedValue({
        command: 'rm',
        level: 'DANGEROUS',
        confidence: 0.9,
        reasons: ['Destructive command']
      });
      
      const result = await orchestrator.analyze('rm', ['-rf', '/'], context);
      
      // Should call all three models
      expect(mockModelManager.inference).toHaveBeenCalledTimes(3);
      expect(mockModelManager.inference).toHaveBeenCalledWith('qwen2', expect.any(String));
      expect(mockModelManager.inference).toHaveBeenCalledWith('smollm2', expect.any(String));
      expect(mockModelManager.inference).toHaveBeenCalledWith('deepseek', expect.any(String));
      
      expect(result.verdict).toBe('BLOCK');
      expect(result.risks).toContain('Risk 1');
      expect(result.risks).toContain('Risk 2');
      expect(result.confidence).toBe(0.85);
    });
    
    test('should handle sensitive data redaction', async () => {
      const apiKey = 'sk-1234567890abcdef';
      mockRedactor.redact.mockResolvedValue({
        redacted: 'curl -H "Authorization: <API_KEY_REDACTED>"',
        replacements: [{ original: apiKey, redacted: '<API_KEY_REDACTED>' }]
      });
      
      mockModelManager.inference.mockResolvedValue('WARN\nExplanation: API key exposure risk');
      mockClassifier.classifyCommand.mockResolvedValue({
        command: 'curl',
        level: 'MODERATE',
        confidence: 0.7
      });
      
      await orchestrator.analyze('curl', ['-H', `"Authorization: ${apiKey}"`], context);
      
      // Should redact before sending to models
      expect(mockRedactor.redact).toHaveBeenCalledWith(
        expect.stringContaining(apiKey)
      );
      
      // Should send redacted version to models
      expect(mockModelManager.inference).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('<API_KEY_REDACTED>')
      );
    });
    
    test('should initialize models if not initialized', async () => {
      mockModelManager.isInitialized.mockReturnValue(false);
      mockModelManager.initialize.mockResolvedValue(undefined);
      mockModelManager.inference.mockResolvedValue('ALLOW');
      
      await orchestrator.analyze('ls', [], context);
      
      expect(mockModelManager.initialize).toHaveBeenCalled();
    });
    
    test('should fallback to pattern analysis on AI failure', async () => {
      // Make all AI calls fail
      mockModelManager.inference.mockRejectedValue(new Error('Model error'));
      
      mockClassifier.classifyCommand.mockResolvedValue({
        command: 'rm',
        level: 'DANGEROUS',
        confidence: 0.9,
        reasons: ['Destructive command', 'System path']
      });
      
      const result = await orchestrator.analyze('rm', ['-rf', '/'], context);
      
      expect(result.verdict).toBe('BLOCK');
      expect(result.explanation).toContain('dangerous patterns');
      expect(result.risks).toContain('Destructive command');
      expect(result.confidence).toBe(0.6); // Lower confidence for fallback
    });
  });
  
  describe('parseDecision', () => {
    test('should parse structured AI response', async () => {
      const aiResponse = `
Overall risk level: WARN

Key risks:
- May download malicious content
- Exposes system information
• Could overwrite existing files

Explanation: This curl command downloads content from an untrusted source

Alternative: Use wget with --no-clobber flag instead
`;
      
      mockModelManager.inference.mockResolvedValue(aiResponse);
      mockClassifier.classifyCommand.mockResolvedValue({
        command: 'curl',
        level: 'MODERATE',
        confidence: 0.7
      });
      
      const result = await orchestrator.analyze('curl', ['http://example.com'], {
        cwd: '/',
        user: 'test',
        platform: 'linux',
        isSudo: false
      });
      
      expect(result.verdict).toBe('WARN');
      expect(result.explanation).toContain('downloads content from an untrusted source');
      expect(result.risks).toHaveLength(3);
      expect(result.alternatives).toContain('Use wget with --no-clobber flag instead');
    });
  });
  
  describe('explainRisks', () => {
    test('should generate risk explanation', async () => {
      const risks = [
        'Deletes files permanently',
        'Operates recursively',
        'Targets system directory'
      ];
      
      mockModelManager.inference.mockResolvedValue(
        'This command will permanently delete all files in the system root directory. ' +
        'The most critical risk is complete data loss. To mitigate, always verify the ' +
        'target path and consider using trash instead of rm.'
      );
      
      const explanation = await orchestrator.explainRisks('rm -rf /', risks);
      
      expect(explanation).toContain('permanently delete');
      expect(explanation).toContain('critical risk');
      expect(explanation).toContain('mitigate');
    });
    
    test('should fallback to risk list on AI failure', async () => {
      const risks = ['Risk 1', 'Risk 2'];
      mockModelManager.inference.mockRejectedValue(new Error('Model error'));
      
      const explanation = await orchestrator.explainRisks('command', risks);
      
      expect(explanation).toBe('Risk 1. Risk 2');
    });
  });
  
  describe('shutdown', () => {
    test('should shutdown model manager', async () => {
      mockModelManager.shutdown.mockResolvedValue(undefined);
      
      await orchestrator.shutdown();
      
      expect(mockModelManager.shutdown).toHaveBeenCalled();
    });
  });
});