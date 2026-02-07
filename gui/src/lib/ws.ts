import { get } from "svelte/store";
import {
  allEvents,
  connection,
  selectedSessionId,
  serverBaseUrl,
  ALL_SESSIONS,
  type HookEvent,
} from "./stores";
import { backfillSession } from "./api";

function makeWsUrl(baseUrl: string) {
  // Accept http(s)://host:port, or ws(s)://host:port.
  try {
    const url = new URL(baseUrl);
    const proto = url.protocol === "https:" ? "wss:" : "ws:";
    url.protocol = proto;
    url.pathname = "/ws";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "ws://localhost:8765/ws";
  }
}

function stableEventId(ev: Omit<HookEvent, "_id">, counter: number) {
  const ts = typeof ev.timestamp === "string" ? ev.timestamp : "";
  const cmd = typeof ev.data?.command === "string" ? ev.data.command : "";
  return `${ts}:${ev.sessionId}:${counter}:${cmd.slice(0, 64)}`;
}

export type WsController = { stop: () => void };

export function startWsClient(): WsController {
  let ws: WebSocket | null = null;
  let stopped = false;
  let counter = 0;
  let backoffMs = 250;
  let retryTimer: any = null;

  function setStatus(status: "connecting" | "connected" | "disconnected", opts: any = {}) {
    connection.set({
      status,
      lastError: opts.lastError || null,
      retryInMs: opts.retryInMs ?? null,
    });
  }

  async function maybeBackfill() {
    const sessionId = get(selectedSessionId);
    if (!sessionId || sessionId === ALL_SESSIONS) return;
    try {
      const events = await backfillSession(sessionId);
      allEvents.update((prev) => {
        const seen = new Set(prev.map((e) => e._id));
        const merged = [...prev];
        for (const ev of events) {
          if (!seen.has(ev._id)) merged.push(ev);
        }
        merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        return merged;
      });
    } catch {
      // Backfill is best-effort.
    }
  }

  function scheduleReconnect(lastError: string) {
    if (stopped) return;
    if (retryTimer) return;

    const retryInMs = Math.min(backoffMs, 10_000);
    setStatus("disconnected", { lastError, retryInMs });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      backoffMs = Math.min(backoffMs * 2, 10_000);
      connect();
    }, retryInMs);
  }

  function connect() {
    if (stopped) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    const baseUrl = get(serverBaseUrl);
    const url = makeWsUrl(baseUrl);

    setStatus("connecting");
    try {
      ws = new WebSocket(url);
    } catch (e: any) {
      scheduleReconnect(e?.message || "Failed to create WebSocket");
      return;
    }

    ws.onopen = async () => {
      backoffMs = 250;
      setStatus("connected");
      await maybeBackfill();
    };

    ws.onclose = () => {
      scheduleReconnect("WebSocket closed");
    };

    ws.onerror = () => {
      // onclose will do the reconnect work.
    };

    ws.onmessage = (msg) => {
      let parsed: any;
      try {
        parsed = JSON.parse(String(msg.data));
      } catch {
        return;
      }

      const ev: HookEvent = {
        type: parsed.type,
        timestamp: parsed.timestamp,
        sessionId: parsed.sessionId,
        data: parsed.data,
        _id: stableEventId(parsed, counter++),
      };

      allEvents.update((prev) => [...prev, ev].slice(-2000));

      try {
        localStorage.setItem("deliberate.sessionId", get(selectedSessionId) || "");
      } catch {
        // ignore
      }
    };
  }

  // Use config-driven base URL changes.
  const unsub = serverBaseUrl.subscribe(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    connect();
  });

  const unsubSession = selectedSessionId.subscribe(() => {
    // Backfill on session switch when connected.
    if (ws && ws.readyState === WebSocket.OPEN) {
      maybeBackfill();
    }
  });

  // Restore last session id for backfill.
  try {
    const saved = localStorage.getItem("deliberate.sessionId");
    if (saved) selectedSessionId.set(saved);
  } catch {
    // ignore
  }

  connect();

  return {
    stop: () => {
      stopped = true;
      unsub();
      unsubSession();
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) ws.close();
    },
  };
}
