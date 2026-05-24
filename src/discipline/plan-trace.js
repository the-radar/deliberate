/**
 * Plan-trace enforcement (PostToolUse on Write|Edit|MultiEdit).
 *
 * The AelosX note's contract: every NEW function/component/class definition
 * in a code file must carry a comment of shape
 *     // Plan: <doc>§"<section>" · Issue: #<N>
 * adjacent to it. Missing trace -> hard block the tool call.
 *
 * Scope:
 *   - Only fires on extensions in CODE_EXTENSIONS (skip css/json/md/etc.)
 *   - Only fires on NEW top-level definitions (function declarations,
 *     class declarations, exported `const Foo = ...` / `function Foo` /
 *     React-style `Foo = (props) => ...`).
 *   - "Adjacent" means within 3 lines above the definition.
 *
 * Returns:
 *   { decision: 'allow' | 'block', message: string, missing: string[] }
 *
 * Pure module — caller wires the diff + invocation context.
 */

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift'
]);

// Patterns that count as a "new top-level definition" in JS/TS/Python/etc.
// Conservatively scoped: capture group 1 is the symbol name.
const DEFINITION_PATTERNS = [
  // export function Foo(...)  /  function Foo(...)
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Z_$a-z][\w$]*)\s*\(/,
  // export class Foo  /  class Foo
  /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Z_$a-z][\w$]*)\b/,
  // export const Foo = (...) =>  /  const Foo = function(...)
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Z][\w$]*)\s*=\s*(?:\([^)]*\)|function\b|async\b)/,
  // Python: def foo / def Foo(
  /^\s*def\s+([A-Za-z_]\w*)\s*\(/,
  // Python: class Foo
  /^\s*class\s+([A-Za-z_]\w*)\b/
];

// Trace comment shape. Both doc + issue required per locked decision.
// Captures (1)=doc, (2)=section, (3)=issue number.
const TRACE_PATTERN = /(?:\/\/|#)\s*Plan:\s*([^\s§]+)\s*§\s*"([^"]+)"\s*·\s*Issue:\s*#(\d+)/;

const ADJACENCY_LINES = 3;

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isCodeFile(filePath) {
  if (typeof filePath !== 'string') return false;
  const lower = filePath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return CODE_EXTENSIONS.has(lower.slice(dot));
}

/**
 * Find every line that starts a new definition in the supplied source.
 *
 * @param {string} source
 * @returns {{ line: number, name: string }[]}
 */
export function findDefinitions(source) {
  if (typeof source !== 'string' || source.length === 0) return [];
  const lines = source.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (const pattern of DEFINITION_PATTERNS) {
      const m = lines[i].match(pattern);
      if (m) {
        out.push({ line: i + 1, name: m[1] });
        break;
      }
    }
  }
  return out;
}

/**
 * Does any line within `[def.line - ADJACENCY_LINES, def.line - 1]` carry a
 * valid trace comment?
 *
 * @param {string[]} lines
 * @param {{ line: number, name: string }} def
 * @returns {boolean}
 */
export function hasAdjacentTrace(lines, def) {
  const start = Math.max(0, def.line - 1 - ADJACENCY_LINES);
  const end = def.line - 1;
  for (let i = start; i < end; i += 1) {
    if (TRACE_PATTERN.test(lines[i] || '')) return true;
  }
  // Allow the trace on the SAME line (for one-liners) too.
  if (TRACE_PATTERN.test(lines[def.line - 1] || '')) return true;
  return false;
}

/**
 * Evaluate one Write/Edit/MultiEdit tool call.
 *
 * Inputs:
 *   filePath: target path
 *   before:   prior file contents (empty string for Write of a new file)
 *   after:    post-write contents
 *
 * Output:
 *   { decision: 'allow' | 'block', message: string, missing: {line,name}[] }
 *
 * @param {{ filePath: string, before?: string, after: string }} args
 * @returns {{ decision: string, message: string, missing: object[] }}
 */
export function evaluatePlanTrace(args) {
  const filePath = args && args.filePath;
  const after = (args && typeof args.after === 'string') ? args.after : '';
  const before = (args && typeof args.before === 'string') ? args.before : '';

  if (!isCodeFile(filePath)) {
    return { decision: 'allow', message: 'non-code file; skipped', missing: [] };
  }

  const prevDefs = new Set(findDefinitions(before).map((d) => d.name));
  const nextDefs = findDefinitions(after);
  const added = nextDefs.filter((d) => !prevDefs.has(d.name));

  if (added.length === 0) {
    return { decision: 'allow', message: 'no new definitions', missing: [] };
  }

  const afterLines = after.split(/\r?\n/);
  const missing = added.filter((def) => !hasAdjacentTrace(afterLines, def));

  if (missing.length === 0) {
    return { decision: 'allow', message: 'plan-trace present on all new definitions', missing: [] };
  }

  const list = missing.map((d) => `  - line ${d.line}: ${d.name}`).join('\n');
  const message = [
    'PLAN-TRACE MISSING',
    `File: ${filePath}`,
    'New definitions without a plan-trace comment adjacent to them:',
    list,
    '',
    'Required form (one of these, within 3 lines above the definition):',
    '  // Plan: docs/plans/<name>.md§"<section title>" · Issue: #<N>',
    '  # Plan: docs/plans/<name>.md§"<section title>" · Issue: #<N>',
    '',
    'Each new function/component/class must trace back to a plan section AND an issue number.'
  ].join('\n');

  return { decision: 'block', message, missing };
}

export default { evaluatePlanTrace, isCodeFile, findDefinitions, hasAdjacentTrace };
