/**
 * Deliberate Terminal UI (TUI)
 *
 * Goal: keep Deliberate "in the terminal" for Claude Code/OpenCode workflows.
 * The TUI is meant to live in a split pane (WezTerm/tmux) and stay always-on.
 *
 * Data source: local JSONL event log written by hooks (see src/event-log.js).
 *
 * This file intentionally avoids fancy abstractions. It's a single-process
 * terminal app with a small set of keyboard-driven actions.
 */

import blessed from 'blessed';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadConfig, patchConfig, addSkipCommand, addCustomBlock, addAutoApprovePattern } from '../config.js';
import { appendEventLog, readRecentEvents, tailEventLog } from '../event-log.js';
import { streamChat } from '../chat-client.js';
import { clusterEvents } from '../timeline/cluster.js';
import { renderObserveTimeline, renderCluster } from '../timeline/observe-render.js';
import { renderClusterWithLLM } from '../timeline/llm-render.js';

function isTty() {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

function pickSessionForCwd(events, cwd) {
  const anchor = typeof cwd === 'string' && cwd.trim() ? cwd : null;
  if (!anchor) return null;

  const withSep = anchor.endsWith(path.sep) ? anchor : `${anchor}${path.sep}`;

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    const evCwd = typeof ev?.data?.cwd === 'string' ? ev.data.cwd : null;
    if (!evCwd) continue;

    const evWithSep = evCwd.endsWith(path.sep) ? evCwd : `${evCwd}${path.sep}`;

    const matches = evCwd === anchor || anchor.startsWith(evWithSep) || evCwd.startsWith(withSep);
    if (matches) {
      const sid = typeof ev.sessionId === 'string' ? ev.sessionId : null;
      if (sid) return sid;
    }
  }

  return null;
}

function cwdMatches(anchor, candidate) {
  const a = typeof anchor === 'string' && anchor.trim() ? anchor : null;
  const c = typeof candidate === 'string' && candidate.trim() ? candidate : null;
  if (!a || !c) return false;

  const aWithSep = a.endsWith(path.sep) ? a : `${a}${path.sep}`;
  const cWithSep = c.endsWith(path.sep) ? c : `${c}${path.sep}`;

  return c === a || a.startsWith(cWithSep) || c.startsWith(aWithSep);
}

function truncate(value, max) {
  const str = String(value ?? '');
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
}

function firstExplanationLine(value) {
  if (typeof value !== 'string') return '';
  const compact = value
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return compact || '';
}

function formatClock(iso) {
  try {
    const date = iso ? new Date(iso) : new Date();
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '--:--';
  }
}

function riskOf(event) {
  const risk = event?.data?.risk;
  if (risk === 'SAFE' || risk === 'DANGEROUS' || risk === 'MODERATE') return risk;
  return 'MODERATE';
}

function normalizeCommandForPolicy(value) {
  let command = String(value ?? '').trim().toLowerCase();
  if (!command) return '';

  if (command.startsWith('sudo ')) {
    command = command.slice(5).trim();
  }

  if (command.startsWith('command ')) {
    command = command.slice(8).trim();
  }

  if (command.startsWith('env ')) {
    const parts = command.split(/\s+/);
    let i = 1;
    while (i < parts.length && parts[i].includes('=') && !parts[i].startsWith('-')) {
      i += 1;
    }
    command = i < parts.length ? parts.slice(i).join(' ') : '';
  }

  return command.replace(/\s+/g, ' ').trim();
}

function extractCommandBase(value) {
  const normalized = normalizeCommandForPolicy(value);
  if (!normalized) return '';
  const first = normalized.split(' ')[0] || '';
  if (!first) return '';
  const segments = first.split('/');
  return segments[segments.length - 1] || first;
}

function decisionOf(event) {
  const raw = String(event?.data?.permissionDecision || '');
  if (raw === 'ask' || raw === 'allow' || raw === 'block') return raw;
  return '';
}

function decisionLabel(event) {
  const type = String(event?.type || '');
  if (type === 'command_analysis_progress') return 'analyzing';
  if (type === 'command_post_analysis') return 'executed';
  if (type === 'policy_update') return 'policy';

  const decision = decisionOf(event);
  if (decision === 'ask') return 'needs review';
  if (decision === 'allow') return 'allowed';
  if (decision === 'block') return 'blocked';
  return 'event';
}

function titleOf(event) {
  const type = String(event?.type || '');
  const explanation = firstExplanationLine(event?.data?.explanation);
  if (type === 'command_analyzed') {
    const cmd = typeof event?.data?.command === 'string' ? event.data.command : '(command)';
    const decision = decisionOf(event);
    if (decision === 'ask') {
      if (explanation) return `Review: ${explanation} · ${cmd}`;
      return `Review: ${cmd}`;
    }
    if (decision === 'block') {
      if (explanation) return `Blocked: ${explanation} · ${cmd}`;
      return `Blocked: ${cmd}`;
    }
    if (decision === 'allow') {
      const pattern = String(event?.data?.autoApproval?.pattern || '').trim();
      const base = pattern ? `Allowed by policy (${pattern}): ${cmd}` : `Allowed: ${cmd}`;
      return explanation ? `${base} — ${explanation}` : base;
    }
    return explanation ? `${cmd} — ${explanation}` : cmd;
  }
  if (type === 'command_post_analysis') {
    const cmd = typeof event?.data?.command === 'string' ? event.data.command : '(command)';
    const base = `Executed: ${cmd}`;
    return explanation ? `${base} — ${explanation}` : base;
  }
  if (type === 'command_analysis_progress') {
    const msg = typeof event?.data?.message === 'string' ? event.data.message : 'Analyzing…';
    const cmd = typeof event?.data?.command === 'string' ? event.data.command : '';
    return cmd ? `${msg}: ${cmd}` : msg;
  }
  if (type === 'file_change_analyzed') {
    const file = event?.data?.relativePath || event?.data?.filePath || '(file change)';
    return explanation ? `${explanation} · ${file}` : file;
  }
  if (type === 'policy_update') {
    const action = String(event?.data?.action || 'policy');
    const pattern = String(event?.data?.pattern || '');
    return pattern ? `${action}: ${pattern}` : action;
  }
  return event?.data?.command || '(command)';
}

function summarizeEvent(event, width = 80) {
  const clock = formatClock(event?.timestamp);
  const status = decisionLabel(event);
  const risk = riskOf(event);
  const riskLabel = risk === 'DANGEROUS' ? 'danger' : risk === 'SAFE' ? 'safe' : 'mod';
  const prefix = `${clock} ${status} ${riskLabel} · `;
  return `${prefix}${truncate(titleOf(event), Math.max(10, width - prefix.length))}`;
}

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function detailsForEvent(event) {
  if (!event) return 'No selection.';

  const lines = [];
  const type = String(event?.type || '');
  const data = event?.data || {};
  const risk = riskOf(event);
  const decision = decisionOf(event);
  const status = decisionLabel(event);
  const title = titleOf(event);

  lines.push(`summary: ${title}`);
  lines.push(`status: ${status} · risk: ${risk}`);

  if (typeof data.explanation === 'string' && data.explanation.trim()) {
    const summary = firstExplanationLine(data.explanation);
    lines.push('');
    lines.push('why Deliberate is saying this:');
    lines.push(summary);
    const full = data.explanation.trim();
    if (summary && full !== summary) {
      lines.push('');
      lines.push('full explanation:');
      lines.push(full);
    }
  }

  if (decision === 'ask') {
    lines.push('');
    lines.push('next step:');
    lines.push('- Review this action in Claude Code and choose yes/no.');
    lines.push('- Press "d" if you want Deliberate to explain or suggest a safer pattern.');
  }

  if (typeof data.command === 'string') {
    lines.push('');
    lines.push('command:');
    lines.push(data.command);
  }

  if (typeof data.relativePath === 'string' || typeof data.filePath === 'string') {
    lines.push('');
    lines.push('file:');
    lines.push(String(data.relativePath || data.filePath));
  }

  if (type === 'command_analysis_progress') {
    lines.push('');
    lines.push(`analysis stage: ${String(data.stage || '')}`);
    lines.push(`progress: ${String(data.message || '')}`);
  }

  if (data.autoApproval && typeof data.autoApproval === 'object') {
    const pattern = String(data.autoApproval.pattern || '').trim();
    lines.push('');
    lines.push('policy reason:');
    if (pattern) {
      lines.push(`Auto-approved by pattern: ${pattern}`);
    } else {
      lines.push('Auto-approved by policy pattern.');
    }
  }

  if (Array.isArray(data.evidence) && data.evidence.length) {
    lines.push('');
    lines.push('evidence:');
    data.evidence.slice(0, 8).forEach((item, idx) => {
      const source = String(item?.source || 'source');
      const name = String(item?.name || 'unknown');
      const version = item?.version ? `@${item.version}` : '';
      const url = item?.url ? ` (${item.url})` : '';
      lines.push(`${idx + 1}. ${source}: ${name}${version}${url}`);
    });
    if (data.evidence.length > 8) {
      lines.push(`... +${data.evidence.length - 8} more evidence items`);
    }
  }

  if (data.consequences) {
    lines.push('');
    lines.push('consequences:');
    const files = Array.isArray(data.consequences.files) ? data.consequences.files : [];
    const dirs = Array.isArray(data.consequences.dirs) ? data.consequences.dirs : [];
    if (typeof data.consequences.warning === 'string' && data.consequences.warning.trim()) {
      lines.push(data.consequences.warning.trim());
    }
    if (files.length) {
      lines.push(`Files impacted (${files.length}): ${files.slice(0, 10).join(', ')}`);
    }
    if (dirs.length) {
      lines.push(`Directories impacted (${dirs.length}): ${dirs.slice(0, 10).join(', ')}`);
    }
    if (!files.length && !dirs.length && !String(data.consequences.warning || '').trim()) {
      lines.push(prettyJson(data.consequences));
    }
  }

  if (Array.isArray(data.workflowPatterns) && data.workflowPatterns.length) {
    lines.push('');
    lines.push('workflowPatterns:');
    lines.push(prettyJson(data.workflowPatterns));
  }

  if (data.backupPath) {
    lines.push('');
    lines.push(`backupPath: ${String(data.backupPath)}`);
  }

  if (event.type === 'policy_update') {
    if (typeof data.guidance === 'string' && data.guidance.trim()) {
      lines.push('');
      lines.push('guidance captured for audit:');
      lines.push(data.guidance.trim());
    }
    if (typeof data.note === 'string' && data.note.trim()) {
      lines.push('');
      lines.push('note:');
      lines.push(data.note.trim());
    }
  }

  lines.push('');
  lines.push('technical details:');
  lines.push(`session: ${String(event?.sessionId || '')}`);
  lines.push(`time: ${String(event?.timestamp || '')}`);
  lines.push(`event type: ${type}`);
  if (decision) lines.push(`decision: ${decision}`);

  return lines.join('\n');
}

function buildSessions(events) {
  const bySession = new Map();
  for (const ev of events) {
    const id = String(ev?.sessionId || '');
    if (!id) continue;
    const prev = bySession.get(id);
    if (!prev || String(ev.timestamp || '').localeCompare(String(prev.lastTimestamp || '')) > 0) {
      bySession.set(id, { sessionId: id, lastTimestamp: ev.timestamp || '' });
    }
  }
  return Array.from(bySession.values())
    .sort((a, b) => String(a.lastTimestamp).localeCompare(String(b.lastTimestamp)));
}

function buildCounts(events) {
  const out = { total: events.length, safe: 0, moderate: 0, dangerous: 0 };
  for (const ev of events) {
    if (ev?.type === 'command_analysis_progress') continue;
    const risk = riskOf(ev);
    if (risk === 'SAFE') out.safe += 1;
    else if (risk === 'DANGEROUS') out.dangerous += 1;
    else out.moderate += 1;
  }
  return out;
}

function buildReviewQueue(events) {
  const pending = new Map();

  for (const ev of events) {
    const type = String(ev?.type || '');
    const analysisId = typeof ev?.data?.analysisId === 'string' ? ev.data.analysisId : null;
    if (!analysisId) continue;

    if (type === 'command_analysis_progress') {
      if (!pending.has(analysisId)) {
        pending.set(analysisId, ev);
      } else {
        const existing = pending.get(analysisId);
        if (String(existing?.type || '') === 'command_analysis_progress') {
          pending.set(analysisId, ev);
        }
      }
      continue;
    }

    if (type === 'command_analyzed') {
      const decision = String(ev?.data?.permissionDecision || '');
      if (decision === 'ask') {
        pending.set(analysisId, ev);
        continue;
      }
      if (decision === 'allow' || decision === 'block') {
        pending.delete(analysisId);
      }
      continue;
    }

    if (type === 'command_post_analysis') {
      pending.delete(analysisId);
    }
  }

  return Array.from(pending.values()).sort((a, b) =>
    String(a?.timestamp || '').localeCompare(String(b?.timestamp || ''))
  );
}

function coalesceTimelineEvents(events) {
  const out = [];
  const progressByAnalysis = new Map(); // analysisId -> index in out

  for (const ev of events) {
    const type = String(ev?.type || '');
    const analysisId = typeof ev?.data?.analysisId === 'string' ? ev.data.analysisId : null;

    if (type === 'command_analysis_progress') {
      const pid = analysisId || null;
      if (pid && progressByAnalysis.has(pid)) {
        const idx = progressByAnalysis.get(pid);
        if (typeof idx === 'number' && out[idx]) out[idx] = ev;
      } else {
        out.push(ev);
        if (pid) progressByAnalysis.set(pid, out.length - 1);
      }
      continue;
    }

    // Final command result resolves a progress row.
    if (analysisId && progressByAnalysis.has(analysisId)) {
      const idx = progressByAnalysis.get(analysisId);
      if (typeof idx === 'number' && out[idx]) out[idx] = null;
      progressByAnalysis.delete(analysisId);
    }

    out.push(ev);
  }

  return out.filter(Boolean);
}

async function checkServerHealth(baseUrl) {
  const url = `${String(baseUrl || '').replace(/\/$/, '')}/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

function startServerDetached({ port } = {}) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.join(__dirname, '..', '..');
  const serverPath = path.join(repoRoot, 'src', 'server.js');

  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: port ? String(port) : process.env.PORT
    }
  });
  child.unref();
}

function contextForChat(event) {
  const data = event?.data || {};

  // Chat is most useful for commands, but we still provide basic context for
  // file change events.
  const command = typeof data.command === 'string'
    ? data.command
    : (data.relativePath || data.filePath ? `file change: ${data.relativePath || data.filePath}` : '');

  return {
    command,
    risk: riskOf(event),
    explanation: typeof data.explanation === 'string' ? data.explanation : '',
    consequences: data.consequences && typeof data.consequences === 'object' ? data.consequences : null,
    evidence: Array.isArray(data.evidence) ? data.evidence : []
  };
}

function appendPolicyAuditEvent(event, payload = {}) {
  const sessionId = String(event?.sessionId || payload.sessionId || 'manual');
  const data = event?.data || {};
  const command = typeof data.command === 'string' ? data.command : '';
  const cwd = typeof data.cwd === 'string' ? data.cwd : process.cwd();

  appendEventLog({
    type: 'policy_update',
    timestamp: new Date().toISOString(),
    sessionId,
    data: {
      command,
      cwd,
      ...payload
    }
  });
}

export async function runTui(options = {}) {
  if (!isTty()) {
    console.error('deliberate tui requires an interactive TTY');
    process.exitCode = 1;
    return;
  }

  let config = loadConfig();
  const serverBaseUrl = config.gui?.serverBaseUrl || 'http://localhost:8765';
  const serverPort = config.server?.port || 8765;
  const enabledFromConfig = config.deliberate?.enabled;
  const deliberateOn = enabledFromConfig === false ? false : true;

  const anchorCwd = options.cwd || process.cwd();

  // Resolve interaction mode. The `mode` config field is authoritative; older
  // configs that only set `recordOnly` are interpreted as observe/teach (when
  // true) or block+teach (when false). Default is "teach" — narrated, never
  // blocking.
  const resolveInitialMode = () => {
    const raw = config.deliberate?.mode;
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (normalized === 'observe' || normalized === 'teach' || normalized === 'block+teach') {
        return normalized;
      }
    }
    if (config.deliberate?.recordOnly === false) return 'block+teach';
    return 'teach';
  };

  const state = {
    follow: options.follow ?? true,
    allSessions: options.allSessions ?? false,
    viewMode: options.viewMode === 'history' ? 'history' : 'review',
    sessionId: options.sessionId || null,
    events: coalesceTimelineEvents(readRecentEvents({ days: 2, maxEventsPerFile: 2000 })),
    serverOk: false,
    statusMessage: '',
    deliberateOn,
    mode: resolveInitialMode(),
    recordOnly: config.deliberate?.recordOnly === true,
    explainEverything: config.deliberate?.explainEverything === true,
    pendingCount: 0
  };

  const sessions = buildSessions(state.events);
  const latest = sessions.length ? sessions[sessions.length - 1].sessionId : null;
  const byCwd = pickSessionForCwd(state.events, anchorCwd);

  if (!state.allSessions && !state.sessionId) {
    state.sessionId = byCwd || latest;
  }

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    title: 'Deliberate'
  });

  const HEADER_HEIGHT = 4;
  const FOOTER_HEIGHT = 1;

  const computeLayout = () => {
    const total = typeof screen.height === 'number' ? screen.height : 40;
    const detailsHeight = Math.max(10, Math.min(20, Math.floor(total * 0.4)));
    const listHeight = Math.max(6, total - HEADER_HEIGHT - FOOTER_HEIGHT - detailsHeight);
    return {
      listTop: HEADER_HEIGHT,
      listHeight,
      detailsTop: HEADER_HEIGHT + listHeight,
      detailsHeight
    };
  };

  let layout = computeLayout();

  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    height: HEADER_HEIGHT,
    width: '100%',
    tags: false,
    style: { fg: 'white', bg: 'black' }
  });

  // Prose timeline: a scrollable text box replaces the legacy events table.
  // No row selection — the journal aesthetic from the outcome contract treats
  // the timeline as one continuous narrative. Action keybinds (a/w/b/d) stay
  // bound but operate against the most-recent visible cluster instead of a
  // selected row; they are no-ops in observe/teach until the actions story
  // lands in a follow-up.
  const list = blessed.box({
    parent: screen,
    top: layout.listTop,
    left: 0,
    width: '100%',
    // Take the whole middle area; details pane is hidden in prose mode.
    height: layout.listHeight + layout.detailsHeight,
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    alwaysScroll: true,
    border: 'line',
    label: ' timeline ',
    style: {
      border: { fg: 'gray' }
    },
    scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { bg: 'white' } },
    tags: false
  });

  // Details pane kept as a hidden no-op so existing references (e.g. scroll
  // helpers, layout math) keep compiling without a full rewrite. Will be
  // removed once selection-dependent code paths are pruned.
  const details = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    hidden: true
  });

  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    height: FOOTER_HEIGHT,
    width: '100%',
    style: { fg: 'gray', bg: 'black' }
  });

  const helpText = () => [
    '↑/↓ scroll',
    'PgUp/PgDn page',
    't mode',
    'a all',
    'n next session',
    'f follow',
    'e explain-all',
    'x toggle',
    'S start server',
    'd discuss',
    'q quit'
  ].join(' | ');

  let filtered = [];
  let selectedIndex = 0;
  let stopTail = null;
  let healthTimer = null;

  const renderHeader = () => {
    const sessionLabel = state.allSessions
      ? 'all'
      : (state.sessionId ? truncate(state.sessionId, 32) : 'none');
    const counts = buildCounts(filtered);
    const serverDot = state.serverOk ? '●' : '○';
    const followLabel = state.follow ? 'follow' : 'paused';
    const enabledLabel = state.deliberateOn ? 'On' : 'Off';
    const viewLabel = state.viewMode === 'review' ? 'Needs review' : 'Timeline';
    const modeLabel = state.mode.toUpperCase();
    const behaviorLabel = `mode ${modeLabel}`;
    const coverageLabel = state.explainEverything ? 'everything' : 'high-signal';

    const line1 = `Deliberate ${enabledLabel} • ${viewLabel} • waiting ${state.pendingCount} • session ${sessionLabel}`;
    const line2 = `seen ${counts.total} • safe ${counts.safe} • moderate ${counts.moderate} • dangerous ${counts.dangerous}`;
    const line3 = `mode ${behaviorLabel} • coverage ${coverageLabel} • server ${serverDot} • ${followLabel}`;
    const line4 = state.statusMessage ? state.statusMessage : '';

    header.setContent([line1, line2, line3, line4].join('\n'));
  };

  const applyFilter = () => {
    let bySession = [];
    if (state.allSessions || !state.sessionId) {
      bySession = state.events.slice();
    } else {
      bySession = state.events.filter((e) => String(e.sessionId || '') === String(state.sessionId));
    }

    const pending = buildReviewQueue(bySession);
    state.pendingCount = pending.length;

    if (state.viewMode === 'review') {
      filtered = pending;
    } else {
      filtered = bySession;
    }
  };

  // Per-cluster LLM prose cache. Keyed by cluster id + event-count so a cluster
  // that grows triggers a fresh LLM call; an unchanged cluster reuses prose.
  const proseCache = new Map();
  let llmDebounceHandle = null;

  function clusterCacheKey(cluster) {
    return `${cluster.id}::${cluster.events.length}::${cluster.endMs}`;
  }

  function llmDisabledForMode() {
    // Observe mode contractually never calls the LLM.
    return state.mode === 'observe';
  }

  function staticClustersText(clusters) {
    if (!clusters || clusters.length === 0) return '(no events yet)';
    return [...clusters].reverse().map((c) => {
      const cached = proseCache.get(clusterCacheKey(c));
      if (cached && !llmDisabledForMode()) {
        // LLM prose available — substitute into the journal frame.
        return renderClusterWithCachedProse(c, cached);
      }
      return renderCluster(c);
    }).join('\n');
  }

  function renderClusterWithCachedProse(cluster, proseParagraph) {
    // Reuse the static renderer's divider + raw-lines framing, but swap the
    // template-built paragraph for the LLM-built one. Keeping the raw-command
    // footer so users can always see what literally ran.
    const staticOutput = renderCluster(cluster);
    const lines = staticOutput.split('\n');
    // Find the prose paragraph slot (it's the first non-empty line after the
    // divider+blank). Replace it with the LLM paragraph.
    let dividerSeen = false;
    let replaced = false;
    const out = [];
    for (const line of lines) {
      if (!dividerSeen && line.startsWith('── ')) {
        dividerSeen = true;
        out.push(line);
        continue;
      }
      if (dividerSeen && !replaced && line.trim() && !line.startsWith('  ') && !line.startsWith('⚠ ')) {
        out.push(proseParagraph);
        replaced = true;
        continue;
      }
      out.push(line);
    }
    if (!replaced) out.splice(2, 0, proseParagraph, '');
    return out.join('\n');
  }

  function scheduleLlmFill(clusters) {
    if (llmDisabledForMode()) return;
    if (!Array.isArray(clusters) || clusters.length === 0) return;
    if (llmDebounceHandle) clearTimeout(llmDebounceHandle);
    // 3-second idle debounce per the prose-timeline outcome contract.
    llmDebounceHandle = setTimeout(async () => {
      // Fill prose for the most-recent N clusters first (visual priority).
      const recent = clusters.slice(-3);
      for (const cluster of recent) {
        const key = clusterCacheKey(cluster);
        if (proseCache.has(key)) continue;
        const prose = await renderClusterWithLLM(cluster);
        if (prose) {
          proseCache.set(key, prose);
          // Re-render the timeline so the new prose paints.
          renderAll();
        }
      }
    }, 3_000);
    if (llmDebounceHandle && typeof llmDebounceHandle.unref === 'function') {
      llmDebounceHandle.unref();
    }
  }

  const renderList = () => {
    const clusters = clusterEvents(filtered);
    list.setLabel(` timeline (${state.mode}) `);
    list.setContent(staticClustersText(clusters));
    // Auto-scroll to bottom (newest cluster is at the top after reverse).
    list.setScrollPerc(0);
    scheduleLlmFill(clusters);
  };

  const renderDetails = () => {
    // Details pane is hidden in prose view; nothing to do.
  };

  const renderAll = (opts = {}) => {
    applyFilter();
    renderHeader();
    renderList(opts);
    renderDetails();
    footer.setContent(helpText());
    screen.render();
  };

  const setStatus = (msg, { ttlMs = 2500 } = {}) => {
    state.statusMessage = truncate(msg, 200);
    renderHeader();
    screen.render();
    if (ttlMs > 0) {
      setTimeout(() => {
        if (state.statusMessage === msg) {
          state.statusMessage = '';
          renderHeader();
          screen.render();
        }
      }, ttlMs).unref?.();
    }
  };

  const cycleSession = (delta) => {
    const listSessions = buildSessions(state.events);
    if (!listSessions.length) return;

    if (state.allSessions) state.allSessions = false;

    const ids = listSessions.map((s) => s.sessionId);
    const currentIdx = state.sessionId ? ids.indexOf(state.sessionId) : -1;
    const nextIdx = currentIdx >= 0 ? (currentIdx + delta + ids.length) % ids.length : ids.length - 1;
    state.sessionId = ids[nextIdx];
    selectedIndex = 0;
    renderAll({ keepSelection: false });
  };

  const handleSelect = (idx) => {
    selectedIndex = typeof idx === 'number' ? idx : list.selected;
    renderDetails();
    renderHeader();
    screen.render();
  };

  list.on('select item', (_, idx) => handleSelect(idx));
  list.on('select', (_, idx) => handleSelect(idx));

  screen.on('resize', () => {
    layout = computeLayout();
    list.top = layout.listTop;
    list.height = layout.listHeight;
    details.top = layout.detailsTop;
    details.height = layout.detailsHeight;
    screen.render();
  });

  screen.key(['q', 'C-c'], () => {
    stopTail?.();
    if (healthTimer) clearInterval(healthTimer);
    screen.destroy();
    process.exit(0);
  });

  screen.key(['a'], () => {
    state.allSessions = !state.allSessions;
    if (!state.allSessions && !state.sessionId) {
      state.sessionId = latest;
    }
    selectedIndex = 0;
    renderAll({ keepSelection: false });
  });

  screen.key(['v'], () => {
    state.viewMode = state.viewMode === 'review' ? 'history' : 'review';
    selectedIndex = 0;
    setStatus(state.viewMode === 'review' ? 'showing items that need review' : 'showing full timeline');
    renderAll({ keepSelection: false });
  });

  screen.key(['n'], () => cycleSession(1));
  screen.key(['p'], () => cycleSession(-1));

  screen.key(['f'], () => {
    state.follow = !state.follow;
    setStatus(state.follow ? 'follow enabled' : 'follow paused');
  });

  screen.key(['r'], () => {
    state.events = coalesceTimelineEvents(readRecentEvents({ days: 2, maxEventsPerFile: 2000 }));
    selectedIndex = 0;
    renderAll({ keepSelection: false });
    setStatus('reloaded');
  });

  screen.key(['pagedown'], () => {
    details.scroll(Math.max(5, Math.floor((Number(details.height) || 10) / 2)));
    screen.render();
  });

  screen.key(['pageup'], () => {
    details.scroll(-Math.max(5, Math.floor((Number(details.height) || 10) / 2)));
    screen.render();
  });

  screen.key(['S'], async () => {
    const health = await checkServerHealth(serverBaseUrl);
    if (health.ok) {
      setStatus('server already running');
      state.serverOk = true;
      renderHeader();
      screen.render();
      return;
    }

    startServerDetached({ port: serverPort });
    setStatus('starting server…');
  });

  screen.key(['s'], () => {
    const event = filtered[selectedIndex];
    const command = event?.data?.command;
    if (typeof command !== 'string' || !command.trim()) {
      setStatus('skip: no command selected');
      return;
    }
    try {
      addSkipCommand(command);
      appendPolicyAuditEvent(event, {
        action: 'skip_exact_command',
        pattern: command
      });
      setStatus('saved: don\'t flag exact command');
    } catch {
      setStatus('skip failed');
    }
  });

  screen.key(['b'], () => {
    const event = filtered[selectedIndex];
    const command = event?.data?.command;
    if (typeof command !== 'string' || !command.trim()) {
      setStatus('block: no command selected');
      return;
    }
    try {
      addCustomBlock(command);
      appendPolicyAuditEvent(event, {
        action: 'block_pattern',
        pattern: command
      });
      setStatus('saved: block pattern');
    } catch {
      setStatus('block failed');
    }
  });

  // `t` cycles interaction mode: observe → teach → block+teach → observe.
  // Persists to config so the next TUI run keeps the same shape, and keeps
  // legacy `recordOnly` in sync so the PreToolUse hook (which still reads it
  // as a fallback) does not disagree with the visible mode.
  screen.key(['t'], () => {
    const order = ['observe', 'teach', 'block+teach'];
    const current = order.indexOf(state.mode);
    const next = order[(current + 1) % order.length];
    const nextRecordOnly = next !== 'block+teach';
    try {
      config = patchConfig({
        deliberate: { mode: next, recordOnly: nextRecordOnly }
      });
      state.mode = next;
      state.recordOnly = nextRecordOnly;
      appendEventLog({
        type: 'policy_update',
        timestamp: new Date().toISOString(),
        sessionId: state.sessionId || 'manual',
        data: { action: 'set_mode', mode: next, cwd: process.cwd() }
      });
      setStatus(`mode → ${next}`);
      renderAll();
    } catch {
      setStatus('mode change failed');
    }
  });

  screen.key(['x'], () => {
    try {
      const next = !state.deliberateOn;
      config = patchConfig({ deliberate: { enabled: next } });
      state.deliberateOn = next;
      appendEventLog({
        type: 'policy_update',
        timestamp: new Date().toISOString(),
        sessionId: state.sessionId || 'manual',
        data: {
          action: next ? 'enable_deliberate' : 'disable_deliberate',
          cwd: process.cwd()
        }
      });
      setStatus(next ? 'Deliberate turned on' : 'Deliberate turned off');
      renderHeader();
      screen.render();
    } catch {
      setStatus('toggle failed');
    }
  });

  screen.key(['e'], () => {
    try {
      const next = !state.explainEverything;
      config = patchConfig({ deliberate: { explainEverything: next } });
      state.explainEverything = next;
      appendEventLog({
        type: 'policy_update',
        timestamp: new Date().toISOString(),
        sessionId: state.sessionId || 'manual',
        data: {
          action: next ? 'explain_everything_on' : 'explain_everything_off',
          cwd: process.cwd()
        }
      });
      setStatus(next ? 'Explain-everything is now ON' : 'Explain-everything is now OFF');
      renderHeader();
      screen.render();
    } catch {
      setStatus('could not toggle explain-everything');
    }
  });

  const openAlwaysAllow = () => {
    const event = filtered[selectedIndex];
    const command = event?.data?.command;
    if (typeof command !== 'string' || !command.trim()) {
      setStatus('always allow: no command selected');
      return;
    }

    const normalized = normalizeCommandForPolicy(command);
    const suggestedPattern = extractCommandBase(command) || normalized;

    const overlay = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '96%',
      height: '90%',
      border: 'line',
      label: ' always allow policy (esc to close) ',
      style: { border: { fg: 'gray' } }
    });

    const guidance = blessed.box({
      parent: overlay,
      top: 0,
      left: 0,
      width: '100%',
      bottom: 6,
      border: 'line',
      label: ' guidance ',
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      style: { border: { fg: 'gray' }, fg: 'white' }
    });

    const hint = blessed.box({
      parent: overlay,
      bottom: 3,
      left: 0,
      width: '100%',
      height: 3,
      border: 'line',
      label: ' instructions ',
      content: `Edit pattern, press Enter to confirm. Suggested: ${suggestedPattern}`,
      style: { border: { fg: 'gray' }, fg: 'gray' }
    });

    const patternInput = blessed.textbox({
      parent: overlay,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: 'line',
      label: ' pattern ',
      inputOnFocus: true,
      style: {
        border: { fg: 'gray' },
        focus: { border: { fg: 'white' } }
      }
    });

    let guidanceText = [
      'Generating policy guidance…',
      '',
      `Command: ${command}`,
      `Risk: ${riskOf(event)}`,
      '',
      'Why this step exists:',
      '- Always-allow rules reduce approval prompts.',
      '- Broader patterns increase blast radius.',
      '- Prefer the narrowest rule that still matches your workflow.'
    ].join('\n');

    let streamingAbort = null;

    const renderGuidance = () => {
      guidance.setContent(guidanceText);
      guidance.setScrollPerc(100);
      screen.render();
    };

    const close = () => {
      try {
        streamingAbort?.abort();
      } catch {
        // ignore
      }
      overlay.detach();
      screen.render();
      list.focus();
    };

    overlay.key(['escape'], close);
    guidance.key(['escape'], close);
    patternInput.key(['escape'], close);

    patternInput.on('submit', (value) => {
      const pattern = String(value || '').trim();
      if (!pattern) {
        setStatus('pattern required');
        patternInput.focus();
        return;
      }

      const question = blessed.question({
        parent: overlay,
        top: 'center',
        left: 'center',
        width: '80%',
        height: 7,
        border: 'line',
        label: ' confirm ',
        keys: true,
        vi: true
      });

      question.ask(`Save always-allow pattern "${pattern}"?`, (ok) => {
        question.destroy();
        if (!ok) {
          patternInput.focus();
          screen.render();
          return;
        }

        try {
          addAutoApprovePattern(pattern);
          appendPolicyAuditEvent(event, {
            action: 'auto_approve_pattern_add',
            pattern,
            note: `Suggested pattern was: ${suggestedPattern}`,
            guidance: guidanceText.slice(0, 4000)
          });
          setStatus(`saved always-allow pattern: ${truncate(pattern, 60)}`);
          close();
        } catch {
          setStatus('always allow failed');
          patternInput.focus();
          screen.render();
        }
      });
    });

    patternInput.setValue(suggestedPattern);
    renderGuidance();
    patternInput.focus();
    screen.render();

    const controller = new AbortController();
    streamingAbort = controller;
    const policyPrompt = [
      'I want to configure an always-allow rule for this shell command.',
      'Please coach a cautious user.',
      'Give a short risk summary and suggest least-privileged pattern options.',
      'If the command can touch network destinations, suggest destination-level constraints.',
      'Format as plain text with these headings:',
      'Risk summary',
      'Recommended rule',
      'Optional broader rule (with warning)',
      'Questions to confirm before saving'
    ].join('\n');

    streamChat({
      messages: [{ role: 'user', content: policyPrompt }],
      context: contextForChat(event),
      signal: controller.signal,
      onEvent: (ev) => {
        if (!ev || typeof ev !== 'object') return;
        if (ev.type === 'token') {
          guidanceText += ev.text;
          renderGuidance();
          return;
        }
        if (ev.type === 'error') {
          guidanceText += `\n\n[guidance error] ${ev.message || 'unknown error'}`;
          renderGuidance();
        }
      }
    }).catch(() => {
      guidanceText += '\n\n[guidance error] failed to generate guidance';
      renderGuidance();
    });
  };

  screen.key(['w'], openAlwaysAllow);

  const openChat = () => {
    const event = filtered[selectedIndex];
    if (!event) {
      setStatus('no selection');
      return;
    }

    const overlay = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '98%',
      height: '98%',
      border: 'line',
      label: ' discuss (esc to close) ',
      style: { border: { fg: 'gray' } }
    });

    const chatLog = blessed.box({
      parent: overlay,
      top: 0,
      left: 0,
      width: '100%',
      bottom: 3,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      style: { fg: 'white' }
    });

    const chatInput = blessed.textbox({
      parent: overlay,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: 'line',
      label: ' message ',
      inputOnFocus: true,
      style: {
        border: { fg: 'gray' },
        focus: { border: { fg: 'white' } }
      }
    });

    const messages = [];
    let streamingAbort = null;

    const renderChat = () => {
      const chunks = [];
      for (const msg of messages) {
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        chunks.push(`${role}: ${msg.content || ''}`.trimEnd());
        chunks.push('');
      }
      chatLog.setContent(chunks.join('\n'));
      chatLog.setScrollPerc(100);
      screen.render();
    };

    const close = () => {
      try {
        streamingAbort?.abort();
      } catch {
        // ignore
      }
      overlay.detach();
      screen.render();
      list.focus();
    };

    overlay.key(['escape'], close);
    chatLog.key(['escape'], close);
    chatInput.key(['escape'], close);

    chatInput.on('submit', async (value) => {
      const text = String(value || '').trim();
      chatInput.clearValue();
      screen.render();
      if (!text) {
        chatInput.focus();
        return;
      }

      messages.push({ role: 'user', content: text });
      messages.push({ role: 'assistant', content: '' });
      renderChat();

      const assistantIdx = messages.length - 1;
      const controller = new AbortController();
      streamingAbort = controller;

      const apiMessages = messages
        .slice(0, assistantIdx) // exclude placeholder assistant
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        await streamChat({
          messages: apiMessages,
          context: contextForChat(event),
          signal: controller.signal,
          onEvent: (ev) => {
            if (controller.signal.aborted) return;
            if (!ev || typeof ev !== 'object') return;

            if (ev.type === 'token') {
              messages[assistantIdx].content += ev.text;
              renderChat();
              return;
            }

            if (ev.type === 'error') {
              messages[assistantIdx].content += `\n\n[error] ${ev.message || 'unknown error'}`;
              renderChat();
            }
          }
        });
      } finally {
        streamingAbort = null;
        chatInput.focus();
      }
    });

    messages.push({
      role: 'assistant',
      content: 'Ask anything about the selected command/change. If you do not have keys configured, Deliberate will reply in mock mode.'
    });
    renderChat();

    chatInput.focus();
    screen.render();
  };

  screen.key(['d'], openChat);

  // Initial render.
  renderAll({ keepSelection: false });
  list.focus();

  // Server health polling (UI-only).
  state.serverOk = (await checkServerHealth(serverBaseUrl)).ok;
  renderHeader();
  screen.render();

  healthTimer = setInterval(async () => {
    const result = await checkServerHealth(serverBaseUrl);
    if (result.ok !== state.serverOk) {
      state.serverOk = result.ok;
      renderHeader();
      screen.render();
    }
  }, 3000);
  healthTimer.unref?.();

  // Live updates from the event log.
  stopTail = tailEventLog({
    intervalMs: 250,
    onEvent: (ev) => {
      if (!ev || typeof ev !== 'object') return;

      state.events = coalesceTimelineEvents([...state.events, ev]);
      if (state.events.length > 10_000) {
        state.events = state.events.slice(state.events.length - 10_000);
      }

      const matches = state.allSessions || !state.sessionId || String(ev.sessionId || '') === String(state.sessionId);
      if (!matches) {
        // Session mismatch happens in practice. We see SessionStart session ids
        // that don't match the subsequent tool hook session ids. When that
        // happens, the pane looks "dead" even though events are flowing.
        //
        // To keep the UX sane, if we're filtered to a session with zero events,
        // and we receive a new event for the current working directory, we
        // auto-switch to that session.
        if (!state.allSessions && filtered.length === 0) {
          const evCwd = typeof ev?.data?.cwd === 'string' ? ev.data.cwd : null;
          if (cwdMatches(anchorCwd, evCwd)) {
            const sid = typeof ev.sessionId === 'string' ? ev.sessionId : null;
            if (sid) {
              state.sessionId = sid;
              selectedIndex = 0;
              setStatus(`auto-switched session to ${truncate(sid, 24)}`, { ttlMs: 2000 });
              renderAll({ keepSelection: false });
              return;
            }
          }
        }

        // Still update header counts by re-filtering occasionally.
        renderHeader();
        screen.render();
        return;
      }

      // For follow mode, keep selection at the bottom. If the user navigated up
      // and disabled follow, leave selection alone.
      const keepSelection = !state.follow;
      if (!keepSelection) {
        selectedIndex = filtered.length; // will become last after render
      }
      renderAll({ keepSelection });
    }
  });
}

export default { runTui };
