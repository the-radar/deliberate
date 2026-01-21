#!/usr/bin/env node
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON_CMD = process.platform === "win32" ? "python" : "python3";
const HOME_DIR = os.homedir();
const HOOK_SCRIPT_LOCAL = path.join(__dirname, "..", "hooks", "deliberate-commands.py");
const HOOK_SCRIPT_GLOBAL = path.join(HOME_DIR, ".claude", "hooks", "deliberate-commands.py");
const HOOK_SCRIPT = fs.existsSync(HOOK_SCRIPT_LOCAL) ? HOOK_SCRIPT_LOCAL : HOOK_SCRIPT_GLOBAL;
const TIMEOUT_MS = 30000;
const DANGEROUS_PREFIXES = [
  "rm ",
  "rm-",
  "git ",
  "sudo ",
  "bash ",
  "sh ",
  "python ",
  "python3 ",
  "node ",
  "perl ",
  "ruby ",
  "docker ",
  "kubectl ",
  "aws ",
  "terraform ",
  "gcloud ",
  "az ",
  "scp ",
  "rsync ",
  "dd ",
  "mkfs ",
  "chmod ",
  "chown ",
  "find ",
  "xargs ",
  "parallel ",
  "base64 ",
  "xxd "
];

function shouldAnalyze(command) {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (trimmed.length < 4) return false;
  const lower = trimmed.toLowerCase();
  if (lower.includes("rm -rf") || lower.includes("git reset") || lower.includes("git clean")) {
    return true;
  }
  return DANGEROUS_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function stripAnsi(input) {
  return input.replace(/\u001b\[[0-9;]*m/g, "");
}

async function runCommandHook({ command, sessionID, cwd }) {
  if (!fs.existsSync(HOOK_SCRIPT)) {
    return null;
  }

  const payload = {
    tool_name: "Bash",
    tool_input: { command },
    session_id: sessionID,
    cwd: cwd || process.cwd()
  };

  return new Promise((resolve) => {
    const child = spawn(PYTHON_CMD, [HOOK_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env
      }
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill("SIGKILL");
        resolve({ code: 124, stdout: "", stderr: "Deliberate hook timed out" });
      }
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });

    child.stdin.write(`${JSON.stringify(payload)}\n`);
    child.stdin.end();
  });
}

function parseHookOutput(stdout) {
  if (!stdout) return null;

  try {
    const parsed = JSON.parse(stdout.trim());
    const hookOutput = parsed?.hookSpecificOutput || {};
    const reason = hookOutput.permissionDecisionReason || "";
    const context = hookOutput.additionalContext || "";

    return {
      reason: stripAnsi(reason).trim(),
      context: stripAnsi(context).trim()
    };
  } catch (err) {
    return null;
  }
}

export const DeliberateOpenCodePlugin = async ({ client, directory }) => {
  if (!client) {
    throw new Error("Deliberate OpenCode plugin requires SDK client access");
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return;

      const command = output?.args?.command;
      if (!command) return;

      if (!shouldAnalyze(command)) {
        return;
      }

      const cwd = output?.args?.workdir || directory;
      const result = await runCommandHook({ command, sessionID: input.sessionID, cwd });
      if (!result) return;

      const parsed = parseHookOutput(result.stdout);
      const message = parsed?.context || parsed?.reason || "";

      if (message) {
        await client.session.prompt({
          path: { id: input.sessionID },
          body: {
            noReply: true,
            parts: [{ type: "text", text: message }]
          }
        }).catch(() => {});
      }

      if (result.code === 2 || (result.stderr && result.stderr.includes("BLOCKED by Deliberate"))) {
        const blockedMessage = stripAnsi(result.stderr || message || "Blocked by Deliberate");
        throw new Error(blockedMessage.trim() || "Blocked by Deliberate");
      }
    }
  };
};

export default DeliberateOpenCodePlugin;
