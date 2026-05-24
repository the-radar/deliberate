/**
 * Hook-evaluator entry. Reads a Claude Code hook payload from stdin, runs the
 * named discipline check against it, prints a JSON response to stdout, and
 * exits with the right code.
 *
 * Called from `deliberate hooks eval --kind=<kind>` (which the Python wrapper
 * scripts in hooks/ invoke). Keeping all discipline logic in one entry point
 * means there's one place to honour the kill-switch, one place to audit
 * decisions, and one place to log.
 *
 * Output shape mirrors Claude Code's hook response convention:
 *   {
 *     "decision": "allow" | "block" | "ask",
 *     "permissionDecision": same,
 *     "reason": string,           // human-readable
 *     "hookSpecificOutput": {
 *       "hookEventName": "...",
 *       "additionalContext": "..."  // for UserPromptSubmit / Stop
 *     }
 *   }
 */

import fs from 'fs';

import { isEnabled, readState } from './state.js';
import { recordAudit } from './audit.js';
import { evaluatePlanTrace } from './plan-trace.js';
import { anxietyMessage } from './anxiety.js';
import { verifyBehaviorMessage } from './verify-behavior.js';
import { evaluateSpecAdherence } from './spec-adherence.js';

const KIND_TO_HOOK_ID = Object.freeze({
  'plan-trace': 'plan-trace',
  'spec-adherence': 'spec-adherence',
  anxiety: 'anxiety',
  'verify-behavior': 'verify-behavior'
});

function readStdin() {
  // Sync read avoids the race where stdin data arrives before async listeners
  // attach (Commander's lazy import path can lose the first chunk otherwise).
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function emit(payload, { exitCode = 0 } = {}) {
  process.stdout.write(JSON.stringify(payload));
  // Force-exit instead of relying on process.exitCode — commander's .parse()
  // does not await async actions, so the natural-exit code can race to 0.
  // Claude Code reads the exit code as the hook verdict, so this MUST be
  // deterministic.
  process.exit(exitCode);
}

/**
 * Main entry. `kind` selects which discipline check runs.
 *
 * @param {string} kind
 */
export async function runHookEval(kind) {
  const hookId = KIND_TO_HOOK_ID[kind];
  if (!hookId) {
    emit({ decision: 'allow', reason: `unknown kind: ${kind}` });
    return;
  }

  // Kill-switch check happens first. If discipline is off / paused / bypassed,
  // we allow unconditionally and audit the bypass.
  const gate = isEnabled(hookId);
  if (!gate.enabled) {
    recordAudit({ action: 'hook_skipped', hookId, reason: gate.reason });
    emit({
      decision: 'allow',
      permissionDecision: 'allow',
      reason: `discipline ${gate.reason}; ${hookId} skipped`
    });
    return;
  }

  // Parse the Claude Code hook payload from stdin (best-effort).
  const raw = readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }

  let result;
  try {
    if (hookId === 'plan-trace') {
      const filePath = payload?.tool_input?.file_path || payload?.tool_input?.filePath || '';
      const after = payload?.tool_input?.content
                 ?? payload?.tool_input?.new_string
                 ?? '';
      const before = payload?.tool_input?.old_string ?? '';
      result = evaluatePlanTrace({ filePath, before, after });
    } else if (hookId === 'anxiety') {
      result = {
        decision: 'allow',
        message: anxietyMessage(),
        kind: 'context-inject'
      };
    } else if (hookId === 'verify-behavior') {
      result = {
        decision: 'allow',
        message: verifyBehaviorMessage(),
        kind: 'context-inject'
      };
    } else if (hookId === 'spec-adherence') {
      const filePath = payload?.tool_input?.file_path || payload?.tool_input?.filePath || '';
      const after = payload?.tool_input?.content ?? payload?.tool_input?.new_string ?? '';
      const cwd = payload?.cwd || process.cwd();
      result = await evaluateSpecAdherence({ filePath, after, cwd });
    } else {
      result = { decision: 'allow', message: `unhandled kind ${hookId}` };
    }
  } catch (err) {
    // Fail-open on internal errors so a deliberate bug never bricks the user.
    recordAudit({ action: 'hook_error', hookId, error: String(err && err.message || err) });
    emit({ decision: 'allow', reason: `internal error: ${err && err.message}` });
    return;
  }

  recordAudit({
    action: 'hook_decision',
    hookId,
    decision: result.decision,
    file: payload?.tool_input?.file_path || null
  });

  const response = {
    decision: result.decision,
    permissionDecision: result.decision === 'block' ? 'deny'
                      : result.decision === 'ask' ? 'ask'
                      : 'allow',
    reason: result.message || ''
  };

  if (result.kind === 'context-inject') {
    response.hookSpecificOutput = {
      hookEventName: hookId === 'anxiety' ? 'UserPromptSubmit' : 'Stop',
      additionalContext: result.message
    };
  }

  // Loose mode downgrades all blocks to advisory.
  const state = readState();
  if (state.state === 'loose' && response.decision === 'block') {
    response.decision = 'allow';
    response.permissionDecision = 'allow';
    response.reason = `[loose mode] WOULD BLOCK: ${response.reason}`;
  }

  emit(response, { exitCode: response.decision === 'block' ? 2 : 0 });
}

export default { runHookEval };
