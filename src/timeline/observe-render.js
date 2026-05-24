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

// Event types that are intermediate progress, not final analyses. The renderer
// drops these so the prose timeline doesn't echo the same command three times
// before the verdict lands.
const PROGRESS_TYPES = new Set([
  'command_analysis_progress',
  'command_post_analysis'
]);

// Plan: docs/plans/wire-llm-to-hooks.md§"What ships" · Issue: #10
// Plan: docs/plans/wire-llm-to-hooks.md§"Proof of working" · Issue: #10
function shortPath(p) {
  if (typeof p !== 'string' || !p) return '';
  const parts = p.split('/');
  return parts.length <= 3 ? p : `…/${parts.slice(-2).join('/')}`;
}

function proseLineFor(event) {
  // Prefer the explanation the hook already produced (local rules or LLM) —
  // that's the real narrative. Fall back to the local template only when no
  // explanation is present.
  const data = event?.data || {};
  const explanation = typeof data.explanation === 'string' ? data.explanation.trim() : '';
  const command = typeof data.command === 'string' ? data.command.trim() : '';
  // Changes hook uses camelCase (filePath); discipline hooks use snake_case.
  const filePath = typeof data.filePath === 'string' ? data.filePath
                : typeof data.file_path === 'string' ? data.file_path
                : '';
  const operation = typeof data.operation === 'string' ? data.operation : '';

  if (explanation) {
    if (command) {
      const head = command.split('\n')[0].slice(0, 80);
      return `Claude ran \`${head}\` — ${explanation}`;
    }
    if (filePath) {
      const verb = operation === 'edit' || operation === 'multiedit' ? 'edited'
                : operation === 'write' ? 'wrote'
                : 'changed';
      return `Claude ${verb} ${shortPath(filePath)} — ${explanation}`;
    }
    return explanation;
  }
  const resolved = resolveTemplate(event);
  return resolved && resolved.line ? resolved.line : '';
}

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
  // File-change events (camelCase from deliberate-changes.py + snake_case
  // from the discipline hooks) carry the path, not a tool name. Show the
  // operation + path, not the event-type string.
  const filePath = typeof data.filePath === 'string' ? data.filePath
                : typeof data.file_path === 'string' ? data.file_path
                : '';
  if (filePath) {
    const op = typeof data.operation === 'string' ? data.operation : 'change';
    return `${op} ${filePath}`;
  }
  const tool = typeof data.tool === 'string' ? data.tool : (event?.type || '');
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

  // Drop intermediate "progress" events. Each command produces one final
  // `command_analyzed` (or `change_analyzed`) — that's the row we render.
  // Dedup by analysisId so a repeated final event from re-render doesn't
  // double up.
  const seenIds = new Set();
  const finals = [];
  for (const ev of cluster.events) {
    if (PROGRESS_TYPES.has(ev?.type)) continue;
    const id = ev?.data?.analysisId || `${ev?.timestamp}::${ev?.data?.command || ev?.data?.file_path || ''}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    finals.push(ev);
  }
  if (finals.length === 0) return '';

  const lines = [];
  lines.push(dividerFor(cluster.startMs));
  lines.push('');

  const proseParts = [];
  const rawLines = [];
  for (const event of finals) {
    const prose = proseLineFor(event);
    if (prose) proseParts.push(prose);
    const raw = rawLineFor(event);
    if (raw) {
      // HIGH-risk entries get a ⚠ prefix so observe + teach share the same
      // scannable affordance (#6). Show only the first line of multi-line
      // commands here — heredocs are noise in the journal view.
      const oneLineRaw = raw.split('\n')[0].slice(0, 120);
      rawLines.push(`${isHighRisk(event) ? '⚠ ' : '  '}${oneLineRaw}`);
    }
  }

  if (proseParts.length > 0) {
    for (const part of proseParts) lines.push(part);
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
