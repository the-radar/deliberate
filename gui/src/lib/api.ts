import { get } from "svelte/store";
import { serverBaseUrl, type HookEvent } from "./stores";

function base() {
  return get(serverBaseUrl).replace(/\/+$/, "");
}

function stableEventId(ev: any, idx: number) {
  const ts = typeof ev.timestamp === "string" ? ev.timestamp : "";
  const cmd = typeof ev.data?.command === "string" ? ev.data.command : "";
  return `${ts}:${ev.sessionId}:${idx}:${cmd.slice(0, 64)}`;
}

export async function fetchConfig() {
  const res = await fetch(`${base()}/api/config`);
  if (!res.ok) throw new Error(`Config fetch failed (${res.status})`);
  return res.json();
}

export async function patchConfig(patch: any) {
  const res = await fetch(`${base()}/api/config`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Config patch failed (${res.status})`);
  return res.json();
}

export async function addSkip(command: string) {
  const res = await fetch(`${base()}/api/config/skip`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command }),
  });
  if (!res.ok) throw new Error(`Skip update failed (${res.status})`);
  return res.json();
}

export async function addBlock(patternOrCommand: string) {
  const res = await fetch(`${base()}/api/config/block`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: patternOrCommand }),
  });
  if (!res.ok) throw new Error(`Block update failed (${res.status})`);
  return res.json();
}

export async function backfillSession(sessionId: string): Promise<HookEvent[]> {
  const res = await fetch(`${base()}/api/session/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(`Backfill failed (${res.status})`);
  const json = await res.json();
  const events = Array.isArray(json.events) ? json.events : [];
  return events.map((ev: any, i: number) => ({ ...ev, _id: stableEventId(ev, i) }));
}

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function streamChat(opts: {
  context: any;
  messages: ChatMessage[];
  onToken: (text: string) => void;
  onError: (msg: string) => void;
  onDone: () => void;
}) {
  const controller = new AbortController();

  const res = await fetch(`${base()}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: opts.context, messages: opts.messages }),
    signal: controller.signal,
  });

  if (!res.ok || !res.body) {
    opts.onError(`Chat request failed (${res.status})`);
    opts.onDone();
    return { abort: () => controller.abort() };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const emit = (line: string) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice("data:".length).trim();
    if (!raw) return;
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed.type === "token" && typeof parsed.text === "string") {
      opts.onToken(parsed.text);
    }
    if (parsed.type === "done") {
      opts.onDone();
    }
    if (parsed.type === "error") {
      opts.onError(parsed.message || "Chat error");
    }
  };

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trimEnd();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          emit(line);
        }
      }
    } catch (e: any) {
      if (!controller.signal.aborted) {
        opts.onError(e?.message || "Chat stream failed");
      }
    } finally {
      opts.onDone();
    }
  })();

  return { abort: () => controller.abort() };
}

