import test from 'node:test';
import assert from 'node:assert/strict';

import { clusterEvents } from '../src/timeline/cluster.js';
import { resolveTemplate, teachingHintsFor } from '../src/timeline/templates.js';
import { renderCluster, renderObserveTimeline } from '../src/timeline/observe-render.js';

const baseTs = Date.parse('2026-05-22T18:00:00Z');

function makeEvent(offsetSec, payload = {}) {
  return {
    type: 'command_analyzed',
    sessionId: payload.sessionId || 'session-a',
    timestamp: new Date(baseTs + offsetSec * 1000).toISOString(),
    data: payload.data || {}
  };
}

test('clusterEvents groups events within an 8s gap', () => {
  const events = [
    makeEvent(0,  { data: { command: 'ls' } }),
    makeEvent(2,  { data: { command: 'cat README.md' } }),
    makeEvent(4,  { data: { command: 'git status' } }),
    makeEvent(20, { data: { command: 'npm test' } })  // >8s gap → new cluster
  ];

  const clusters = clusterEvents(events);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].events.length, 3);
  assert.equal(clusters[1].events.length, 1);
});

test('clusterEvents splits when session id changes', () => {
  const events = [
    makeEvent(0, { sessionId: 'a', data: { command: 'ls' } }),
    makeEvent(1, { sessionId: 'b', data: { command: 'pwd' } })
  ];
  const clusters = clusterEvents(events);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].sessionId, 'a');
  assert.equal(clusters[1].sessionId, 'b');
});

test('clusterEvents caps a single cluster at maxEventsPerCluster', () => {
  const events = Array.from({ length: 20 }, (_, i) =>
    makeEvent(i * 0.5, { data: { command: `echo ${i}` } })
  );
  const clusters = clusterEvents(events, { maxEventsPerCluster: 5 });
  assert.ok(clusters.length >= 4, 'must split a 20-event burst into ≥4 clusters at cap 5');
  for (const c of clusters) assert.ok(c.events.length <= 5);
});

test('resolveTemplate matches cat/ls/rm -rf patterns and emits hints', () => {
  const cat = resolveTemplate(makeEvent(0, { data: { command: 'cat package.json' } }));
  assert.match(cat.line, /read package\.json/);
  assert.match(cat.hint, /reconnaissance/i);

  const rm = resolveTemplate(makeEvent(0, { data: { command: 'rm -rf /tmp/scratch' } }));
  assert.match(rm.line, /removed.*recursively/i);
  assert.match(rm.hint, /flagged/i);
});

test('teachingHintsFor dedupes hints across a cluster', () => {
  const cluster = [
    makeEvent(0, { data: { command: 'cat a.md' } }),
    makeEvent(1, { data: { command: 'cat b.md' } }),
    makeEvent(2, { data: { command: 'ls' } })
  ];
  const hints = teachingHintsFor(cluster);
  // cat appears twice but its hint should only appear once.
  assert.equal(new Set(hints).size, hints.length);
  assert.ok(hints.length >= 2 && hints.length <= 3);
});

test('renderCluster produces divider + prose + raw lines, no table', () => {
  const cluster = {
    startMs: baseTs,
    endMs: baseTs + 4000,
    sessionId: 'session-a',
    events: [
      makeEvent(0, { data: { command: 'ls' } }),
      makeEvent(2, { data: { command: 'cat README.md' } })
    ]
  };
  const rendered = renderCluster(cluster);
  assert.match(rendered, /^── \d{2}:\d{2}/, 'starts with a timestamped divider');
  assert.match(rendered, /Claude (listed|read)/);
  assert.match(rendered, /  ls/);
  assert.match(rendered, /  cat README\.md/);
});

test('renderCluster marks HIGH-risk raw lines with ⚠ prefix', () => {
  const cluster = {
    startMs: baseTs,
    endMs: baseTs,
    sessionId: 'session-a',
    events: [
      makeEvent(0, { data: { command: 'rm -rf /tmp/x', risk: 'HIGH' } })
    ]
  };
  const rendered = renderCluster(cluster);
  assert.match(rendered, /⚠ rm -rf/);
});

test('renderObserveTimeline returns placeholder when no events', () => {
  assert.match(renderObserveTimeline([]), /no events yet/i);
});

test('renderObserveTimeline contains no table column separators', () => {
  const events = [
    makeEvent(0, { data: { command: 'ls' } }),
    makeEvent(1, { data: { command: 'cat x' } })
  ];
  const rendered = renderObserveTimeline(clusterEvents(events));
  // The legacy table used '│' as a column separator. Prose timeline must not.
  assert.ok(!rendered.includes('│'), 'no table separators allowed in observe output');
});
