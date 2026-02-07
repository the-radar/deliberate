<script lang="ts">
  import { allEvents, ALL_SESSIONS, connection, selectedSessionId, serverBaseUrl, sessionStats } from "../lib/stores";

  let sessionOptions: string[] = [ALL_SESSIONS];

  function shortSessionId(id: string | null) {
    if (!id) return "no session";
    if (id.length <= 10) return id;
    return `${id.slice(0, 6)}…${id.slice(-4)}`;
  }

  $: sessionOptions = (() => {
    const ids = new Set<string>();
    for (const ev of $allEvents) {
      if (ev.sessionId) ids.add(ev.sessionId);
    }
    return [ALL_SESSIONS, ...Array.from(ids).sort()];
  })();
</script>

<div class="bar">
  <div class="left">
    <div class="row">
      <label class="pill muted">
        session
        <select class="select" bind:value={$selectedSessionId}>
          {#each sessionOptions as id (id)}
            <option value={id}>{id === ALL_SESSIONS ? "all" : shortSessionId(id)}</option>
          {/each}
        </select>
      </label>
      <span class="pill">total {$sessionStats.total}</span>
      <span class="pill muted">server {$serverBaseUrl}</span>
      <span class="pill">
        {$connection.status}
        {#if $connection.retryInMs !== null && $connection.status !== "connected"}
          <span class="muted"> ({$connection.retryInMs}ms)</span>
        {/if}
      </span>
    </div>
    {#if $connection.lastError}
      <div class="muted" style="margin-top: 6px;">{$connection.lastError}</div>
    {/if}
  </div>

  <div class="row">
    <span class="pill"><span class="dot" style="background: var(--safe)"></span> {$sessionStats.safe}</span>
    <span class="pill"><span class="dot" style="background: var(--moderate)"></span> {$sessionStats.moderate}</span>
    <span class="pill"><span class="dot" style="background: var(--danger)"></span> {$sessionStats.dangerous}</span>
  </div>
</div>

<style>
  .bar {
    padding: 10px;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    border-bottom: 1px solid var(--border);
  }

  .left {
    min-width: 0;
  }

  .select {
    margin-left: 6px;
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text);
    border-radius: 8px;
    padding: 2px 6px;
    outline: none;
  }
</style>
