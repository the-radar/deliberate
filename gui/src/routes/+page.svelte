<script lang="ts">
  import { onMount } from "svelte";
  import Titlebar from "../components/Titlebar.svelte";
  import SessionBar from "../components/SessionBar.svelte";
  import Timeline from "../components/Timeline.svelte";
  import Settings from "../components/Settings.svelte";
  import { config, serverBaseUrl } from "../lib/stores";
  import { fetchConfig } from "../lib/api";
  import { startWsClient } from "../lib/ws";

  onMount(() => {
    let ws: { stop: () => void } | null = null;

    (async () => {
      try {
        const cfg = await fetchConfig();
        config.set(cfg);
        if (cfg?.gui?.serverBaseUrl) serverBaseUrl.set(cfg.gui.serverBaseUrl);

        // Apply always-on-top early if we are in a real Tauri window.
        try {
          const mod = await import("@tauri-apps/api/window");
          const win = mod.getCurrentWindow();
          await win.setAlwaysOnTop(cfg?.gui?.alwaysOnTop ?? true);
          await win.setVisibleOnAllWorkspaces(cfg?.gui?.visibleOnAllWorkspaces ?? true);
        } catch {
          // ignore
        }
      } catch {
        // If config fetch fails, we still try to connect with defaults.
      }

      ws = startWsClient();
    })();

    return () => ws?.stop();
  });
</script>

<div class="app-shell">
  <Titlebar />
  <SessionBar />

  <div class="content">
    <Timeline />
    <Settings />
  </div>
</div>

<style>
  .app-shell {
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .content {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
</style>
