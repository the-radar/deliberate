import { derived, writable } from "svelte/store";

export type Risk = "SAFE" | "MODERATE" | "DANGEROUS";

export type CommandAnalyzedData = {
  command: string;
  risk: Risk;
  explanation: string;
  consequences?: unknown;
  workflowPatterns?: unknown[];
  backupPath?: string | null;
  permissionDecision?: "allow" | "ask" | "block";
};

export type HookEvent = {
  type: string;
  timestamp: string;
  sessionId: string;
  data: any;
  _id: string;
};

export type ConnectionState = {
  status: "connecting" | "connected" | "disconnected";
  lastError: string | null;
  retryInMs: number | null;
};

export const ALL_SESSIONS = "__all__";

export const serverBaseUrl = writable("http://localhost:8765");
export const connection = writable<ConnectionState>({
  status: "disconnected",
  lastError: null,
  retryInMs: null,
});

export const config = writable<any>(null);

export const allEvents = writable<HookEvent[]>([]);
export const selectedSessionId = writable<string>(ALL_SESSIONS);
export const isSettingsOpen = writable(false);

export const sessionEvents = derived(
  [allEvents, selectedSessionId],
  ([$all, $session]) => {
    if (!$session || $session === ALL_SESSIONS) return $all;
    return $all.filter((e) => e.sessionId === $session);
  },
);

export const sessionStats = derived(sessionEvents, ($events) => {
  let safe = 0;
  let moderate = 0;
  let dangerous = 0;

  for (const ev of $events) {
    if (ev.type !== "command_analyzed") continue;
    const risk: Risk | undefined = ev.data?.risk;
    if (risk === "SAFE") safe += 1;
    else if (risk === "DANGEROUS") dangerous += 1;
    else moderate += 1;
  }

  return {
    total: $events.length,
    safe,
    moderate,
    dangerous,
  };
});
