<script lang="ts">
  import { connection, config, isSettingsOpen } from "../lib/stores";
  import { patchConfig } from "../lib/api";
  import { get } from "svelte/store";

  let windowApi: any = null;

  async function getWindowApi() {
    if (windowApi) return windowApi;
    try {
      const mod = await import("@tauri-apps/api/window");
      windowApi = mod;
      return mod;
    } catch {
      return null;
    }
  }

  async function minimize() {
    const api = await getWindowApi();
    if (!api) return;
    try {
      await api.getCurrentWindow().minimize();
    } catch {
      // ignore
    }
  }

  async function close() {
    const api = await getWindowApi();
    if (!api) return;
    try {
      await api.getCurrentWindow().close();
    } catch {
      // ignore
    }
  }

  async function toggleAlwaysOnTop() {
    const current = get(config)?.gui?.alwaysOnTop ?? true;
    const next = !current;
    try {
      const updated = await patchConfig({ gui: { alwaysOnTop: next } });
      config.set(updated);
    } catch {
      // ignore for now
    }

    const api = await getWindowApi();
    if (!api) return;
    try {
      const win = api.getCurrentWindow();
      await win.setAlwaysOnTop(next);
      // Helps keep the window visible on full screen apps (macOS Spaces).
      await win.setVisibleOnAllWorkspaces(true);
    } catch {
      // ignore
    }
  }

  async function tryStartDragging(e: PointerEvent) {
    // Dragging should not fire when clicking interactive controls.
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) return;
    if (e.button !== 0) return;

    const api = await getWindowApi();
    if (!api) return;
    try {
      // `startDragging` is the most reliable approach across platforms.
      await api.getCurrentWindow().startDragging();
    } catch {
      // ignore
    }
  }
</script>

<div
  class="titlebar"
  data-tauri-drag-region
  role="toolbar"
  aria-label="Window controls"
  tabindex="0"
  on:pointerdown={tryStartDragging}
>
  <div class="left row" data-tauri-drag-region>
    {#if $connection.status === "connected"}
      <span class="dot" style="background: var(--safe)"></span>
    {:else if $connection.status === "connecting"}
      <span class="dot" style="background: var(--moderate)"></span>
    {:else}
      <span class="dot" style="background: var(--danger)"></span>
    {/if}
    <span class="title" data-tauri-drag-region>Deliberate</span>
  </div>

  <div class="right row">
    <button class="btn" on:click={() => isSettingsOpen.update((v) => !v)} aria-label="Settings">
      ⚙
    </button>
    <button class="btn pill" on:click={toggleAlwaysOnTop}>
      {($config?.gui?.alwaysOnTop ?? true) ? "On top" : "Normal"}
    </button>
    <button class="btn" on:click={minimize} aria-label="Minimize">
      _
    </button>
    <button class="btn danger" on:click={close} aria-label="Close">
      ×
    </button>
  </div>
</div>

<style>
  .titlebar {
    height: 40px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    user-select: none;
  }

  .title {
    font-size: 13px;
    letter-spacing: 0.2px;
  }

  .right button {
    padding: 4px 8px;
    border-radius: 8px;
  }
</style>
