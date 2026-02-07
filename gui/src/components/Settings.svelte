<script lang="ts">
  import { get } from "svelte/store";
  import { patchConfig } from "../lib/api";
  import { config, isSettingsOpen, serverBaseUrl } from "../lib/stores";

  let saving = false;
  let error: string | null = null;
  let serverUrlDraft = "";
  let terminalModeDraft: "full" | "minimal" | "gui" = "full";
  let allWorkspacesDraft = true;

  $: serverUrlDraft = $config?.gui?.serverBaseUrl || get(serverBaseUrl);
  $: terminalModeDraft = ($config?.gui?.terminalExplanations || "full") as any;
  $: allWorkspacesDraft = ($config?.gui?.visibleOnAllWorkspaces ?? true) as any;

  async function save() {
    saving = true;
    error = null;
    try {
      const next = await patchConfig({
        gui: {
          serverBaseUrl: serverUrlDraft,
          terminalExplanations: terminalModeDraft,
          visibleOnAllWorkspaces: allWorkspacesDraft,
        },
      });
      config.set(next);
      serverBaseUrl.set(next.gui?.serverBaseUrl || serverUrlDraft);
    } catch (e: any) {
      error = e?.message || "Failed to save settings";
    } finally {
      saving = false;
    }
  }

  async function removeSkip(entry: string) {
    const current = get(config);
    const list = (current?.skipCommands?.additional || []).filter((x: string) => x !== entry);
    const next = await patchConfig({ skipCommands: { additional: list } });
    config.set(next);
  }

  async function removeBlock(entry: string) {
    const current = get(config);
    const list = (current?.customBlocklist || []).filter((x: string) => x !== entry);
    const next = await patchConfig({ customBlocklist: list });
    config.set(next);
  }
</script>

{#if $isSettingsOpen}
  <div class="overlay">
    <div class="panel">
      <div class="header row">
        <span class="pill">settings</span>
        <div style="flex: 1;"></div>
        <button class="btn" on:click={() => isSettingsOpen.set(false)}>Close</button>
      </div>

      <div class="body">
        <div class="section">
          <div class="muted">server base url</div>
          <input class="input" bind:value={serverUrlDraft} placeholder="http://localhost:8765" />
          <div class="row">
            <button class="btn" on:click={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <span class="muted">Used for REST + WS connections.</span>
          </div>
        </div>

        <div class="section">
          <div class="muted">terminal explanations</div>
          <select class="input" bind:value={terminalModeDraft}>
            <option value="full">full (Claude Code)</option>
            <option value="minimal">minimal (pointer)</option>
            <option value="gui">gui only</option>
          </select>
          <div class="muted">
            This does not change the safety decision, it only changes what text shows in Claude Code.
          </div>
        </div>

        <div class="section">
          <div class="muted">spaces (macOS)</div>
          <label class="row">
            <input type="checkbox" bind:checked={allWorkspacesDraft} />
            <span class="muted">Show on all workspaces (helps with full screen terminals)</span>
          </label>
        </div>

        <div class="section">
          <div class="muted">skip commands (exact)</div>
          {#if ($config?.skipCommands?.additional || []).length === 0}
            <div class="muted">none</div>
          {:else}
            <div class="list">
              {#each $config.skipCommands.additional as entry (entry)}
                <div class="item">
                  <span class="text">{entry}</span>
                  <button class="btn" on:click={() => removeSkip(entry)}>remove</button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <div class="section">
          <div class="muted">custom blocklist</div>
          {#if ($config?.customBlocklist || []).length === 0}
            <div class="muted">none</div>
          {:else}
            <div class="list">
              {#each $config.customBlocklist as entry (entry)}
                <div class="item">
                  <span class="text">{entry}</span>
                  <button class="btn" on:click={() => removeBlock(entry)}>remove</button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        {#if error}
          <div class="muted">{error}</div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    justify-content: center;
    align-items: stretch;
    padding: 10px;
  }

  .panel {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .header {
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }

  .body {
    flex: 1;
    overflow: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .input {
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text);
    outline: none;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .item {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.02);
  }

  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
