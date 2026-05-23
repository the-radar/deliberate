/**
 * Static prose renderer for observe mode (no LLM calls).
 *
 * Converts a list of clusters into the journal-shaped output described by
 * the prose-timeline outcome contract:
 *
 *   ── 06:42 ─────────────────────────────────
 *
 *   Claude read package.json. Claude listed the working directory.
 *
 *     cat package.json
 *     ls
 *
 * The output is intentionally flat — no headers, no labels — so observe mode
 * matches the visual shape of teach mode without paying for an LLM call.
 *
 * Implements the #4 acceptance criterion "observe mode uses no LLM" and the
 * #1 acceptance criterion "no table" in a way teach/block+teach can reuse as
 * a fallback when the LLM is unreachable.
 */

import { resolveTemplate } from './templates.js';

const DIVIDER = '── ';
const DIVIDER_WIDTH = 60;

/**
 * @param {number} startMs
 * @returns {string}
 */
function dividerFor(startMs) {
  if (!Number.isFinite(startMs) || startMs <= 0) {
    return DIVIDER + '─'.repeat(DIVIDER_WIDTH - DIVIDER.length);
  }
  const d = new Date(startMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const stamp = `${hh}:${mm}`;
  const remaining = Math.max(1, DIVIDER_WIDTH - DIVIDER.length - stamp.length - 1);
  return `${DIVIDER}${stamp} ${'─'.repeat(remaining)}`;
}

function rawLineFor(event) {
  const data = event?.data || {};
  if (typeof data.command === 'string') return data.command.trim();
  const tool = typeof data.tool === 'string' ? data.tool : (event?.type || '');
  if (typeof data.file_path === 'string') return `${tool || 'tool'} ${data.file_path}`;
  return tool || '';
}

function isHighRisk(event) {
  const risk = event?.data?.risk;
  if (typeof risk !== 'string') return false;
  const normalized = risk.toUpperCase();
  return normalized === 'HIGH' || normalized === 'CRITICAL' || normalized === 'DANGEROUS';
}

/**
 * Render one cluster as a single paragraph + footer of raw commands.
 *
 * @param {{ startMs: number, events: any[] }} cluster
 * @returns {string}
 */
export function renderCluster(cluster) {
  if (!cluster || !Array.isArray(cluster.events) || cluster.events.length === 0) return '';
  const lines = [];
  lines.push(dividerFor(cluster.startMs));
  lines.push('');

  const proseParts = [];
  const rawLines = [];
  for (const event of cluster.events) {
    const resolved = resolveTemplate(event);
    if (resolved && resolved.line) proseParts.push(resolved.line);
    const raw = rawLineFor(event);
    if (raw) {
      // HIGH-risk entries are marked with ⚠ as a prefix on the raw line so
      // observe and teach modes share the same scannable affordance (#6).
      rawLines.push(`${isHighRisk(event) ? '⚠ ' : '  '}${raw}`);
    }
  }

  if (proseParts.length > 0) {
    lines.push(proseParts.join(' '));
    lines.push('');
  }
  if (rawLines.length > 0) {
    for (const line of rawLines) lines.push(line);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render all clusters, newest first.
 *
 * @param {{ startMs: number, events: any[] }[]} clusters
 * @returns {string}
 */
export function renderObserveTimeline(clusters) {
  if (!Array.isArray(clusters) || clusters.length === 0) {
    return '(no events yet)\n';
  }
  // Newest first matches how the table currently scrolls.
  return [...clusters].reverse().map(renderCluster).join('\n');
}

export default { renderCluster, renderObserveTimeline };
