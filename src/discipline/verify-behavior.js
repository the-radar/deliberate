/**
 * Verify-behavior reminder (Stop hook).
 *
 * Per the discipline note's "verify experience, not mechanism" lesson, this Stop
 * hook injects an iron-law reminder when the agent is about to claim done.
 * No LLM call — the reminder is the discipline.
 *
 * Output goes back to Claude Code as `additionalContext` so the next turn
 * (if any) sees it. The contract is "if you cannot show fresh command output
 * in this same message, you cannot claim done."
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_MESSAGE = [
  'Verify-behavior gate (deliberate):',
  '- Before you claim done, show the COMMAND OUTPUT that proves the experience works.',
  '- Mechanism passing (tsc clean, tests green, attribute toggled) is NOT proof of experience.',
  '- Read what the user sees / what the system actually produces, not what the source code says.',
  '- If you have not run anything fresh in this turn, you cannot claim done.',
  '- Stale evidence (an earlier-turn log line) is not fresh evidence.'
].join('\n');

const OVERRIDE_PATH = path.join(os.homedir(), '.deliberate', 'discipline-verify-behavior.txt');

export function verifyBehaviorMessage() {
  try {
    if (fs.existsSync(OVERRIDE_PATH)) {
      const body = fs.readFileSync(OVERRIDE_PATH, 'utf8').trim();
      if (body.length > 0) return body;
    }
  } catch { /* best-effort */ }
  return DEFAULT_MESSAGE;
}

export default { verifyBehaviorMessage };
