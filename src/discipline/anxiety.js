/**
 * Issues-loop anxiety injector (UserPromptSubmit hook).
 *
 * Re-states the issues-loop discipline at the top of every Claude Code prompt
 * so the agent does not drift off the loop between turns. Pure string — no
 * LLM call. Output goes back to Claude Code as `additionalContext`.
 *
 * Default message is intentionally short and verb-shaped (per the AelosX note's
 * "verify behavior, not mechanism" criticism). It can be overridden via
 * `~/.deliberate/discipline-anxiety.txt` if the user wants project-specific
 * wording.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_MESSAGE = [
  'Issues-loop discipline (deliberate-anxiety):',
  '- Close an issue only when reality matches its expected result.',
  '- Tests passing is not closure. Run the system, read the output, compare.',
  '- New tangential discoveries become NEW issues, not silent fixes inside the current one.',
  '- Backlog hits zero is the finish line.',
  '- "Done" requires fresh command output IN THIS MESSAGE — re-greps of source do not count.'
].join('\n');

const OVERRIDE_PATH = path.join(os.homedir(), '.deliberate', 'discipline-anxiety.txt');

/**
 * Resolve the message to inject. Returns DEFAULT_MESSAGE unless a non-empty
 * override file exists.
 *
 * @returns {string}
 */
export function anxietyMessage() {
  try {
    if (fs.existsSync(OVERRIDE_PATH)) {
      const body = fs.readFileSync(OVERRIDE_PATH, 'utf8').trim();
      if (body.length > 0) return body;
    }
  } catch { /* best-effort */ }
  return DEFAULT_MESSAGE;
}

export default { anxietyMessage };
