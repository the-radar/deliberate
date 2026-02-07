/**
 * Classifier HTTP Server
 * Provides a REST API for the multi-layer classifier.
 * Hooks call this server instead of running classification inline.
 */

import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { classify, quickCheck, getStatus, preloadModel } from './classifier/index.js';
import { createBroadcaster } from './ws-broadcaster.js';
import { loadConfig, patchConfig, addSkipCommand, addCustomBlock } from './config.js';
import { handleChatSse } from './chat-handler.js';
import { appendEventLog, cleanupOldEventLogs, readRecentEvents } from './event-log.js';

const DEFAULT_PORT = 8765;

function sanitizeConfigForUi(config) {
  const llm = config.llm || {};
  return {
    ...config,
    llm: {
      ...llm,
      apiKey: llm.apiKey ? '[REDACTED]' : null,
      hasApiKey: !!llm.apiKey
    }
  };
}

/**
 * Create and configure the Express app
 * @returns {express.Application}
 */
function createApp(broadcaster = createBroadcaster()) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  function loadHookCommandHistory(sessionId) {
    // Hook history is already stored on disk by deliberate-commands.py and is
    // bounded. This lets the GUI show a backlog even if the server started
    // after the session began.
    //
    // NOTE: Commands may include sensitive values. This endpoint is local-only
    // (localhost) and intended for the same user session that created the data.
    try {
      const historyPath = path.join(os.homedir(), '.claude', `deliberate_cmd_history_${sessionId}.json`);
      if (!fs.existsSync(historyPath)) {
        return [];
      }
      const raw = fs.readFileSync(historyPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const commands = Array.isArray(parsed?.commands) ? parsed.commands : [];
      return commands
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
          type: 'command_analyzed',
          timestamp: typeof c.timestamp === 'string' ? c.timestamp : new Date().toISOString(),
          sessionId,
          data: {
            command: typeof c.command === 'string' ? c.command : '',
            risk: typeof c.risk === 'string' ? c.risk : 'MODERATE',
            explanation: typeof c.explanation === 'string' ? c.explanation : '',
            consequences: null,
            workflowPatterns: [],
            backupPath: null,
            permissionDecision: 'allow'
          }
        }))
        .filter((e) => e.data.command);
    } catch {
      return [];
    }
  }

  function loadEventLogHistory(sessionId) {
    // The JSONL log is the most reliable backfill source because it is written
    // by hooks directly (fail-open) and includes non-command events like file
    // changes and PostToolUse command summaries.
    try {
      const events = readRecentEvents({ days: 7, maxEventsPerFile: 5000 });
      return events
        .filter((e) => e && typeof e === 'object')
        .filter((e) => String(e.sessionId || '') === String(sessionId))
        .slice(-5000);
    } catch {
      return [];
    }
  }

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

  // Internal broadcast endpoint for hooks.
  app.post('/api/broadcast', (req, res) => {
    try {
      const event = broadcaster.broadcast(req.body);
      try {
        const alreadyLogged = String(req.headers['x-deliberate-event-logged'] || '').toLowerCase();
        if (alreadyLogged !== '1' && alreadyLogged !== 'true') {
          appendEventLog(event);
          cleanupOldEventLogs();
        }
      } catch {
        // Never fail the broadcast endpoint if disk logging breaks.
      }
      res.json({ status: 'ok', eventType: event.type, sessionId: event.sessionId });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Session backfill endpoint for GUI reconnects.
  app.get('/api/session/:id', (req, res) => {
    const sessionId = req.params.id;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing required path param: id' });
    }

    const live = broadcaster.getSessionEvents(sessionId);
    const fromHooks = loadHookCommandHistory(sessionId);
    const fromLog = loadEventLogHistory(sessionId);

    // Merge and dedupe best-effort by timestamp+command.
    const seen = new Set();
    const events = [];
    for (const ev of [...fromHooks, ...fromLog, ...live]) {
      const key = `${ev.type}:${ev.timestamp}:${ev.data?.command || ''}:${ev.data?.relativePath || ev.data?.filePath || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(ev);
    }
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    res.json({
      sessionId,
      count: events.length,
      events
    });
  });

  // GUI configuration endpoints.
  app.get('/api/config', (req, res) => {
    const config = loadConfig();
    res.json(sanitizeConfigForUi(config));
  });

  app.patch('/api/config', (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Missing required JSON body' });
      }
      const next = patchConfig(req.body);
      res.json(sanitizeConfigForUi(next));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/config/skip', (req, res) => {
    try {
      const { command } = req.body || {};
      const next = addSkipCommand(command);
      res.json(sanitizeConfigForUi(next));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/config/block', (req, res) => {
    try {
      const { pattern, command } = req.body || {};
      const next = addCustomBlock(pattern || command);
      res.json(sanitizeConfigForUi(next));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Chat endpoint, streams SSE to the GUI.
  app.post('/api/chat', async (req, res) => {
    try {
      await handleChatSse(req, res);
    } catch (error) {
      console.error('[Server] Chat handler error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
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
  const broadcaster = options.broadcaster || createBroadcaster();
  const app = createApp(broadcaster);
  const server = http.createServer(app);

  // Attach websocket upgrade path for GUI clients.
  server.on('upgrade', (request, socket, head) => {
    if (!request.url || !request.url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    broadcaster.handleUpgrade(request, socket, head);
  });

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
    server.listen(port, () => {
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
      console.log('  POST /api/broadcast    - Broadcast hook event to WS clients');
      console.log('  GET  /api/session/:id  - Session event history backfill');
      console.log('  GET  /api/config       - GUI config read');
      console.log('  PATCH /api/config      - GUI config patch');
      console.log('  POST /api/config/skip  - Add skip command');
      console.log('  POST /api/config/block - Add custom block pattern');
      console.log('  POST /api/chat         - Command chat SSE');
      console.log('  WS   /ws               - Real-time event stream');
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
