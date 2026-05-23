/**
 * LLM-backed prose generator for teach / block+teach modes.
 *
 * Takes one cluster of timeline events plus the deduped teaching hints
 * surfaced by templates.js, builds a system+user prompt, and calls the
 * configured OpenAI-compatible endpoint via streamChat. The output is a
 * single short paragraph that weaves the teaching hints into the
 * narrative — no headers, no labels, no separate "WHY" / "📖" blocks.
 *
 * This module is intentionally separate from the renderer so:
 *   - observe mode never imports it (zero outbound network in observe).
 *   - teach mode can swap providers per the bring-your-own contract (#3).
 *   - tests can mock streamChat without touching blessed / TTY.
 */

import { streamChat } from '../chat-client.js';
import { teachingHintsFor } from './templates.js';

const SYSTEM_PROMPT = `You are a senior engineer narrating an agentic coding session to a teammate. \
Write one short paragraph (2-4 sentences) describing what happened in the cluster of events. \
Weave the supplied teaching hints into the narrative — do not label them, do not introduce them with \
"because", do not add headers or bullets. Use plain English a teammate would understand. \
Be specific about file names and commands when they matter. Never invent events that are not in the input.`;

function summarizeEvent(event) {
  const data = (event && event.data) || {};
  if (typeof data.command === 'string') return `bash: ${data.command}`;
  const tool = typeof data.tool === 'string' ? data.tool : (event && event.type) || 'event';
  if (typeof data.file_path === 'string') return `${tool}: ${data.file_path}`;
  return tool;
}

function buildUserPrompt(cluster) {
  const lines = (cluster && Array.isArray(cluster.events) ? cluster.events : []).map(summarizeEvent);
  const hints = teachingHintsFor(cluster && cluster.events);
  const parts = [];
  parts.push('Events in this cluster (chronological):');
  for (const line of lines) parts.push(`  - ${line}`);
  if (hints.length > 0) {
    parts.push('');
    parts.push('Teaching hints to weave into the narrative (never label, never quote):');
    for (const hint of hints) parts.push(`  - ${hint}`);
  }
  parts.push('');
  parts.push('Output: one paragraph, 2-4 sentences. No preamble.');
  return parts.join('\n');
}

/**
 * Generate prose for a single cluster. Resolves with the assembled text on
 * success, or `null` if the LLM is unreachable / misconfigured (caller can
 * fall back to the static observe renderer).
 *
 * Accepts an optional `streamChatImpl` for testability — tests pass a mock
 * that does not touch the network.
 *
 * @param {{ events: any[] }} cluster
 * @param {{
 *   timeoutMs?: number,
 *   streamChatImpl?: (args: any) => Promise<void>
 * }} [opts]
 * @returns {Promise<string | null>}
 */
export async function renderClusterWithLLM(cluster, opts = {}) {
  if (!cluster || !Array.isArray(cluster.events) || cluster.events.length === 0) return null;
  const impl = typeof opts.streamChatImpl === 'function' ? opts.streamChatImpl : streamChat;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 20_000;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(cluster) }
  ];

  let text = '';
  let errored = false;
  const events = [];

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await impl({
      messages,
      signal: controller.signal,
      onEvent: (ev) => {
        events.push(ev);
        if (ev && ev.type === 'token' && typeof ev.text === 'string') text += ev.text;
        if (ev && ev.type === 'error') errored = true;
      }
    });
  } catch {
    errored = true;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (errored || !text.trim()) return null;
  return text.trim();
}

export const __testing__ = { buildUserPrompt };

export default { renderClusterWithLLM };
