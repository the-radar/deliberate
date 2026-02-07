<script lang="ts">
  import type { HookEvent, Risk } from "../lib/stores";
  import { addBlock, addSkip, streamChat } from "../lib/api";

  export let event: HookEvent;

  let expanded = false;
  let chatOpen = false;
  let busy: null | "skip" | "block" = null;
  let error: string | null = null;

  type Msg = { role: "user" | "assistant"; content: string };
  let messages: Msg[] = [];
  let input = "";
  let streaming = false;
  let aborter: null | { abort: () => void } = null;

  const riskColor: Record<string, string> = {
    SAFE: "var(--safe)",
    MODERATE: "var(--moderate)",
    DANGEROUS: "var(--danger)",
  };

  function risk(): Risk {
    return event?.data?.risk || "MODERATE";
  }

  function cmd(): string {
    return typeof event?.data?.command === "string" ? event.data.command : "";
  }

  function time(): string {
    try {
      const d = new Date(event.timestamp);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function pretty(value: any) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function toggle() {
    expanded = !expanded;
    if (!expanded) {
      chatOpen = false;
      aborter?.abort();
    }
  }

  async function dontFlag() {
    const command = cmd();
    if (!command) return;
    busy = "skip";
    error = null;
    try {
      await addSkip(command);
    } catch (e: any) {
      error = e?.message || "Failed to update skip list";
    } finally {
      busy = null;
    }
  }

  async function markDangerous() {
    const command = cmd();
    if (!command) return;
    busy = "block";
    error = null;
    try {
      await addBlock(command);
    } catch (e: any) {
      error = e?.message || "Failed to update blocklist";
    } finally {
      busy = null;
    }
  }

  async function sendChat() {
    const text = input.trim();
    if (!text || streaming) return;
    input = "";
    error = null;

    const next: Msg[] = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
    messages = next;
    streaming = true;

    const assistantIdx = messages.length - 1;
    aborter = await streamChat({
      context: {
        command: event?.data?.command,
        risk: event?.data?.risk,
        explanation: event?.data?.explanation,
        consequences: event?.data?.consequences,
      },
      messages: next.map((m) => ({ role: m.role, content: m.content })),
      onToken: (tok) => {
        messages = messages.map((m, i) => (i === assistantIdx ? { ...m, content: m.content + tok } : m));
      },
      onError: (msg) => {
        error = msg;
      },
      onDone: () => {
        streaming = false;
        aborter = null;
      },
    });
  }
</script>

<div class="wrap">
  <button class="card {expanded ? 'active' : ''}" type="button" on:click={toggle}>
    <div class="row top">
      <span class="dot" style="background: {riskColor[risk()] || 'var(--moderate)'}"></span>
      <span class="muted time">{time()}</span>
      <span class="pill risk" style="border-color: {riskColor[risk()] || 'var(--moderate)'}">{risk()}</span>
    </div>
    <div class="cmd">{cmd()}</div>
    <div class="muted hint">{expanded ? "click to collapse" : "click to expand"}</div>
  </button>

  {#if expanded}
    <div class="details">
      <div class="section">
        <div class="muted">explanation</div>
        <pre class="mono">{pretty(event?.data?.explanation)}</pre>
      </div>

      {#if event?.data?.backupPath}
        <div class="section">
          <div class="muted">backup</div>
          <pre class="mono">{pretty(event?.data?.backupPath)}</pre>
        </div>
      {/if}

      {#if event?.data?.consequences}
        <div class="section">
          <div class="muted">consequences</div>
          <pre class="mono">{pretty(event?.data?.consequences)}</pre>
        </div>
      {/if}

      <div class="row actions">
        <button class="btn safe" on:click={dontFlag} disabled={busy !== null}>
          {busy === "skip" ? "Saving…" : "Skip warning"}
        </button>
        <button class="btn danger" on:click={markDangerous} disabled={busy !== null}>
          {busy === "block" ? "Saving…" : "Always block"}
        </button>
        <button class="btn" on:click={() => (chatOpen = !chatOpen)}>
          {chatOpen ? "Hide chat" : "Discuss"}
        </button>
      </div>

      {#if error}
        <div class="muted" style="margin-top: 8px;">{error}</div>
      {/if}

      {#if chatOpen}
        <div class="chat">
          <div class="messages">
            {#if messages.length === 0}
              <div class="muted">Ask about blast radius, safety, or safer alternatives.</div>
            {:else}
              {#each messages as m, i (i)}
                <div class="msg {m.role}">
                  <div class="meta muted">{m.role}</div>
                  <pre class="content">{m.content}</pre>
                </div>
              {/each}
            {/if}
          </div>
          <form class="composer" on:submit|preventDefault={sendChat}>
            <input
              class="input"
              placeholder={streaming ? "Streaming…" : "Type a message"}
              bind:value={input}
              disabled={streaming}
            />
            <button class="btn" type="submit" disabled={streaming || !input.trim()}>Send</button>
          </form>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .card {
    text-align: left;
    width: 100%;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
  }

  .card:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .card.active {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
  }

  .top {
    justify-content: space-between;
    margin-bottom: 6px;
    align-items: center;
    gap: 8px;
  }

  .risk {
    margin-left: auto;
  }

  .time {
    font-size: 11px;
  }

  .cmd {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint {
    margin-top: 6px;
    font-size: 11px;
  }

  .details {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.015);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }

  .mono {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px;
    background: rgba(255, 255, 255, 0.02);
  }

  .actions {
    margin-top: 6px;
    justify-content: flex-start;
  }

  .chat {
    margin-top: 10px;
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }

  .messages {
    max-height: 240px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 0;
  }

  .msg {
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.02);
  }

  .msg.assistant {
    border-color: rgba(46, 160, 67, 0.22);
  }

  .content {
    margin: 6px 0 0 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .composer {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .input {
    flex: 1;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text);
    outline: none;
  }
</style>
