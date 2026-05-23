/**
 * Event-cluster reducer for the prose timeline.
 *
 * Groups consecutive Deliberate events into clusters by temporal proximity
 * within a single session. Each cluster represents "one chunk of activity"
 * that the prose renderer / LLM narrator can summarize as a single paragraph.
 *
 * Pure function — given the same input list it always returns the same
 * clusters. State and timing live in the caller (the idle debouncer).
 */

const DEFAULT_GAP_MS = 8_000;          // a quiet gap of >8s starts a new cluster
const DEFAULT_MAX_EVENTS_PER_CLUSTER = 12;
const DEFAULT_MAX_SPAN_MS = 60_000;    // hard cap so one busy cluster cannot grow forever

/**
 * @typedef {object} TimelineEvent
 * @property {string} type
 * @property {string} sessionId
 * @property {string} timestamp ISO-8601
 * @property {Record<string, unknown>} [data]
 */

/**
 * @typedef {object} EventCluster
 * @property {string} id stable id derived from session + first timestamp
 * @property {string} sessionId
 * @property {number} startMs
 * @property {number} endMs
 * @property {TimelineEvent[]} events
 */

function tsMs(event) {
  if (!event || typeof event.timestamp !== 'string') return 0;
  const n = Date.parse(event.timestamp);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Reduce a flat event list into chronologically ordered clusters.
 *
 * @param {TimelineEvent[]} events
 * @param {{ gapMs?: number, maxEventsPerCluster?: number, maxSpanMs?: number }} [opts]
 * @returns {EventCluster[]}
 */
export function clusterEvents(events, opts = {}) {
  const gapMs = Number.isFinite(opts.gapMs) ? opts.gapMs : DEFAULT_GAP_MS;
  const maxEvents = Number.isFinite(opts.maxEventsPerCluster)
    ? opts.maxEventsPerCluster : DEFAULT_MAX_EVENTS_PER_CLUSTER;
  const maxSpanMs = Number.isFinite(opts.maxSpanMs) ? opts.maxSpanMs : DEFAULT_MAX_SPAN_MS;

  if (!Array.isArray(events) || events.length === 0) return [];

  // Sort by timestamp ascending so clustering is order-independent.
  const sorted = [...events].sort((a, b) => tsMs(a) - tsMs(b));

  const clusters = [];
  let current = null;

  for (const event of sorted) {
    const sid = typeof event?.sessionId === 'string' ? event.sessionId : '';
    const ts = tsMs(event);

    const shouldStartNew =
      !current ||
      current.sessionId !== sid ||
      ts - current.endMs > gapMs ||
      current.events.length >= maxEvents ||
      ts - current.startMs > maxSpanMs;

    if (shouldStartNew) {
      current = {
        id: `${sid || 'no-session'}-${ts || 0}`,
        sessionId: sid,
        startMs: ts,
        endMs: ts,
        events: [event]
      };
      clusters.push(current);
    } else {
      current.events.push(event);
      current.endMs = ts;
    }
  }

  return clusters;
}

export default { clusterEvents };
