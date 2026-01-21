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
const HOOK_SCRIPT_LOCAL = path.join(__dirname, "..", "hooks", "deliberate-changes.py");
const HOOK_SCRIPT_GLOBAL = path.join(HOME_DIR, ".claude", "hooks", "deliberate-changes.py");
const HOOK_SCRIPT = fs.existsSync(HOOK_SCRIPT_LOCAL) ? HOOK_SCRIPT_LOCAL : HOOK_SCRIPT_GLOBAL;
const TIMEOUT_MS = 30000;

function stripAnsi(input) {
  return input.replace(/\u001b\[[0-9;]*m/g, "");
}

async function runChangeHook({ toolName, toolInput, sessionID }) {
  if (!fs.existsSync(HOOK_SCRIPT)) {
    return null;
  }

  const payload = {
    tool_name: toolName,
    tool_input: toolInput,
    session_id: sessionID
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
    const context = hookOutput.additionalContext || "";
    const systemMessage = parsed?.systemMessage || "";

    return {
      context: stripAnsi(context).trim(),
      message: stripAnsi(systemMessage).trim()
    };
  } catch (err) {
    return null;
  }
}

export const DeliberateOpenCodeChangesPlugin = async ({ client }) => {
  if (!client) {
    throw new Error("Deliberate OpenCode plugin requires SDK client access");
  }

  return {
    "tool.execute.after": async (input, output) => {
      const tool = input.tool;
      if (!tool || !["write", "edit", "multiedit", "patch"].includes(tool)) return;
      if (!output) return;

      const toolArgs = output?.metadata?.args || output?.args || {};
      const filePath = toolArgs.filePath || toolArgs.file_path || output?.metadata?.filepath || output?.metadata?.filePath;

      if (!filePath) return;

      const edits = Array.isArray(toolArgs.edits)
        ? toolArgs.edits.map((edit) => ({
          old_string: edit.oldString || edit.old_string || "",
          new_string: edit.newString || edit.new_string || ""
        }))
        : undefined;

      const hookToolName = tool === "multiedit" ? "MultiEdit" : tool === "write" ? "Write" : "Edit";

      const toolInput = {
        file_path: filePath,
        content: toolArgs.content || "",
        old_string: toolArgs.oldString || toolArgs.old_string || "",
        new_string: toolArgs.newString || toolArgs.new_string || "",
        edits
      };

      if (hookToolName === "Edit" && output?.metadata?.filediff?.before && output?.metadata?.filediff?.after) {
        toolInput.old_string = output.metadata.filediff.before;
        toolInput.new_string = output.metadata.filediff.after;
      }

      if (hookToolName === "Edit" && !toolInput.old_string && output?.metadata?.diff) {
        const diff = output.metadata.diff;
        const lines = diff.split("\n");
        let oldBlock = [];
        let newBlock = [];
        for (const line of lines) {
          if (line.startsWith("---") || line.startsWith("+++")) continue;
          if (line.startsWith("-")) {
            oldBlock.push(line.slice(1));
          } else if (line.startsWith("+")) {
            newBlock.push(line.slice(1));
          }
        }
        if (oldBlock.length) toolInput.old_string = oldBlock.join("\n");
        if (newBlock.length) toolInput.new_string = newBlock.join("\n");
      }

      const result = await runChangeHook({
        toolName: hookToolName,
        toolInput,
        sessionID: input.sessionID
      });

      if (!result) return;

      const parsed = parseHookOutput(result.stdout);
      const message = parsed?.message || parsed?.context;

      if (message) {
        await client.session.prompt({
          path: { id: input.sessionID },
          body: {
            noReply: true,
            parts: [{ type: "text", text: message }]
          }
        }).catch(() => {});
      }
    }
  };
};

export default DeliberateOpenCodeChangesPlugin;
