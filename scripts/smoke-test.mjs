import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(here, "discord-mcp.mjs")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, DISCORD_BOT_TOKEN: "", DISCORD_ALLOWED_GUILD_IDS: "" },
});
const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
const responses = new Map();

rl.on("line", (line) => {
  const message = JSON.parse(line);
  const resolver = responses.get(message.id);
  if (resolver) {
    responses.delete(message.id);
    resolver(message);
  }
});

function request(id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 3000);
    responses.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

try {
  const initialized = await request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke-test", version: "1" } });
  if (initialized.result?.serverInfo?.name !== "discord-mcp") throw new Error("Initialize failed");

  const listed = await request(2, "tools/list");
  if (!Array.isArray(listed.result?.tools) || listed.result.tools.length < 15) throw new Error("Tool listing failed");
  if (!listed.result.tools.some((tool) => tool.name === "discord_api_read")) throw new Error("Raw read tool missing");
  if (!listed.result.tools.some((tool) => tool.name === "discord_api_write")) throw new Error("Raw write tool missing");

  const status = await request(3, "tools/call", { name: "discord_status", arguments: {} });
  if (status.result?.structuredContent?.configured !== false) throw new Error("Unconfigured status check failed");

  const blocked = await request(4, "tools/call", { name: "discord_api_read", arguments: { path: "/oauth2/token" } });
  if (blocked.result?.isError !== true) throw new Error("Sensitive route guard failed");

  const previewArgs = {
    method: "PATCH",
    path: "/guilds/123456789012345678",
    body: { name: "Preview only" },
    reason: "Smoke test",
  };
  const preview = await request(5, "tools/call", { name: "discord_api_write", arguments: previewArgs });
  const previewToken = preview.result?.structuredContent?.confirm_token;
  if (!previewToken || preview.result?.structuredContent?.confirmation_required !== true) throw new Error("Generic write preview failed");

  const tampered = await request(6, "tools/call", {
    name: "discord_api_write",
    arguments: { ...previewArgs, body: { name: "Changed after preview" }, confirm_token: previewToken },
  });
  if (tampered.result?.structuredContent?.executed !== false || tampered.result?.structuredContent?.confirm_token === previewToken) {
    throw new Error("Request-bound confirmation guard failed");
  }

  console.log(`Smoke test passed: ${listed.result.tools.length} tools loaded.`);
} finally {
  child.kill();
}
