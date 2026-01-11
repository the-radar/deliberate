/**
 * Model Classifier - Layer 2 of the classifier
 *
 * Uses TWO different models for different purposes:
 * 1. CmdCaliper (CyCraftAI) - For Bash command classification
 *    - Generates semantic embeddings for commands
 *    - Compares to known malicious command database
 *    - Uses trained RandomForest classifier
 *
 * 2. DeBERTa Prompt Injection (ProtectAI) - For file content only
 *    - Guards against AI-on-AI prompt injection in file contents
 *    - Only used during Write/Edit operations when reading files
 *
 * This layer provides structured, ML-based classification that is harder to bypass
 * than a raw LLM, but can still be evaded with adversarial inputs.
 */

import { pipeline, env } from "@huggingface/transformers";
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir, platform } from 'os';
import { execSync } from 'child_process';

// Configure Transformers.js for local caching
env.cacheDir = process.env.TRANSFORMERS_CACHE || './.cache/transformers';
env.allowLocalModels = true;

// Cross-platform Python command (python3 on Unix, python on Windows)
const PYTHON_CMD = platform() === 'win32' ? 'python' : 'python3';

// Load HuggingFace token from CLI auth or environment and set in env
function loadHFToken() {
  // Try environment variable first
  if (process.env.HF_TOKEN) {
    env.accessToken = process.env.HF_TOKEN;
    return true;
  }
  if (process.env.HUGGING_FACE_HUB_TOKEN) {
    env.accessToken = process.env.HUGGING_FACE_HUB_TOKEN;
    return true;
  }

  // Try CLI token locations
  const tokenPaths = [
    join(homedir(), '.cache', 'huggingface', 'token'),
    join(homedir(), '.huggingface', 'token'),
  ];

  for (const tokenPath of tokenPaths) {
    if (existsSync(tokenPath)) {
      try {
        env.accessToken = readFileSync(tokenPath, 'utf-8').trim();
        return true;
      } catch (e) {
        // Ignore read errors
      }
    }
  }

  return false;
}

const HF_TOKEN_LOADED = loadHFToken();

// Get the directory of this module for loading model data
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MODELS_DIR = join(__dirname, '..', '..', 'models');
const CLASSIFY_SCRIPT = join(__dirname, 'classify_command.py');

/**
 * Escape a string for safe use in shell commands
 * Uses base64 encoding to avoid any shell injection
 * @param {string} str - String to escape
 * @returns {string} - Base64 encoded string
 */
function safeShellArg(str) {
  return Buffer.from(str).toString('base64');
}

// CmdCaliper model sizes available
const CMDCALIPER_MODELS = {
  small: { size: '128 MB', dim: 384 },
  base: { size: '419 MB', dim: 768 },
  large: { size: '1.3 GB', dim: 1024 }
};

// Model configurations
const MODELS = {
  // CmdCaliper model size (small, base, large, or null to disable)
  // Users can configure this based on their needs:
  // - small: fastest, smallest, good accuracy
  // - base: recommended balance of speed and accuracy
  // - large: best accuracy, larger download
  // - null: disable ML classification, use pattern matching only
  commandModel: process.env.DELIBERATE_CMDCALIPER_MODEL || 'base',
  // DeBERTa for prompt injection detection (file content only)
  content: {
    id: "protectai/deberta-v3-base-prompt-injection-v2",
    type: "text-classification",
    dtype: "fp32"
  }
};

// Thresholds for risk classification
const THRESHOLDS = {
  command: {
    // Similarity thresholds for CmdCaliper
    // Note: CmdCaliper embeddings have moderate similarity even for unrelated commands
    // These thresholds are calibrated from testing
    DANGEROUS_SIMILARITY: 0.84,   // Very high similarity - near exact match to dangerous
    MODERATE_SIMILARITY: 0.75,    // High similarity - close to known risky patterns
    // Classifier confidence thresholds (unused for now, for future classifier)
    DANGEROUS_CONFIDENCE: 0.75,
    MODERATE_CONFIDENCE: 0.45
  },
  content: {
    // DeBERTa prompt injection thresholds
    DANGEROUS: 0.85,
    MODERATE: 0.5,
    SAFE: 0.3
  }
};

export class ModelClassifier {
  constructor() {
    // Models
    this.commandEmbedder = null;
    this.contentClassifier = null;

    // Trained data
    this.maliciousDb = null;
    this.classifierWeights = null;
    this.metadata = null;

    // State
    this.commandReady = false;
    this.contentReady = false;
    this.initPromises = {};
  }

  /**
   * Load the malicious command embeddings database and classifier
   * @private
   */
  _loadMaliciousDb() {
    if (this.maliciousDb) return;

    try {
      const dbPath = join(MODELS_DIR, 'malicious_embeddings.json');
      const metaPath = join(MODELS_DIR, 'training_metadata.json');
      const threshPath = join(MODELS_DIR, 'similarity_thresholds.json');

      if (existsSync(dbPath)) {
        this.maliciousDb = JSON.parse(readFileSync(dbPath, 'utf-8'));
        console.log('[ModelClassifier] Loaded malicious embeddings database');
      }

      if (existsSync(metaPath)) {
        this.metadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
        console.log(`[ModelClassifier] Loaded metadata: ${this.metadata.num_examples} training examples`);
      }

      // Note: similarity_thresholds.json contains auto-computed values that are too low
      // We use manually calibrated thresholds in the THRESHOLDS constant instead
      // The file is kept for reference but not loaded
    } catch (error) {
      console.warn('[ModelClassifier] Could not load malicious database:', error.message);
    }
  }

  /**
   * Initialize the command embedding model (CmdCaliper)
   * Uses local Python script with sentence-transformers
   * @returns {Promise<void>}
   */
  async initializeCommandModel() {
    if (this.commandReady) return;
    if (this.initPromises.command) return this.initPromises.command;

    this.initPromises.command = (async () => {
      try {
        const modelSize = MODELS.commandModel || 'base';
        console.log(`[ModelClassifier] Loading CmdCaliper-${modelSize} model for command analysis...`);

        // Verify Python script exists
        if (!existsSync(CLASSIFY_SCRIPT)) {
          throw new Error(`Classification script not found: ${CLASSIFY_SCRIPT}`);
        }

        // Test that the Python script works by classifying a simple command
        const testResult = execSync(
          `${PYTHON_CMD} "${CLASSIFY_SCRIPT}" --base64 "${safeShellArg('echo test')}" --model ${modelSize}`,
          {
            encoding: 'utf-8',
            timeout: 60000  // First run may need to load model
          }
        );

        const parsed = JSON.parse(testResult);
        if (parsed.error) {
          throw new Error(parsed.error);
        }

        console.log(`[ModelClassifier] CmdCaliper-${modelSize} + RandomForest loaded successfully`);
        this.commandReady = true;
      } catch (error) {
        console.error('[ModelClassifier] Failed to load CmdCaliper:', error.message);
        throw error;
      }
    })();

    return this.initPromises.command;
  }

  /**
   * Initialize the content classification model (DeBERTa)
   * @returns {Promise<void>}
   */
  async initializeContentModel() {
    if (this.contentReady) return;
    if (this.initPromises.content) return this.initPromises.content;

    this.initPromises.content = (async () => {
      try {
        console.log('[ModelClassifier] Loading DeBERTa model for content analysis...');

        this.contentClassifier = await pipeline(
          MODELS.content.type,
          MODELS.content.id,
          {
            dtype: MODELS.content.dtype,
            device: "cpu",
            progress_callback: (progress) => {
              if (progress.status === 'downloading') {
                const pct = Math.round((progress.loaded / progress.total) * 100);
                process.stdout.write(`\r[ModelClassifier] Downloading DeBERTa: ${pct}%`);
              }
            }
          }
        );

        console.log('\n[ModelClassifier] DeBERTa model loaded successfully');
        this.contentReady = true;
      } catch (error) {
        console.error('[ModelClassifier] Failed to load DeBERTa:', error.message);
        throw error;
      }
    })();

    return this.initPromises.content;
  }

  /**
   * Compute cosine similarity between two vectors
   * @private
   */
  _cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find most similar commands in the malicious database
   * @private
   */
  _findSimilarMalicious(embedding) {
    if (!this.maliciousDb) return null;

    let maxSimilarity = 0;
    let mostSimilarCommand = null;
    let matchedCategory = null;
    let matchedLabel = null;

    for (const label of ['DANGEROUS', 'MODERATE']) {
      const db = this.maliciousDb[label];
      if (!db || !db.embeddings) continue;

      for (let i = 0; i < db.embeddings.length; i++) {
        const similarity = this._cosineSimilarity(embedding, db.embeddings[i]);
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          mostSimilarCommand = db.commands[i];
          matchedCategory = db.categories[i];
          matchedLabel = label;
        }
      }
    }

    return {
      similarity: maxSimilarity,
      command: mostSimilarCommand,
      category: matchedCategory,
      label: matchedLabel
    };
  }

  /**
   * Mean pooling for embeddings
   * @private
   */
  _meanPooling(output) {
    // output.data is a Float32Array, output.dims tells us the shape
    const [batchSize, seqLen, hiddenSize] = output.dims;
    const result = new Float32Array(hiddenSize);

    // Average across sequence length
    for (let i = 0; i < seqLen; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        result[j] += output.data[i * hiddenSize + j];
      }
    }

    for (let j = 0; j < hiddenSize; j++) {
      result[j] /= seqLen;
    }

    return Array.from(result);
  }

  /**
   * Classify a command using the Python CmdCaliper + RandomForest script
   * @private
   * @param {string} command - The command to classify
   * @returns {Object} - Classification result from Python
   */
  _classifyWithPython(command) {
    const b64Command = safeShellArg(command);

    // Validate model size to prevent injection
    const validModels = ['small', 'base', 'large'];
    const modelSize = validModels.includes(MODELS.commandModel)
      ? MODELS.commandModel
      : 'base';

    const result = execSync(
      `${PYTHON_CMD} "${CLASSIFY_SCRIPT}" --base64 "${b64Command}" --model ${modelSize}`,
      {
        encoding: 'utf-8',
        timeout: 30000,  // 30 second timeout (first run loads model)
        maxBuffer: 1024 * 1024  // 1MB buffer
      }
    );

    const parsed = JSON.parse(result);
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed;
  }

  /**
   * Classify a Bash command using CmdCaliper embeddings + RandomForest
   *
   * Active Learning: Returns needsLlmFallback when classifier is uncertain.
   * The caller should use LLM verification when this flag is true.
   *
   * @param {string} command - The command to classify
   * @returns {Promise<ClassificationResult>}
   *
   * @typedef {Object} ClassificationResult
   * @property {string} risk - 'SAFE', 'MODERATE', or 'DANGEROUS'
   * @property {number} score - Confidence score (0-1)
   * @property {string} reason - Human-readable explanation
   * @property {string} source - Classification source
   * @property {boolean} canOverride - Whether user can override
   * @property {boolean} needsLlmFallback - Whether LLM should verify this
   * @property {number} coverageScore - How well training data covers this command
   * @property {string} nearestCommand - Most similar training command
   * @property {string} nearestLabel - Label of nearest training command
   */
  async classifyCommand(command) {
    // Check if ML classification is disabled
    if (!MODELS.commandModel) {
      return {
        risk: 'SAFE',
        score: 0.5,
        reason: 'ML classification disabled - use pattern matching',
        source: 'disabled',
        canOverride: true,
        needsLlmFallback: true
      };
    }

    if (!this.commandReady) {
      await this.initializeCommandModel();
    }

    try {
      // Classify using Python (CmdCaliper + RandomForest)
      const result = this._classifyWithPython(command);

      return {
        risk: result.risk,
        score: result.confidence,
        reason: result.reason,
        source: `model:cmdcaliper-${result.model_size}`,
        canOverride: result.risk !== 'DANGEROUS',
        probabilities: result.probabilities,
        // Active learning fields
        needsLlmFallback: result.needs_llm_fallback || false,
        coverageScore: result.coverage_score,
        nearestCommand: result.nearest_command,
        nearestLabel: result.nearest_label,
        maxSimilarity: result.max_similarity
      };
    } catch (error) {
      console.error('[ModelClassifier] Command classification error:', error.message);
      return {
        risk: 'MODERATE',
        score: 0.5,
        reason: 'Classification error - defaulting to moderate risk',
        source: 'model:cmdcaliper',
        canOverride: true,
        needsLlmFallback: true,  // Always fallback on error
        error: error.message
      };
    }
  }

  /**
   * Classify file content for prompt injection attacks
   * Uses DeBERTa model specifically designed for AI-on-AI attacks
   * @param {string} content - The file content to check
   * @param {string} filePath - The file path for context
   * @returns {Promise<{ risk: string, score: number, reason: string, source: string }>}
   */
  async classifyContent(content, filePath = '') {
    if (!this.contentReady) {
      await this.initializeContentModel();
    }

    try {
      // Truncate very long content
      const truncated = content.length > 2000
        ? content.slice(0, 2000) + '... [truncated]'
        : content;

      const input = filePath
        ? `File "${filePath}" content: ${truncated}`
        : `File content: ${truncated}`;

      const results = await this.contentClassifier(input);
      const result = results[0];
      const isInjection = result.label === "INJECTION";
      const score = isInjection ? result.score : 1 - result.score;

      let risk, reason;
      if (score >= THRESHOLDS.content.DANGEROUS) {
        risk = 'DANGEROUS';
        reason = `File content appears to contain AI prompt injection (${(score * 100).toFixed(1)}%)`;
      } else if (score >= THRESHOLDS.content.MODERATE) {
        risk = 'MODERATE';
        reason = `File content may contain suspicious injection patterns (${(score * 100).toFixed(1)}%)`;
      } else {
        risk = 'SAFE';
        reason = `File content appears safe from injection attacks (${(score * 100).toFixed(1)}% confidence)`;
      }

      return {
        risk,
        score,
        reason,
        source: 'model:deberta',
        canOverride: risk !== 'DANGEROUS'
      };
    } catch (error) {
      console.error('[ModelClassifier] Content classification error:', error.message);
      return {
        risk: 'MODERATE',
        score: 0.5,
        reason: 'Classification error - defaulting to moderate risk',
        source: 'model:deberta',
        canOverride: true,
        error: error.message
      };
    }
  }

  /**
   * Check if models are ready
   * @returns {{ command: boolean, content: boolean }}
   */
  isReady() {
    return {
      command: this.commandReady,
      content: this.contentReady
    };
  }

  /**
   * Get model status for health checks
   * @returns {Object}
   */
  getStatus() {
    const modelSize = MODELS.commandModel || 'disabled';
    const modelInfo = CMDCALIPER_MODELS[modelSize] || { size: 'N/A', dim: 0 };

    return {
      command: {
        ready: this.commandReady,
        model: modelSize !== 'disabled' ? `CyCraftAI/CmdCaliper-${modelSize}` : 'disabled',
        modelSize: modelSize,
        embeddingDim: modelInfo.dim,
        downloadSize: modelInfo.size,
        classifier: 'RandomForest',
        purpose: 'Bash command classification using ML embeddings'
      },
      content: {
        ready: this.contentReady,
        model: MODELS.content.id,
        purpose: 'AI prompt injection detection in file content'
      },
      availableModels: CMDCALIPER_MODELS,
      configEnvVar: 'DELIBERATE_CMDCALIPER_MODEL'
    };
  }
}

export default ModelClassifier;
