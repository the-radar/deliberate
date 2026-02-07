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
import { execSync, spawn } from 'child_process';
import crypto from 'crypto';
import { PatternMatcher } from './pattern-matcher.js';

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
const WORKER_SCRIPT = join(__dirname, 'cmdcaliper_worker.py');

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

    // Long-lived Python worker for command classification.
    // This is critical for performance, spawning Python per command is too slow.
    this.pythonWorker = null;
    this.pythonWorkerBuffer = '';
    this.pythonWorkerPending = new Map(); // id -> { resolve, reject, timeout }

    // Reuse a single pattern matcher to short-circuit obvious cases.
    this.patternMatcher = new PatternMatcher();
  }

  /**
   * Shutdown background resources (mainly the Python CmdCaliper worker).
   * This is used by tests and long-running processes for clean teardown.
   */
  async close() {
    if (this.pythonWorker && this.pythonWorker.exitCode === null) {
      try {
        this.pythonWorker.kill();
      } catch {
        // Ignore shutdown errors.
      }
    }
    this.pythonWorker = null;
    this.pythonWorkerBuffer = '';

    for (const [id, pending] of this.pythonWorkerPending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('CmdCaliper worker closed'));
      this.pythonWorkerPending.delete(id);
    }
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
        if (!existsSync(WORKER_SCRIPT)) {
          throw new Error(`CmdCaliper worker script not found: ${WORKER_SCRIPT}`);
        }

        await this._ensurePythonWorker(modelSize);
        await this._classifyWithPythonWorker('echo test');

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
            // Keep the runtime single-threaded for stability.
            // This mitigates sporadic teardown crashes in some environments.
            session_options: {
              intraOpNumThreads: 1,
              interOpNumThreads: 1
            },
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
   * Start (or reuse) the long-lived CmdCaliper worker process.
   * @private
   * @param {string} modelSize
   */
  async _ensurePythonWorker(modelSize) {
    if (this.pythonWorker && this.pythonWorker.exitCode === null) {
      return;
    }

    const child = spawn(PYTHON_CMD, [WORKER_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONWARNINGS: process.env.PYTHONWARNINGS || 'ignore',
        // Avoid per-project cache writes that can fail under restrictive environments.
        PYTHONPYCACHEPREFIX: process.env.PYTHONPYCACHEPREFIX || '/tmp'
      }
    });

    this.pythonWorker = child;
    this.pythonWorkerBuffer = '';

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => this._onPythonWorkerStdout(chunk));
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', () => {
      // Intentionally ignore stderr to avoid leaking sensitive command content.
      // Failures are returned through the JSON protocol.
    });

    child.on('exit', () => {
      for (const [id, pending] of this.pythonWorkerPending.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('CmdCaliper worker exited'));
        this.pythonWorkerPending.delete(id);
      }
    });

    // Wait for init handshake.
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CmdCaliper worker init timeout')), 60000);
      this.pythonWorkerPending.set('init', {
        resolve: () => {
          clearTimeout(timeout);
          this.pythonWorkerPending.delete('init');
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          this.pythonWorkerPending.delete('init');
          reject(err);
        },
        timeout
      });
    });

    // Prime with a trivial request so model is loaded.
    await this._classifyWithPythonWorker('echo test', modelSize);
  }

  /**
   * Handle stdout JSONL from the Python worker.
   * @private
   * @param {string} chunk
   */
  _onPythonWorkerStdout(chunk) {
    this.pythonWorkerBuffer += chunk;
    const lines = this.pythonWorkerBuffer.split('\n');
    this.pythonWorkerBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      const id = msg?.id;
      if (!id) continue;
      const pending = this.pythonWorkerPending.get(id);
      if (!pending) continue;

      clearTimeout(pending.timeout);
      this.pythonWorkerPending.delete(id);

      if (msg.ok) {
        pending.resolve(msg.result);
      } else {
        pending.reject(new Error(msg.error || 'CmdCaliper worker error'));
      }
    }
  }

  /**
   * Classify a command using the long-lived Python worker.
   * @private
   * @param {string} command
   * @param {string} [modelSize]
   * @returns {Promise<any>}
   */
  _classifyWithPythonWorker(command, modelSize) {
    if (!this.pythonWorker || this.pythonWorker.exitCode !== null) {
      throw new Error('CmdCaliper worker not running');
    }

    // Validate model size to prevent injection
    const validModels = ['small', 'base', 'large'];
    const resolvedModelSize = validModels.includes(modelSize || MODELS.commandModel)
      ? (modelSize || MODELS.commandModel)
      : 'base';

    const id = crypto.randomBytes(16).toString('hex');
    const payload = {
      id,
      command_b64: safeShellArg(command),
      model: resolvedModelSize
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pythonWorkerPending.delete(id);
        reject(new Error('CmdCaliper worker request timeout'));
      }, 30000);

      this.pythonWorkerPending.set(id, { resolve, reject, timeout });
      this.pythonWorker.stdin.write(`${JSON.stringify(payload)}\n`);
    });
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
    // Pattern matcher is authoritative for known cases, and avoids expensive ML.
    const pattern = this.patternMatcher.checkCommand(command);
    if (pattern.matched) {
      return {
        risk: pattern.risk,
        score: pattern.risk === 'SAFE' ? 0.99 : 1.0,
        reason: pattern.reason,
        source: 'pattern',
        canOverride: pattern.canOverride ?? false,
        needsLlmFallback: false
      };
    }

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
      // Classify using Python worker (CmdCaliper + classifier head)
      const result = await this._classifyWithPythonWorker(command);

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
