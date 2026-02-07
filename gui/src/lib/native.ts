export async function isTauri(): Promise<boolean> {
  try {
    // This is the most reliable check we have without relying on globals.
    await import("@tauri-apps/api/core");
    return true;
  } catch {
    return false;
  }
}

export async function startLocalServer(port: number): Promise<{ ok: boolean; message: string }> {
  try {
    const core = await import("@tauri-apps/api/core");
    const result = await core.invoke<string>("deliberate_server_start", { port });
    return { ok: true, message: result };
  } catch (e: any) {
    return { ok: false, message: e?.message || "failed to start server" };
  }
}

export async function serverIsRunning(port: number): Promise<boolean> {
  try {
    const core = await import("@tauri-apps/api/core");
    const result = await core.invoke<boolean>("deliberate_server_is_running", { port });
    return !!result;
  } catch {
    return false;
  }
}

