/**
 * Deliberate local HTTP server
 * Provides event transport, config APIs, session backfill, and chat streaming.
 */

import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createBroadcaster } from './ws-broadcaster.js';
import { loadConfig, patchConfig, addSkipCommand, addCustomBlock, addAutoApprovePattern } from './config.js';
import { handleChatSse } from './chat-handler.js';
import { appendEventLog, cleanupOldEventLogs, readRecentEvents } from './event-log.js';
import { isPidAlive } from './cleanup.js';

const DEFAULT_PORT = 8765;
const DEFAULT_IDLE_EXIT_MS = 15_000;
const DEFAULT_IDLE_CHECK_INTERVAL_MS = 2_500;
const DEFAULT_STARTUP_GRACE_MS = 30_000;

/**
 * Count live pane lock files in ~/.deliberate/panes/.
 *
 * A lock is "live" when its recorded PID is still running. Locks without a PID
 * (legacy) are conservatively counted as live so we never auto-exit on a
 * legitimate session whose pane is alive but pre-dates PID tracking.
 *
 * @returns {number}
 */
function countLivePaneLocks() {
  const dir = path.join(os.homedir(), '.deliberate', 'panes');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return 0;
    return 0;
  }
  let alive = 0;
  for (const name of entries) {
    if (!name.startsWith('pane-started-') || !name.endsWith('.json')) continue;
    let pidRaw;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      pidRaw = data && data.pid;
    } catch {
      // Treat unreadable locks as not-alive to avoid blocking exit on garbage.
      continue;
    }
    const pid = Number.isFinite(pidRaw) ? pidRaw : null;
    // Legacy locks (no pid) count as alive — caller can clear them via
    // `deliberate cleanup` once they confirm no pane is still attached.
    if (pid === null || isPidAlive(pid)) alive += 1;
  }
  return alive;
}

/**
 * Watch the server's idle state and exit gracefully when no panes or WS
 * clients remain. Returns a stop function for use in tests.
 *
 * @param {{
 *   getClientCount: () => number,
 *   idleExitMs: number,
 *   intervalMs?: number,
 *   startupGraceMs?: number,
 *   onExit?: (info: { reason: string }) => void
 * }} options
 * @returns {() => void}
 */
export function startIdleExitWatchdog(options) {
  const {
    getClientCount,
    idleExitMs,
    intervalMs = DEFAULT_IDLE_CHECK_INTERVAL_MS,
    startupGraceMs = DEFAULT_STARTUP_GRACE_MS,
    onExit = ({ reason }) => {
      console.log(`[Server] idle for ${idleExitMs}ms (${reason}), shutting down`);
      process.exit(0);
    }
  } = options;

  if (!Number.isFinite(idleExitMs) || idleExitMs <= 0) {
    // Disabled — escape hatch for "keep server alive forever" deployments.
    return () => {};
  }

  const startedAt = Date.now();
  let idleSince = null;
  const handle = setInterval(() => {
    if (Date.now() - startedAt < startupGraceMs) return;

    const clients = getClientCount();
    const panes = countLivePaneLocks();
    const idle = clients === 0 && panes === 0;

    if (!idle) {
      idleSince = null;
      return;
    }
    if (idleSince === null) {
      idleSince = Date.now();
      return;
    }
    if (Date.now() - idleSince >= idleExitMs) {
      clearInterval(handle);
      onExit({ reason: `clients=${clients} panes=${panes}` });
    }
  }, intervalMs);

  if (handle && typeof handle.unref === 'function') handle.unref();
  return () => clearInterval(handle);
}

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
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  });

  // Status endpoint
  app.get('/status', (req, res) => {
    res.json({
      status: 'ok',
      mode: 'ux-explainability',
      features: ['broadcast', 'session-backfill', 'config', 'chat', 'websocket']
    });
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

  app.post('/api/config/auto-approve', (req, res) => {
    try {
      const { pattern, command } = req.body || {};
      const next = addAutoApprovePattern(pattern || command);
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
 * Start the Deliberate local server
 * @param {number} port - Port to listen on
 * @param {Object} options - Server options
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

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      console.log(`[Server] Deliberate server listening on http://localhost:${port}`);
      console.log('[Server] Endpoints:');
      console.log('  GET  /health           - Health check');
      console.log('  GET  /status           - Server capabilities');
      console.log('  POST /api/broadcast    - Broadcast hook event to WS clients');
      console.log('  GET  /api/session/:id  - Session event history backfill');
      console.log('  GET  /api/config       - GUI config read');
      console.log('  PATCH /api/config      - GUI config patch');
      console.log('  POST /api/config/skip  - Add skip command');
      console.log('  POST /api/config/block - Add custom block pattern');
      console.log('  POST /api/config/auto-approve - Add auto-approve pattern');
      console.log('  POST /api/chat         - Command chat SSE');
      console.log('  WS   /ws               - Real-time event stream');

      // Auto-exit when no panes / WS clients remain. Escape hatch:
      // `server.idleExitMs: 0` in config keeps the server alive forever.
      if (options.idleExit !== false) {
        const cfg = (loadConfig() || {}).server || {};
        const idleExitMs = Number.isFinite(cfg.idleExitMs)
          ? cfg.idleExitMs
          : DEFAULT_IDLE_EXIT_MS;
        startIdleExitWatchdog({
          getClientCount: () =>
            typeof broadcaster.getActiveClientCount === 'function'
              ? broadcaster.getActiveClientCount()
              : 0,
          idleExitMs
        });
      }

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
  startServer(port);
}

export default { startServer, createApp };
