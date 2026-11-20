import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = path.join(__dirname, "..", "cursor-bridge", "server.mjs");

/** @type {import("node:child_process").ChildProcess | null} */
let bridgeChild = null;

export function bridgeBaseUrl() {
  const port = Number(process.env.CEDAR_CURSOR_BRIDGE_PORT ?? 8092);
  return `http://127.0.0.1:${port}`;
}

async function bridgeHealth() {
  try {
    const res = await fetch(`${bridgeBaseUrl()}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForBridge(maxMs = 45_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await bridgeHealth()) return true;
    await sleep(250);
  }
  return false;
}

export function isBridgeManaged() {
  return Boolean(bridgeChild);
}

/**
 * Start the Reaper-style Cursor bridge if needed.
 */
export async function ensureCursorBridge() {
  if (process.env.CEDAR_CURSOR_BRIDGE === "false") {
    throw new Error("CEDAR_CURSOR_BRIDGE=false");
  }

  if (await bridgeHealth()) return bridgeBaseUrl();

  if (!bridgeChild) {
    const port = Number(process.env.CEDAR_CURSOR_BRIDGE_PORT ?? 8092);
    bridgeChild = spawn(process.execPath, [BRIDGE_SCRIPT], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        CEDAR_CURSOR_BRIDGE_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    bridgeChild.unref?.();

    bridgeChild.stderr?.on("data", (chunk) => {
      const line = String(chunk).trim();
      if (line && !line.includes("ExperimentalWarning")) {
        console.error(`[cedar-cursor-bridge] ${line}`);
      }
    });

    bridgeChild.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[cedar-cursor-bridge] exited with code ${code}`);
      }
      bridgeChild = null;
    });
  }

  const ok = await waitForBridge();
  if (!ok) {
    throw new Error(
      "Cursor bridge did not start — check @cursor/sdk and CURSOR_API_KEY, or run: node cursor-bridge/server.mjs"
    );
  }
  return bridgeBaseUrl();
}