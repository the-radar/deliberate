import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readState, writeState, pauseFor, bypassHook, unbypassHook,
  isEnabled, parseDuration
} from '../src/discipline/state.js';
import { recordAudit, readAudit } from '../src/discipline/audit.js';
import {
  evaluatePlanTrace, isCodeFile, findDefinitions, hasAdjacentTrace
} from '../src/discipline/plan-trace.js';

function mkdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deliberate-discipline-'));
}

test('readState returns defaults when state file is absent', () => {
  const dir = mkdir();
  const s = readState({ dir });
  assert.equal(s.state, 'strict');
  assert.equal(s.pauseUntil, null);
  assert.deepEqual(s.bypass, []);
});

test('writeState persists, normalizes, and audits', () => {
  const dir = mkdir();
  writeState({ state: 'loose', pauseUntil: null, bypass: ['spec-adherence'] }, { dir, reason: 'unit test' });
  const persisted = readState({ dir });
  assert.equal(persisted.state, 'loose');
  assert.deepEqual(persisted.bypass, ['spec-adherence']);

  const audit = readAudit({ dir });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'set_state');
  assert.equal(audit[0].reason, 'unit test');
});

test('writeState rejects unknown state strings via normalize', () => {
  const dir = mkdir();
  writeState({ state: 'garbage' }, { dir });
  assert.equal(readState({ dir }).state, 'strict', 'unknown state must fall back to default');
});

test('isEnabled flips off when state=off', () => {
  const dir = mkdir();
  writeState({ state: 'off' }, { dir });
  const r = isEnabled('plan-trace', { dir });
  assert.equal(r.enabled, false);
  assert.match(r.reason, /off/);
});

test('isEnabled flips off while pauseUntil is in the future and back on after', () => {
  const dir = mkdir();
  const future = new Date(Date.now() + 60_000).toISOString();
  writeState({ state: 'strict', pauseUntil: future }, { dir });
  assert.equal(isEnabled('plan-trace', { dir }).enabled, false);
  // Simulate clock moving past the pause window.
  const past = new Date(Date.now() - 60_000).toISOString();
  writeState({ state: 'strict', pauseUntil: past }, { dir });
  assert.equal(isEnabled('plan-trace', { dir }).enabled, true);
});

test('bypassHook + unbypassHook round-trips', () => {
  const dir = mkdir();
  bypassHook('anxiety', { dir });
  assert.equal(isEnabled('anxiety', { dir }).enabled, false);
  assert.equal(isEnabled('plan-trace', { dir }).enabled, true);
  unbypassHook('anxiety', { dir });
  assert.equal(isEnabled('anxiety', { dir }).enabled, true);
});

test('pauseFor parses duration and sets pauseUntil', () => {
  const dir = mkdir();
  const persisted = pauseFor('30s', { dir });
  assert.ok(persisted.pauseUntil);
  const delta = Date.parse(persisted.pauseUntil) - Date.now();
  assert.ok(delta > 25_000 && delta < 35_000, `pauseUntil delta out of range: ${delta}ms`);
});

test('parseDuration handles s/m/h/d and rejects garbage', () => {
  assert.equal(parseDuration('60s'), 60_000);
  assert.equal(parseDuration('60m'), 3_600_000);
  assert.equal(parseDuration('2h'), 7_200_000);
  assert.equal(parseDuration('1d'), 86_400_000);
  assert.equal(parseDuration('garbage'), null);
  assert.equal(parseDuration(''), null);
});

test('recordAudit + readAudit appends and reads', () => {
  const dir = mkdir();
  recordAudit({ action: 'test', detail: 'a' }, { dir });
  recordAudit({ action: 'test', detail: 'b' }, { dir });
  const log = readAudit({ dir });
  assert.equal(log.length, 2);
  assert.equal(log[1].detail, 'b');
});

// ----- plan-trace -----

test('isCodeFile recognizes common code extensions and rejects others', () => {
  assert.ok(isCodeFile('src/foo.ts'));
  assert.ok(isCodeFile('hooks/bar.py'));
  assert.ok(!isCodeFile('docs/notes.md'));
  assert.ok(!isCodeFile('style.css'));
  assert.ok(!isCodeFile('no-extension'));
});

test('findDefinitions picks up function, class, const-arrow, python def/class', () => {
  const src = [
    'function foo() {}',
    'export class Bar {}',
    'export const Baz = (x) => x;',
    'def my_func(x):',
    '  return x',
    'class Quux:',
    '  pass'
  ].join('\n');
  const defs = findDefinitions(src).map((d) => d.name);
  assert.deepEqual(defs, ['foo', 'Bar', 'Baz', 'my_func', 'Quux']);
});

test('evaluatePlanTrace allows when no new definitions added', () => {
  const r = evaluatePlanTrace({
    filePath: 'src/foo.ts',
    before: 'function existing() {}\n',
    after: 'function existing() { return 1; }\n'  // same name; not "new"
  });
  assert.equal(r.decision, 'allow');
});

test('evaluatePlanTrace blocks a new function without a trace comment', () => {
  const r = evaluatePlanTrace({
    filePath: 'src/foo.ts',
    before: '',
    after: 'export function freshThing() { return 1; }\n'
  });
  assert.equal(r.decision, 'block');
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].name, 'freshThing');
  assert.match(r.message, /PLAN-TRACE MISSING/);
});

test('evaluatePlanTrace allows a new function with adjacent trace comment', () => {
  const after = [
    '// Plan: docs/plans/auth.md§"login-flow" · Issue: #42',
    'export function freshThing() { return 1; }',
    ''
  ].join('\n');
  const r = evaluatePlanTrace({ filePath: 'src/foo.ts', before: '', after });
  assert.equal(r.decision, 'allow');
});

test('evaluatePlanTrace allows Python trace style with # prefix', () => {
  const after = [
    '# Plan: docs/plans/api.md§"v2-endpoint" · Issue: #99',
    'def fresh_handler(req):',
    '    return req',
    ''
  ].join('\n');
  const r = evaluatePlanTrace({ filePath: 'src/api.py', before: '', after });
  assert.equal(r.decision, 'allow');
});

test('evaluatePlanTrace skips non-code files entirely', () => {
  const r = evaluatePlanTrace({
    filePath: 'docs/notes.md',
    before: '',
    after: 'function neverChecked() {}'  // would otherwise block
  });
  assert.equal(r.decision, 'allow');
  assert.match(r.message, /non-code/);
});

test('hasAdjacentTrace requires the trace within 3 lines above', () => {
  const src = [
    '// Plan: docs/p.md§"x" · Issue: #1',  // line 1
    '',                                     // 2
    '',                                     // 3
    '',                                     // 4 — too far
    'function farAway() {}'                 // 5
  ].join('\n');
  const def = { line: 5, name: 'farAway' };
  assert.equal(hasAdjacentTrace(src.split('\n'), def), false);
});
