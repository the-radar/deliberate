/**
 * Classifier HTTP Server
 * Provides a REST API for the multi-layer classifier.
 * Hooks call this server instead of running classification inline.
 */

import express from 'express';
import { classify, quickCheck, getStatus, preloadModel } from './classifier/index.js';

const DEFAULT_PORT = 8765;

/**
 * Create and configure the Express app
 * @returns {express.Application}
 */
function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health check
  app.get('/health', (req, res) => {
    const status = getStatus();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      classifier: status
    });
  });

  // Status endpoint
  app.get('/status', (req, res) => {
    res.json(getStatus());
  });

  // Quick pattern-only check (synchronous, fast)
  app.post('/quick', (req, res) => {
    try {
      const { input, type = 'command' } = req.body;

      if (!input) {
        return res.status(400).json({ error: 'Missing required field: input' });
      }

      const result = quickCheck(input, type);
      res.json(result);
    } catch (error) {
      console.error('[Server] Quick check error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Full classification (async, uses model)
  app.post('/classify', async (req, res) => {
    try {
      const { input, type = 'command', context = {} } = req.body;

      if (!input) {
        return res.status(400).json({ error: 'Missing required field: input' });
      }

      const result = await classify(input, type, context);
      res.json(result);
    } catch (error) {
      console.error('[Server] Classification error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Classify a bash command
  app.post('/classify/command', async (req, res) => {
    try {
      const { command } = req.body;

      if (!command) {
        return res.status(400).json({ error: 'Missing required field: command' });
      }

      const result = await classify(command, 'command');
      res.json(result);
    } catch (error) {
      console.error('[Server] Command classification error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Classify a file write
  app.post('/classify/write', async (req, res) => {
    try {
      const { filePath, content } = req.body;

      if (!filePath) {
        return res.status(400).json({ error: 'Missing required field: filePath' });
      }

      // Check file path first
      const pathResult = await classify(filePath, 'filepath');
      if (pathResult.risk === 'DANGEROUS') {
        return res.json(pathResult);
      }

      // If content provided, check it too
      if (content) {
        const contentResult = await classify(content, 'content', { filePath });

        // Return the higher risk level
        if (contentResult.risk === 'DANGEROUS' ||
            (contentResult.risk === 'MODERATE' && pathResult.risk === 'SAFE')) {
          return res.json({
            ...contentResult,
            pathCheck: pathResult
          });
        }
      }

      res.json(pathResult);
    } catch (error) {
      console.error('[Server] Write classification error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Classify an edit
  app.post('/classify/edit', async (req, res) => {
    try {
      const { filePath, oldString, newString } = req.body;

      if (!filePath) {
        return res.status(400).json({ error: 'Missing required field: filePath' });
      }

      // Check file path
      const pathResult = await classify(filePath, 'filepath');
      if (pathResult.risk === 'DANGEROUS') {
        return res.json(pathResult);
      }

      // Check the new content being added
      if (newString) {
        const contentResult = await classify(newString, 'content', { filePath });

        if (contentResult.risk === 'DANGEROUS' ||
            (contentResult.risk === 'MODERATE' && pathResult.risk === 'SAFE')) {
          return res.json({
            ...contentResult,
            pathCheck: pathResult,
            editContext: {
              removing: oldString?.length || 0,
              adding: newString?.length || 0
            }
          });
        }
      }

      res.json({
        ...pathResult,
        editContext: {
          removing: oldString?.length || 0,
          adding: newString?.length || 0
        }
      });
    } catch (error) {
      console.error('[Server] Edit classification error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Preload model endpoint
  app.post('/preload', async (req, res) => {
    try {
      console.log('[Server] Preloading model...');
      await preloadModel();
      res.json({ status: 'ok', message: 'Model preloaded successfully' });
    } catch (error) {
      console.error('[Server] Preload error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('[Server] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

/**
 * Start the classifier server
 * @param {number} port - Port to listen on
 * @param {Object} options - Server options
 * @param {boolean} options.preloadModel - Preload ML model on startup
 * @returns {Promise<http.Server>}
 */
export async function startServer(port = DEFAULT_PORT, options = {}) {
  const app = createApp();

  // Optionally preload model for faster first request
  if (options.preloadModel) {
    console.log('[Server] Preloading ML model...');
    try {
      await preloadModel();
      console.log('[Server] Model preloaded successfully');
    } catch (error) {
      console.warn('[Server] Model preload failed (will load on first request):', error.message);
    }
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`[Server] Deliberate classifier listening on http://localhost:${port}`);
      console.log('[Server] Endpoints:');
      console.log('  GET  /health           - Health check');
      console.log('  GET  /status           - Classifier status');
      console.log('  POST /quick            - Quick pattern check');
      console.log('  POST /classify         - Full classification');
      console.log('  POST /classify/command - Classify bash command');
      console.log('  POST /classify/write   - Classify file write');
      console.log('  POST /classify/edit    - Classify file edit');
      console.log('  POST /preload          - Preload ML model');
      resolve(server);
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${port} is already in use`);
      }
      reject(error);
    });
  });
}

// Allow running directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const port = parseInt(process.env.PORT || DEFAULT_PORT);
  startServer(port, { preloadModel: process.env.PRELOAD_MODEL === 'true' });
}

export default { startServer, createApp };
