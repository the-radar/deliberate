/**
 * Spec-adherence (PreToolUse on Write|Edit|MultiEdit).
 *
 * Two-stage drift check:
 *   1. Ask `spec_watcher_daemon.py` (running at `~/.cache/nospec-drift/spec.sock`)
 *      for the spec sections that match the file being written. The daemon
 *      owns spec discovery and content extraction — this module never reads
 *      docs/ directly.
 *   2. If the daemon returned matching specs, call the configured LLM via
 *      deliberate's bring-your-own gateway (#3) with a drift-check prompt.
 *      Parse the JSON verdict back into allow/block.
 *
 * Policy:
 *   - off / paused / bypassed -> allow with audit (handled in eval-entry).
 *   - project root has no `.git` -> stringency off, allow (#7 outcome).
 *   - no written spec at all (no docs/, specs/, spec-mapping.json) -> "ask"
 *     with the user-message-as-spec interview prompt.
 *   - daemon unreachable AND .git is present -> fail-closed with debug note.
 *   - daemon reachable but speaks an unrecognised protocol -> fail-open with
 *     warning (we caused the drift; do not punish the user).
 *   - daemon returns zero matching specs -> allow (nothing to compare against).
 *   - LLM unreachable -> allow with warning (do not block on infra outage).
 *   - LLM verdict.drift_detected === true -> block with formatted message.
 *
 * Returns:
 *   { decision: 'allow' | 'block' | 'ask', message: string,
 *     daemonReachable: boolean, specsChecked: number }
 */

import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import { streamChat } from '../chat-client.js';

const DAEMON_SOCKET = path.join(os.homedir(), '.cache', 'nospec-drift', 'spec.sock');
const DAEMON_TIMEOUT_MS = 5_000;

/**
 * Walk up from `cwd` looking for `.git` to determine whether stringency applies.
 *
 * @param {string} cwd
 * @returns {boolean}
 */
export function isStringentProject(cwd) {
  if (typeof cwd !== 'string' || !cwd) return false;
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/**
 * Heuristic: does the project carry any written spec we can grep against?
 * If not, the cross-project discipline note says we should interview the user instead of
 * blocking.
 *
 * @param {string} cwd
 * @returns {boolean}
 */
export function hasWrittenSpec(cwd) {
  if (typeof cwd !== 'string' || !cwd) return false;
  const candidates = [
    path.join(cwd, 'docs'),
    path.join(cwd, 'specs'),
    path.join(cwd, '.claude', 'spec-mapping.json'),
    path.join(cwd, 'spec-mapping.json')
  ];
  return candidates.some((p) => {
    try { return fs.existsSync(p); } catch { return false; }
  });
}

/**
 * Best-effort daemon ping. Resolves to true when the socket exists and accepts
 * a connection; false otherwise. Never throws.
 *
 * @returns {Promise<boolean>}
 */
export function pingDaemon() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      if (!fs.existsSync(DAEMON_SOCKET)) return resolve(false);
      const client = net.createConnection(DAEMON_SOCKET);
      client.setTimeout(DAEMON_TIMEOUT_MS);
      client.on('connect', () => { client.end(); finish(true); });
      client.on('error', () => finish(false));
      client.on('timeout', () => { client.destroy(); finish(false); });
    } catch {
      finish(false);
    }
  });
}

/**
 * Send a JSON request to the daemon, wait for one JSON response.
 *
 * @param {object} payload
 * @returns {Promise<object | null>}
 */
export function callDaemon(payload) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => { if (!finished) { finished = true; resolve(value); } };
    try {
      const client = net.createConnection(DAEMON_SOCKET);
      client.setTimeout(DAEMON_TIMEOUT_MS);
      let buffer = '';
      client.on('connect', () => {
        // Daemon reads up to 8192 bytes then responds; no length prefix and no
        // trailing delimiter. We send the JSON without a newline and rely on
        // the daemon closing the connection to signal end-of-response.
        client.write(JSON.stringify(payload));
      });
      client.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
      client.on('end', () => {
        if (!buffer) return finish(null);
        try { finish(JSON.parse(buffer)); }
        catch { finish(null); }
      });
      client.on('close', () => {
        if (finished) return;
        if (!buffer) return finish(null);
        try { finish(JSON.parse(buffer)); }
        catch { finish(null); }
      });
      client.on('error', () => finish(null));
      client.on('timeout', () => { client.destroy(); finish(null); });
    } catch {
      finish(null);
    }
  });
}

/**
 * Top-level evaluator. Implements the stringency + interview rules from the
 * discipline note's locked decisions.
 *
 * @param {{ filePath: string, after: string, cwd: string }} args
 * @returns {Promise<{ decision: string, message: string, daemonReachable: boolean }>}
 */
export async function evaluateSpecAdherence(args) {
  const cwd = (args && args.cwd) || process.cwd();
  if (!isStringentProject(cwd)) {
    return {
      decision: 'allow',
      message: 'no .git in project root; stringency off',
      daemonReachable: false
    };
  }

  if (!hasWrittenSpec(cwd)) {
    return {
      decision: 'ask',
      message: [
        'SPEC INTERVIEW REQUIRED',
        'No written spec found in this project (no docs/, specs/, or spec-mapping.json).',
        'The user message is the spec. Before writing code:',
        '  1. Restate what you understood from the user in your own words.',
        '  2. Ask the user to confirm or correct the interpretation.',
        '  3. Only then write the code.',
        '',
        'Deliberate is the discipline of slowing down — interview first, write second.'
      ].join('\n'),
      daemonReachable: false
    };
  }

  const reachable = await pingDaemon();
  if (!reachable) {
    return {
      decision: 'block',
      message: [
        'SPEC ADHERENCE FAIL-CLOSED',
        'spec_watcher_daemon is not reachable at ~/.cache/nospec-drift/spec.sock',
        'and this project has .git so stringency is on.',
        '',
        'Either:',
        '  - start the daemon: `python3 ~/.claude/hooks/spec_watcher_daemon.py &`',
        '  - or temporarily relax discipline: `deliberate hooks pause 30m`',
        '',
        'Discipline is on the leash to protect you from drift, not to cage you.'
      ].join('\n'),
      daemonReachable: false
    };
  }

  // Stage 1 — ask the daemon which spec sections apply to this file.
  const projectRoot = findProjectRoot(cwd) || cwd;
  const specsResponse = await callDaemon({
    action: 'get_specs',
    file_path: args.filePath,
    project_root: projectRoot
  });

  if (!specsResponse || typeof specsResponse !== 'object') {
    return {
      decision: 'allow',
      message: 'spec daemon protocol unrecognised; allowing with warning',
      daemonReachable: true,
      specsChecked: 0
    };
  }
  if (specsResponse.error) {
    return {
      decision: 'allow',
      message: `spec daemon error: ${specsResponse.error}; allowing with warning`,
      daemonReachable: true,
      specsChecked: 0
    };
  }

  const specs = Array.isArray(specsResponse.specs) ? specsResponse.specs : [];
  if (specs.length === 0) {
    return {
      decision: 'allow',
      message: `no spec section matches ${path.basename(args.filePath || '')}; nothing to check against`,
      daemonReachable: true,
      specsChecked: 0
    };
  }

  // Stage 2 — call the configured LLM with the drift-check prompt.
  const verdict = await runDriftCheck({
    filePath: args.filePath,
    after: args.after,
    specs
  });

  if (verdict === null) {
    return {
      decision: 'allow',
      message: 'LLM drift check returned no parseable JSON; allowing with warning',
      daemonReachable: true,
      specsChecked: specs.length
    };
  }
  if (verdict && typeof verdict === 'object' && '__error' in verdict) {
    return {
      decision: 'allow',
      message: `LLM unreachable for drift check (${verdict.__error}); allowing with warning`,
      daemonReachable: true,
      specsChecked: specs.length
    };
  }

  if (verdict.drift_detected === true && Array.isArray(verdict.issues) && verdict.issues.length > 0) {
    return {
      decision: 'block',
      message: formatDriftMessage(args.filePath, specs, verdict),
      daemonReachable: true,
      specsChecked: specs.length
    };
  }

  return {
    decision: 'allow',
    message: `spec adherence ok across ${specs.length} matching section(s)`,
    daemonReachable: true,
    specsChecked: specs.length
  };
}

/**
 * Walk up from cwd to find the nearest dir containing `.git`. Falls back to
 * null when not inside a repo (caller substitutes cwd).
 */
export function findProjectRoot(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Build the prompt and call streamChat. Returns the parsed JSON verdict or
 * null if the LLM is unavailable / malformed.
 *
 * Exported so tests can inject a fake streamChat.
 */
export async function runDriftCheck({ filePath, after, specs }, opts = {}) {
  const impl = typeof opts.streamChatImpl === 'function' ? opts.streamChatImpl : streamChat;
  // 120s — large local models (35B class) can take a minute to first token
  // plus another minute to land the full JSON verdict. Default 30s was too
  // tight; users can still override via opts.timeoutMs in tests.
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 120_000;

  const messages = buildDriftMessages(filePath, after, specs);

  let text = '';
  let errorMessage = null;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await impl({
      messages,
      signal: controller.signal,
      // Bumped well above the default 800 — reasoning-style models can emit
      // ~1k tokens of "thinking" before reaching the JSON verdict. Cap at
      // 4096 so even Qwen3-style preamble has room to land the JSON.
      maxTokens: 4096,
      onEvent: (ev) => {
        if (ev && ev.type === 'token' && typeof ev.text === 'string') text += ev.text;
        if (ev && ev.type === 'error') errorMessage = ev.message || 'upstream error';
      }
    });
  } catch (err) {
    errorMessage = err && err.message ? err.message : 'stream threw';
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (errorMessage) return { __error: errorMessage };
  if (!text.trim()) return { __error: 'empty response from LLM' };

  // Extract the JSON block — models sometimes wrap with fences or commentary.
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function buildDriftMessages(filePath, after, specs) {
  const fileName = path.basename(filePath || 'unknown');

  // Cap per-spec content and total payload to keep small local models happy.
  const trimmedSpecs = specs.slice(0, 3).map((spec) => {
    const content = typeof spec.content === 'string' ? spec.content : '';
    const lines = content.split(/\r?\n/);
    return {
      spec_file: spec.spec_file,
      section: spec.section,
      start_line: spec.start_line,
      end_line: spec.end_line,
      content: lines.slice(0, 200).join('\n')  // ~200 lines per section max
    };
  });

  const specContext = trimmedSpecs.map((s) =>
    `### ${s.spec_file} ${s.section} (lines ${s.start_line}-${s.end_line})\n${s.content}`
  ).join('\n\n');

  const codeForAnalysis = typeof after === 'string'
    ? (after.length > 15_000 ? `${after.slice(0, 15_000)}\n\n[...truncated at 15000 chars]` : after)
    : '';

  const system = `You are a spec drift detector. Read the code and the spec sections it must obey, then return a single JSON object describing any violations.

OUTPUT RULES (strict):
- Reply with ONLY the JSON object. No preamble, no reasoning out loud, no markdown fences, no commentary before or after.
- The very first character of your reply must be "{".
- Never invent issues that are not grounded in the supplied spec text.`;

  const user = `SPECIFICATIONS:
${specContext}

CODE BEING WRITTEN TO ${fileName}:
\`\`\`
${codeForAnalysis}
\`\`\`

Check the code against EACH spec requirement. Report ALL violations, not just the first.

Respond ONLY with valid JSON of this shape:
{
  "drift_detected": true | false,
  "issues": [
    {
      "summary": "Brief description of the violation",
      "spec_quote": "Exact quote from spec",
      "spec_line": <line number in spec>,
      "code_line": <line number in code>,
      "code_snippet": "The violating code",
      "recommendation": "How to fix"
    }
  ],
  "confidence": "high" | "medium" | "low"
}

If compliant, return: {"drift_detected": false, "issues": [], "confidence": "high"}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

/**
 * Pull the first balanced top-level JSON object out of a string. Tolerates
 * code fences, leading commentary, and trailing text.
 */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function formatDriftMessage(filePath, specs, verdict) {
  const fileName = path.basename(filePath || 'unknown');
  const lines = [];
  lines.push('SPEC DRIFT DETECTED');
  lines.push(`File: ${fileName}`);
  lines.push(`Checked: ${specs.map((s) => `${s.spec_file}${s.section ? ' ' + s.section : ''}`).join(', ')}`);
  lines.push('');
  for (const issue of verdict.issues.slice(0, 10)) {
    lines.push(`• ${issue.summary || 'drift'}`);
    if (issue.spec_quote) lines.push(`  Spec: "${issue.spec_quote}"${issue.spec_line ? ` (L${issue.spec_line})` : ''}`);
    if (issue.code_snippet) lines.push(`  Code${issue.code_line ? ` (L${issue.code_line})` : ''}: ${issue.code_snippet}`);
    if (issue.recommendation) lines.push(`  → ${issue.recommendation}`);
    lines.push('');
  }
  if (verdict.confidence) lines.push(`Confidence: ${verdict.confidence}`);
  lines.push('');
  lines.push('Either update the code to match the spec, or update the spec and re-run.');
  return lines.join('\n');
}

export default {
  evaluateSpecAdherence,
  isStringentProject,
  hasWrittenSpec,
  pingDaemon,
  callDaemon
};
