<script lang="ts">
  import { onMount } from "svelte";
  import { connection, serverBaseUrl, sessionEvents } from "../lib/stores";
  import { startLocalServer } from "../lib/native";
  import CommandItem from "./CommandItem.svelte";

  let scroller: HTMLDivElement | null = null;
  let starting = false;
  let startError: string | null = null;

  async function startServer() {
    starting = true;
    startError = null;
    try {
      const url = new URL($serverBaseUrl);
      const port = Number(url.port || "8765");
      const result = await startLocalServer(port);
      if (!result.ok) startError = result.message;
    } catch (e: any) {
      startError = e?.message || "Failed to start server";
    } finally {
      starting = false;
    }
  }

  function scrollToBottomIfNearBottom() {
    if (!scroller) return;
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distanceFromBottom < 80) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  onMount(() => {
    scrollToBottomIfNearBottom();
    const id = setInterval(scrollToBottomIfNearBottom, 250);
    return () => clearInterval(id);
  });
</script>

<div class="timeline" bind:this={scroller}>
  {#if $sessionEvents.length === 0}
    <div class="empty muted">
      {#if $connection.status !== "connected"}
        Not connected to <span class="pill">{$serverBaseUrl}</span>. Start <span class="pill">deliberate serve</span>.
        <div style="margin-top: 12px;">
          <button class="btn" type="button" on:click={startServer} disabled={starting}>
            {starting ? "Starting…" : "Start server"}
          </button>
        </div>
        {#if startError}
          <div class="muted" style="margin-top: 8px;">{startError}</div>
        {/if}
      {:else}
        Waiting for hook events on <span class="pill">/ws</span>
      {/if}
    </div>
  {:else}
    <div class="list">
      {#each $sessionEvents as ev (ev._id)}
        <CommandItem event={ev} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .timeline {
    flex: 1;
    overflow: auto;
    padding: 10px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .empty {
    padding: 16px;
    border: 1px dashed var(--border);
    border-radius: 12px;
    text-align: center;
  }
</style>
