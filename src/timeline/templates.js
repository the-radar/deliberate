/**
 * Per-command-type templates for the prose timeline.
 *
 * Two roles:
 *   1. Observe mode reads template strings directly to produce a static prose
 *      timeline with no LLM call.
 *   2. Teach mode passes template "hints" to the LLM as input alongside the
 *      raw events; the LLM weaves the hints into a single voice (issue #2).
 *
 * Templates are matched by an ordered list of `{match, label, line, hint}`
 * rules. First rule whose `match` returns truthy wins. Match runs against the
 * raw command string for Bash events, or against the tool name for other
 * event types.
 */

/**
 * @typedef {object} TemplateRule
 * @property {(input: { command?: string, tool?: string, event?: any }) => boolean} match
 * @property {string} label        short label for the event (e.g. "read file")
 * @property {(input: { command?: string, tool?: string, event?: any }) => string} line
 * @property {string} [hint]       teaching point passed to the LLM in teach mode
 */

/** @type {TemplateRule[]} */
export const DEFAULT_TEMPLATES = [
  {
    match: ({ command }) => /^\s*cat\s+/.test(command || ''),
    label: 'read file',
    line: ({ command }) => `Claude read ${describeArg(command, /^\s*cat\s+(\S+)/)}.`,
    hint: 'Reading a file is reconnaissance; it usually precedes an edit and tells you what context Claude is building.'
  },
  {
    match: ({ command }) => /^\s*ls(\s|$)/.test(command || ''),
    label: 'list directory',
    line: ({ command }) => `Claude listed ${describeArg(command, /^\s*ls\s+(\S+)/) || 'the working directory'}.`,
    hint: 'Listing a directory is orientation — what files exist before deciding what to touch.'
  },
  {
    match: ({ command }) => /^\s*git\s+status/.test(command || ''),
    label: 'check git status',
    line: () => 'Claude checked the git status to see what was already modified.',
    hint: 'A status check before an edit suggests Claude wants to avoid stepping on uncommitted work.'
  },
  {
    match: ({ command }) => /^\s*git\s+diff/.test(command || ''),
    label: 'inspect git diff',
    line: () => 'Claude inspected the current git diff.',
    hint: 'Reading the diff before changing more is how Claude confirms what it already changed.'
  },
  {
    match: ({ command }) => /^\s*git\s+log/.test(command || ''),
    label: 'review git log',
    line: () => 'Claude scanned the git log for recent history.',
    hint: 'Recent commits tell Claude the style and cadence of the repo.'
  },
  {
    match: ({ command }) => /^\s*rm\s+-rf?/.test(command || ''),
    label: 'recursive delete',
    line: ({ command }) => `Claude removed ${describeArg(command, /^\s*rm\s+-rf?\s+(\S+)/) || 'something'} recursively.`,
    hint: 'Recursive deletes are always flagged because a wrong path can erase real work; check the target.'
  },
  {
    match: ({ command }) => /^\s*npm\s+(install|i|ci)\b/.test(command || ''),
    label: 'npm install',
    line: () => 'Claude installed npm dependencies.',
    hint: 'Installing dependencies runs lifecycle scripts in every package — the risk lives in transitive supply chain, not the command itself.'
  },
  {
    match: ({ command }) => /^\s*pnpm\s+(install|i|add)\b/.test(command || ''),
    label: 'pnpm install',
    line: () => 'Claude installed pnpm dependencies.',
    hint: 'pnpm install resolves the whole workspace graph; one bad transitive can pull in lifecycle scripts you did not opt into.'
  },
  {
    match: ({ command }) => /^\s*(npm|pnpm|yarn)\s+(run|test|build)\b/.test(command || ''),
    label: 'run script',
    line: ({ command }) => `Claude ran ${(command || '').trim().split(/\s+/).slice(0, 3).join(' ')}.`,
    hint: 'A package script just executes whatever the package.json author wrote — it can do anything the user can do.'
  },
  {
    match: ({ command }) => /^\s*(git\s+push|git\s+commit)/.test(command || ''),
    label: 'git write',
    line: ({ command }) => `Claude ran \`${(command || '').trim()}\`.`,
    hint: 'Write-side git commands change shared state; a force-push or a wrong-branch commit is the usual incident pattern.'
  },
  {
    match: ({ tool }) => tool === 'Read',
    label: 'read file',
    line: ({ event }) => `Claude read ${shortPath(event?.data?.file_path)}.`,
    hint: 'Reading a file is reconnaissance; it usually precedes an edit.'
  },
  {
    match: ({ tool }) => tool === 'Edit' || tool === 'MultiEdit',
    label: 'edit file',
    line: ({ event }) => `Claude edited ${shortPath(event?.data?.file_path)}.`,
    hint: 'An edit is the substantive change — the surrounding reads explain what context Claude used to write it.'
  },
  {
    match: ({ tool }) => tool === 'Write',
    label: 'write file',
    line: ({ event }) => `Claude wrote a new file at ${shortPath(event?.data?.file_path)}.`,
    hint: 'A fresh Write means there was no prior file to read — Claude is creating, not modifying.'
  }
];

function describeArg(command, regex) {
  if (typeof command !== 'string') return '';
  const match = command.match(regex);
  return match ? match[1] : '';
}

function shortPath(p) {
  if (typeof p !== 'string' || !p) return 'a file';
  const parts = p.split('/');
  return parts.length <= 3 ? p : `…/${parts.slice(-2).join('/')}`;
}

/**
 * Look up the first matching template for an event.
 *
 * @param {object} event raw timeline event
 * @param {TemplateRule[]} [rules]
 * @returns {{ rule: TemplateRule, line: string, hint?: string } | null}
 */
export function resolveTemplate(event, rules = DEFAULT_TEMPLATES) {
  if (!event || typeof event !== 'object') return null;
  const data = event.data || {};
  const command = typeof data.command === 'string' ? data.command : undefined;
  const tool = typeof data.tool === 'string' ? data.tool : (event.type || undefined);
  const input = { command, tool, event };
  for (const rule of rules) {
    try {
      if (rule.match(input)) {
        return { rule, line: rule.line(input), hint: rule.hint };
      }
    } catch {
      // Defensive: a single broken rule must not poison the lookup.
      continue;
    }
  }
  return null;
}

/**
 * Collect distinct teaching hints from a cluster's events. Used as input
 * to the LLM prompt in teach mode (issue #2).
 *
 * @param {object[]} events
 * @param {TemplateRule[]} [rules]
 * @returns {string[]}
 */
export function teachingHintsFor(events, rules = DEFAULT_TEMPLATES) {
  const seen = new Set();
  const out = [];
  for (const event of events || []) {
    const resolved = resolveTemplate(event, rules);
    if (!resolved || !resolved.hint) continue;
    if (seen.has(resolved.hint)) continue;
    seen.add(resolved.hint);
    out.push(resolved.hint);
  }
  return out;
}

export default { DEFAULT_TEMPLATES, resolveTemplate, teachingHintsFor };
