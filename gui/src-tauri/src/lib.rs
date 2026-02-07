use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

fn is_port_listening(port: u16) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok()
}

fn find_node_binary() -> Option<PathBuf> {
    // Prefer explicit override.
    if let Ok(p) = std::env::var("DELIBERATE_NODE_BINARY") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }

    // In GUI-launched apps the PATH can be minimal, so prefer common absolute paths.
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
        "node",
    ];

    for c in candidates {
        let pb = PathBuf::from(c);
        if pb.is_absolute() {
            if pb.exists() {
                return Some(pb);
            }
            continue;
        }

        // For PATH lookups, validate by executing `node --version`.
        if Command::new(&pb)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            return Some(pb);
        }
    }

    None
}

fn resolve_package_root_from_hook_symlink() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let hook_path = PathBuf::from(home).join(".claude").join("hooks").join("deliberate-commands.py");
    let target = fs::read_link(&hook_path).ok()?;

    // Expected: <pkg>/hooks/deliberate-commands.py
    let hooks_dir = target.parent()?;
    if hooks_dir.file_name()?.to_string_lossy() != "hooks" {
        return None;
    }
    let pkg_root = hooks_dir.parent()?;
    Some(pkg_root.to_path_buf())
}

fn resolve_server_entrypoint() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("DELIBERATE_SERVER_ENTRY") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }

    let pkg_root = resolve_package_root_from_hook_symlink()?;
    let entry = pkg_root.join("src").join("server.js");
    if entry.exists() {
        return Some(entry);
    }

    None
}

/// Check if the deliberate server is listening on the configured port.
#[tauri::command]
fn deliberate_server_is_running(port: u16) -> bool {
    is_port_listening(port)
}

/// Start the deliberate server in the background.
///
/// This does not require the user to run a terminal command. We attempt to
/// locate the server entrypoint from the installed hook symlink, which works
/// for both "repo checkout" and "npm global install" on macOS/Linux (symlinked
/// hooks).
#[tauri::command]
fn deliberate_server_start(port: u16) -> Result<String, String> {
    if is_port_listening(port) {
        return Ok("already running".to_string());
    }

    let node = find_node_binary().ok_or_else(|| "node not found".to_string())?;
    let entry = resolve_server_entrypoint().ok_or_else(|| "could not locate server.js (is the hook installed?)".to_string())?;

    let pkg_root = entry
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let mut cmd = Command::new(node);
    cmd.arg(entry);
    cmd.env("PORT", port.to_string());
    if let Some(root) = pkg_root {
        cmd.current_dir(root);
    }
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    cmd.stdin(Stdio::null());

    // Spawn and detach.
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok("started".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            deliberate_server_is_running,
            deliberate_server_start
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
