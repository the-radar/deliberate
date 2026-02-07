/**
 * WebSocket broadcaster for Deliberate v2 event streaming.
 *
 * Design goals:
 * - Keep a bounded in-memory event history per session for GUI backfill.
 * - Broadcast valid events to all connected clients in real time.
 * - Never throw to callers for normal client disconnect churn.
 */

import { createRequire } from 'module';

const DEFAULT_MAX_EVENTS_PER_SESSION = 200;
const DEFAULT_MAX_SESSIONS = 200;

const require = createRequire(import.meta.url);

let WebSocketServerCtor = null;
try {
  ({ WebSocketServer: WebSocketServerCtor } = require('ws'));
} catch {
  // Dependency may not be present until install step. Keep server functional.
}

/**
 * @typedef {Object} BroadcastEvent
 * @property {string} type
 * @property {string} timestamp
 * @property {string} sessionId
 * @property {Object} data
 */

/**
 * Validate and normalize event payloads before storing/broadcasting.
 * This avoids malformed objects entering shared state.
 *
 * @param {unknown} rawEvent
 * @returns {BroadcastEvent}
 */
function normalizeEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    throw new Error('Event payload must be an object');
  }

  const event = /** @type {Record<string, unknown>} */ (rawEvent);
  const { type, timestamp, sessionId, data } = event;

  if (typeof type !== 'string' || !type.trim()) {
    throw new Error('Event field "type" must be a non-empty string');
  }

  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    throw new Error('Event field "sessionId" must be a non-empty string');
  }

  if (typeof timestamp !== 'string' || !timestamp.trim() || Number.isNaN(Date.parse(timestamp))) {
    throw new Error('Event field "timestamp" must be a valid ISO date string');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Event field "data" must be an object');
  }

  return {
    type: type.trim(),
    timestamp,
    sessionId: sessionId.trim(),
    data: /** @type {Object} */ (data)
  };
}

/**
 * Create a broadcaster instance with WS upgrade handling and session history.
 *
 * @param {Object} [options]
 * @param {number} [options.maxEventsPerSession]
 * @param {number} [options.maxSessions]
 */
export function createBroadcaster(options = {}) {
  const maxEventsPerSession = options.maxEventsPerSession || DEFAULT_MAX_EVENTS_PER_SESSION;
  const maxSessions = options.maxSessions || DEFAULT_MAX_SESSIONS;
  const wss = WebSocketServerCtor ? new WebSocketServerCtor({ noServer: true }) : null;

  /** @type {Map<string, BroadcastEvent[]>} */
  const sessionHistory = new Map();

  /**
   * Keep session map bounded by removing oldest inserted session buckets.
   */
  function pruneSessionBuckets() {
    while (sessionHistory.size > maxSessions) {
      const oldestSessionId = sessionHistory.keys().next().value;
      if (!oldestSessionId) {
        break;
      }
      sessionHistory.delete(oldestSessionId);
    }
  }

  /**
   * Append event to bounded session history.
   *
   * @param {BroadcastEvent} event
   */
  function addToHistory(event) {
    const events = sessionHistory.get(event.sessionId) || [];
    events.push(event);

    if (events.length > maxEventsPerSession) {
      events.splice(0, events.length - maxEventsPerSession);
    }

    sessionHistory.set(event.sessionId, events);
    pruneSessionBuckets();
  }

  return {
    /**
     * Handle HTTP upgrade for /ws path.
     *
     * @param {import('http').IncomingMessage} request
     * @param {import('stream').Duplex} socket
     * @param {Buffer} head
     */
    handleUpgrade(request, socket, head) {
      if (!wss) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    },

    /**
     * Broadcast an event to all clients and store in session history.
     *
     * @param {unknown} rawEvent
     * @returns {BroadcastEvent}
     */
    broadcast(rawEvent) {
      const event = normalizeEvent(rawEvent);
      addToHistory(event);
      if (!wss) {
        return event;
      }

      const payload = JSON.stringify(event);
      for (const client of wss.clients) {
        if (client.readyState !== 1) {
          continue;
        }
        try {
          client.send(payload);
        } catch {
          client.terminate();
        }
      }

      return event;
    },

    /**
     * Return session history snapshot for backfill.
     *
     * @param {string} sessionId
     * @returns {BroadcastEvent[]}
     */
    getSessionEvents(sessionId) {
      if (!sessionId || typeof sessionId !== 'string') {
        return [];
      }
      return [...(sessionHistory.get(sessionId) || [])];
    },

    /**
     * Close underlying WS server.
     */
    close() {
      if (wss) {
        wss.close();
      }
    }
  };
}

export default { createBroadcaster };
