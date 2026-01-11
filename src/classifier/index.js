/**
 * Classifier - Multi-layer security classification for Claude Code
 *
 * Architecture:
 * Layer 1: Pattern Matcher - Deterministic regex, cannot be prompt-injected
 * Layer 2: Model Classifier - ML-based, structured input, harder to bypass
 * Layer 3: LLM Fallback - Called when classifier is uncertain (active learning)
 *
 * Active Learning Flow:
 * 1. Pattern matcher checks first (authoritative if matched)
 * 2. Model classifier runs and returns confidence + coverage score
 * 3. If needsLlmFallback is true, LLM should verify the classification
 * 4. Disagreements between model and LLM are logged for retraining
 *
 * If Layer 1 matches, result is authoritative and final.
 * If Layer 1 doesn't match, Layer 2 provides classification.
 * If Layer 2 is uncertain, needsLlmFallback=true signals Layer 3 should verify.
 */

import { PatternMatcher } from './pattern-matcher.js';
import { ModelClassifier } from './model-classifier.js';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

// Get paths for logging uncertain cases
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UNCERTAIN_LOG_DIR = join(homedir(), '.deliberate', 'active-learning');
const UNCERTAIN_LOG_FILE = join(UNCERTAIN_LOG_DIR, 'uncertain-cases.jsonl');
const PENDING_REVIEW_FILE = join(__dirname, '..', '..', 'training', 'pending-review.jsonl');

// Singleton instances
let patternMatcher = null;
let modelClassifier = null;

// LLM fallback handler (set by calling code)
let llmFallbackHandler = null;

/**
 * Log an uncertain case for active learning
 * Writes to both:
 *   1. ~/.deliberate/active-learning/uncertain-cases.jsonl (runtime log)
 *   2. training/pending-review.jsonl (for admin approval workflow)
 *
 * @param {Object} caseData - The uncertain case data
 */
function logUncertainCase(caseData) {
  const timestamp = new Date().toISOString();

  // Format for pending review (admin approval workflow)
  const pendingEntry = {
    command: caseData.command,
    model_label: caseData.modelRisk,
    suggested_label: caseData.llmRisk || caseData.modelRisk,
    confidence: caseData.modelConfidence,
    coverage: caseData.modelCoverage,
    nearest_command: caseData.nearestCommand,
    source: 'runtime',
    timestamp
  };

  // Format for runtime log (debugging/analysis)
  const runtimeEntry = {
    ...caseData,
    timestamp
  };

  // Write to pending review file (for admin approval)
  try {
    appendFileSync(PENDING_REVIEW_FILE, JSON.stringify(pendingEntry) + '\n');
  } catch (error) {
    // Pending review file may not exist in production - that's ok
  }

  // Write to runtime log
  try {
    if (!existsSync(UNCERTAIN_LOG_DIR)) {
      mkdirSync(UNCERTAIN_LOG_DIR, { recursive: true });
    }
    appendFileSync(UNCERTAIN_LOG_FILE, JSON.stringify(runtimeEntry) + '\n');
  } catch (error) {
    console.warn('[Classifier] Failed to log uncertain case:', error.message);
  }
}

/**
 * Set the LLM fallback handler for uncertain classifications
 * @param {Function} handler - Async function(command, modelResult) => { risk, reason }
 */
export function setLlmFallbackHandler(handler) {
  llmFallbackHandler = handler;
}

/**
 * Initialize the classifier system
 * @param {Object} options - Configuration options
 * @param {boolean} options.preloadModel - Whether to preload the ML model
 * @param {Function} options.llmFallback - Optional LLM fallback handler
 * @returns {Promise<void>}
 */
export async function initialize(options = {}) {
  patternMatcher = new PatternMatcher();
  modelClassifier = new ModelClassifier();

  if (options.llmFallback) {
    llmFallbackHandler = options.llmFallback;
  }

  if (options.preloadModel) {
    await modelClassifier.initialize();
  }
}

/**
 * Classify an input (command, file path, or content)
 * @param {string} input - The input to classify
 * @param {string} type - Type: 'command', 'filepath', 'content', 'edit', 'write'
 * @param {Object} context - Additional context (e.g., file path for content)
 * @returns {Promise<ClassificationResult>}
 *
 * @typedef {Object} ClassificationResult
 * @property {string} risk - 'SAFE', 'MODERATE', or 'DANGEROUS'
 * @property {string} reason - Human-readable explanation
 * @property {string} source - 'pattern', 'model', or 'llm'
 * @property {boolean} canOverride - Whether user can override this decision
 * @property {number} [score] - Confidence score (0-1) for model classifications
 * @property {boolean} [needsLlmFallback] - Whether LLM verification was/is needed
 * @property {number} [coverageScore] - How well training data covers this input
 * @property {Object} [layers] - Results from each layer for debugging
 */
export async function classify(input, type = 'command', context = {}) {
  // Ensure initialized
  if (!patternMatcher) {
    patternMatcher = new PatternMatcher();
  }
  if (!modelClassifier) {
    modelClassifier = new ModelClassifier();
  }

  const layers = {};

  // Layer 1: Pattern Matching (authoritative)
  let patternResult;
  switch (type) {
    case 'command':
      patternResult = patternMatcher.checkCommand(input);
      break;
    case 'filepath':
    case 'write':
      patternResult = patternMatcher.checkFilePath(input);
      break;
    case 'content':
    case 'edit':
      patternResult = patternMatcher.checkContent(input);
      break;
    default:
      patternResult = patternMatcher.checkCommand(input);
  }

  layers.pattern = patternResult;

  // If pattern matched, return immediately (authoritative)
  if (patternResult.matched) {
    return {
      ...patternResult,
      needsLlmFallback: false,
      layers
    };
  }

  // Layer 2: Model Classification
  let modelResult;
  try {
    switch (type) {
      case 'command':
        modelResult = await modelClassifier.classifyCommand(input);
        break;
      case 'content':
      case 'edit':
      case 'write':
        modelResult = await modelClassifier.classifyContent(input, context.filePath);
        break;
      default:
        modelResult = await modelClassifier.classifyCommand(input);
    }
  } catch (error) {
    // Model failed - return safe default with warning
    modelResult = {
      risk: 'MODERATE',
      score: 0.5,
      reason: `Model unavailable: ${error.message}`,
      source: 'model',
      canOverride: true,
      needsLlmFallback: true,
      error: error.message
    };
  }

  layers.model = modelResult;

  // Layer 3: LLM Fallback (if needed and handler is set)
  if (modelResult.needsLlmFallback && llmFallbackHandler && type === 'command') {
    try {
      const llmResult = await llmFallbackHandler(input, modelResult);
      layers.llm = llmResult;

      // Log the case for active learning (whether they agree or not)
      logUncertainCase({
        command: input,
        modelRisk: modelResult.risk,
        modelConfidence: modelResult.score,
        modelCoverage: modelResult.coverageScore,
        nearestCommand: modelResult.nearestCommand,
        nearestLabel: modelResult.nearestLabel,
        llmRisk: llmResult.risk,
        llmReason: llmResult.reason,
        agreed: modelResult.risk === llmResult.risk
      });

      // If LLM disagrees with model, use LLM result (it has more context)
      // But if model was DANGEROUS and LLM says SAFE, be conservative - use MODERATE
      if (llmResult.risk !== modelResult.risk) {
        if (modelResult.risk === 'DANGEROUS' && llmResult.risk === 'SAFE') {
          // Conservative: don't fully trust LLM to override DANGEROUS
          return {
            risk: 'MODERATE',
            score: 0.5,
            reason: `Model flagged as dangerous, LLM disagrees - manual review recommended`,
            source: 'llm-conservative',
            canOverride: true,
            needsLlmFallback: false,
            coverageScore: modelResult.coverageScore,
            layers
          };
        }

        // Use LLM result
        return {
          risk: llmResult.risk,
          score: 0.7,  // LLM results get moderate confidence
          reason: llmResult.reason || `LLM verification: ${llmResult.risk}`,
          source: 'llm',
          canOverride: llmResult.risk !== 'DANGEROUS',
          needsLlmFallback: false,
          coverageScore: modelResult.coverageScore,
          layers
        };
      }

      // LLM agrees with model - boost confidence
      return {
        ...modelResult,
        score: Math.min(0.95, modelResult.score + 0.15),
        reason: `${modelResult.reason} (LLM verified)`,
        source: 'model+llm',
        needsLlmFallback: false,
        layers
      };
    } catch (error) {
      // LLM fallback failed - just use model result
      console.warn('[Classifier] LLM fallback failed:', error.message);
      layers.llmError = error.message;
    }
  }

  return {
    ...modelResult,
    layers
  };
}

/**
 * Quick pattern-only check (no async, no model)
 * Use for fast pre-screening before full classification
 * @param {string} input - The input to check
 * @param {string} type - Type: 'command', 'filepath', 'content'
 * @returns {PatternResult}
 */
export function quickCheck(input, type = 'command') {
  if (!patternMatcher) {
    patternMatcher = new PatternMatcher();
  }

  switch (type) {
    case 'command':
      return patternMatcher.checkCommand(input);
    case 'filepath':
      return patternMatcher.checkFilePath(input);
    case 'content':
      return patternMatcher.checkContent(input);
    default:
      return patternMatcher.checkCommand(input);
  }
}

/**
 * Get classifier status
 * @returns {Object} Status of all classifier layers
 */
export function getStatus() {
  return {
    patternMatcher: {
      ready: !!patternMatcher
    },
    modelClassifier: modelClassifier ? modelClassifier.getStatus() : { ready: false }
  };
}

/**
 * Preload the model (useful for faster first classification)
 * @returns {Promise<void>}
 */
export async function preloadModel() {
  if (!modelClassifier) {
    modelClassifier = new ModelClassifier();
  }
  await modelClassifier.initialize();
}

// Export classes for direct use
export { PatternMatcher } from './pattern-matcher.js';
export { ModelClassifier } from './model-classifier.js';
