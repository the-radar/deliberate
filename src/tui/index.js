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

function titleOf(event) {
  const type = String(event?.type || '');
  if (type === 'command_analyzed') {
    const cmd = typeof event?.data?.command === 'string' ? event.data.command : '(command)';
    const decision = String(event?.data?.permissionDecision || '');
    if (decision === 'ask') return `Needs approval: ${cmd}`;
    if (decision === 'block') return `Blocked: ${cmd}`;
    if (decision === 'allow') return `Allowed: ${cmd}`;
    return cmd;
  }
  if (type === 'command_post_analysis') {
    const cmd = typeof event?.data?.command === 'string' ? event.data.command : '(command)';
    return `Executed: ${cmd}`;
  }
  if (type === 'command_analysis_progress') {
    const msg = typeof event?.data?.message === 'string' ? event.data.message : 'Analyzing…';
    const cmd = typeof event?.data?.command === 'string' ? event.data.command : '';
    return cmd ? `${msg}: ${cmd}` : msg;
  }
  if (type === 'file_change_analyzed') {
    return event?.data?.relativePath || event?.data?.filePath || '(file change)';
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
  const risk = riskOf(event);
  const label = risk === 'DANGEROUS' ? 'D' : risk === 'SAFE' ? 'S' : 'M';
  const prefix = `${clock} [${label}] `;
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
  lines.push(`type: ${event.type || ''}`);
  lines.push(`time: ${event.timestamp || ''}`);
  lines.push(`session: ${event.sessionId || ''}`);
  lines.push(`risk: ${riskOf(event)}`);

  const data = event.data || {};
  if (typeof data.permissionDecision === 'string' && data.permissionDecision) {
    lines.push(`decision: ${data.permissionDecision}`);
  }
  if (event.type === 'command_analysis_progress') {
    lines.push('');
    lines.push(`stage: ${String(data.stage || '')}`);
    lines.push(`message: ${String(data.message || '')}`);
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

  if (typeof data.explanation === 'string' && data.explanation.trim()) {
    lines.push('');
    lines.push('explanation:');
    lines.push(data.explanation.trim());
  }

  if (data.autoApproval && typeof data.autoApproval === 'object') {
    lines.push('');
    lines.push('autoApproval:');
    lines.push(prettyJson(data.autoApproval));
  }

  if (Array.isArray(data.evidence) && data.evidence.length) {
    lines.push('');
    lines.push('evidence:');
    lines.push(prettyJson(data.evidence));
  }

  if (data.consequences) {
    lines.push('');
    lines.push('consequences:');
    lines.push(prettyJson(data.consequences));
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
      lines.push('guidance:');
      lines.push(data.guidance.trim());
    }
    if (typeof data.note === 'string' && data.note.trim()) {
      lines.push('');
      lines.push('note:');
      lines.push(data.note.trim());
    }
  }

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
  const serverPort = config.classifier?.serverPort || 8765;
  const enabledFromConfig = config.deliberate?.enabled;
  const deliberateOn = enabledFromConfig === false ? false : true;

  const anchorCwd = options.cwd || process.cwd();

  const state = {
    follow: options.follow ?? true,
    allSessions: options.allSessions ?? false,
    viewMode: options.viewMode === 'history' ? 'history' : 'review',
    sessionId: options.sessionId || null,
    events: coalesceTimelineEvents(readRecentEvents({ days: 2, maxEventsPerFile: 2000 })),
    serverOk: false,
    statusMessage: '',
    deliberateOn,
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

  const list = blessed.list({
    parent: screen,
    top: layout.listTop,
    left: 0,
    width: '100%',
    height: layout.listHeight,
    keys: true,
    vi: true,
    mouse: true,
    border: 'line',
    label: ' events ',
    style: {
      border: { fg: 'gray' },
      selected: { bg: 'green', fg: 'black' }
    },
    scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { bg: 'white' } }
  });

  const details = blessed.box({
    parent: screen,
    top: layout.detailsTop,
    left: 0,
    width: '100%',
    height: layout.detailsHeight,
    border: 'line',
    label: ' details ',
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    style: {
      border: { fg: 'gray' }
    }
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
    '↑/↓ navigate',
    'v review/history',
    'a all',
    'n next session',
    'f follow',
    's skip exact',
    'w always allow',
    'b block',
    'd discuss',
    'x toggle',
    'S start server',
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
    const enabledLabel = state.deliberateOn ? 'on' : 'off';
    const viewLabel = state.viewMode === 'review' ? 'review' : 'history';

    const line1 = `Deliberate (${enabledLabel})  mode=${viewLabel}  pending=${state.pendingCount}  session=${sessionLabel}`;
    const line2 = `total=${counts.total}  safe=${counts.safe}  mod=${counts.moderate}  danger=${counts.dangerous}`;
    const line3 = `server=${serverBaseUrl}  ${serverDot}  ${followLabel}`;
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

  const renderList = ({ keepSelection = true } = {}) => {
    const width = typeof list.width === 'number' ? list.width : screen.width;
    const items = filtered.map((ev) => summarizeEvent(ev, width - 6));
    list.setItems(items);
    list.setLabel(` ${state.viewMode === 'review' ? 'review queue' : 'history'} `);

    if (!keepSelection) {
      selectedIndex = Math.max(0, items.length - 1);
    } else {
      selectedIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));
    }

    if (items.length) {
      list.select(selectedIndex);
    }
  };

  const renderDetails = () => {
    const event = filtered[selectedIndex] || null;
    details.setContent(detailsForEvent(event));
    details.setScrollPerc(0);
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
    setStatus(state.viewMode === 'review' ? 'review queue' : 'history view');
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
      setStatus('saved: skip exact command');
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
      setStatus(next ? 'deliberate enabled' : 'deliberate disabled');
      renderHeader();
      screen.render();
    } catch {
      setStatus('toggle failed');
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
      'Give a short risk summary and suggest least-privileged pattern options.',
      'Format as plain text with these headings:',
      'Risk summary',
      'Recommended rule',
      'If you need broader scope'
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
