import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CodexAgent, prepareAgentHome } from "./codex.mjs";

export const stateDir = () => path.resolve(process.env.DISCORD_CHAT_HOME || path.join(os.homedir(), ".discord-mcp-chat"));
export const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export async function readState(name, fallback = null) {
  try { return JSON.parse(await fs.readFile(path.join(stateDir(), name), "utf8")); }
  catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
}
export async function saveState(name, value) {
  await fs.mkdir(stateDir(), { recursive: true, mode: 0o700 });
  const target = path.join(stateDir(), name);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temp, target);
}
export function validateConfig(c) {
  const id = /^\d{17,20}$/;
  if (!id.test(c.guildId) || !id.test(c.ownerId)) throw new Error("Valid guild and owner IDs are required.");
  for (const key of ["userIds", "roleIds", "channelIds"]) {
    if (!Array.isArray(c[key]) || c[key].some(x => !id.test(x))) throw new Error(`Invalid ${key}.`);
  }
  if (!c.channelIds.length || !c.userIds.includes(c.ownerId)) throw new Error("Explicit channels and the configuring owner are required.");
  if (typeof c.model !== "string" || !/^[a-zA-Z0-9._:-]{1,100}$/.test(c.model)) throw new Error("Choose an available model ID.");
  if (!["default", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(c.effort)) throw new Error("Invalid reasoning effort.");
  if (!["confirm", "direct"].includes(c.writeMode)) throw new Error("Invalid write mode.");
  if (typeof c.autoStart !== "boolean" || typeof c.enabled !== "boolean") throw new Error("Invalid enable/startup choice.");
  return c;
}

const steps = [
  ["auth", "Sign in to the isolated Codex agent using the returned login command, then answer ready. No credentials belong in chat."],
  ["guildId", "Which Discord server should chat work in? Choose its server ID."],
  ["ownerId", "What is your Discord user ID? You must own the server or have Administrator permission."],
  ["userIds", "Who else may use the bot? Enter user IDs separated by commas, or only me (recommended)."],
  ["roleIds", "Allow any roles to use it too? Enter role IDs separated by commas, or none (recommended)."],
  ["channelIds", "Which text channels or forum parents may activate it? Enter channel IDs separated by commas."],
  ["model", "Which model should the agent use? Choose an ID from available_models. It will be locked for Discord users."],
  ["effort", "Which reasoning effort? Answer default (recommended) or an effort supported by the selected model."],
  ["writeMode", "Require confirmation for server changes (confirm, recommended), or allow authorized administrators to act directly (direct)?"],
  ["autoStart", "Start automatically at Windows sign-in? Answer no (recommended) or yes. The computer must stay awake."],
  ["finish", "Review the settings. Enable the listener now? Answer yes to enable, or no to leave it disabled."],
];
const schema = properties => ({ type: "object", properties, additionalProperties: false });
export const chatTools = [
  { name: "discord_chat_status", description: "Inspect optional Discord chat setup and listener health. Does not enable it.", inputSchema: schema({}), annotations: { readOnlyHint: true } },
  { name: "discord_chat_setup", description: "Guided optional chat setup. Call with no answer for one next question, then pass only the user's answer. field starts a focused edit of existing settings; reset restarts the full draft. Neither changes active settings until final approval.", inputSchema: schema({ answer: { type: "string", maxLength: 2000 }, reset: { type: "boolean" }, field: { type: "string", enum: ["userIds", "roleIds", "channelIds", "model", "effort", "writeMode", "autoStart"] } }) },
  { name: "discord_chat_control", description: "Start, stop, or disable the configured optional listener. Disable also removes automatic startup. Never expose this tool to Discord users.", inputSchema: { ...schema({ action: { type: "string", enum: ["start", "stop", "disable"] } }), required: ["action"] } },
];
export async function status() {
  const config = await readState("config.json", { enabled: false });
  const health = await readState("health.json");
  const lock = await readState("lock.json");
  let alive = false;
  if (Number.isInteger(lock?.pid) && lock.pid > 0) { try { process.kill(lock.pid, 0); alive = true; } catch { /* Stale process state. */ } }
  return { config, process_running: alive, running: Boolean(alive && health && Date.now() - health.updatedAt < 15000 && health.running), health,
    state_directory: stateDir(), login_command: `node "${path.join(scriptDir, "login.mjs")}"`,
    note: "Local host must be awake. Chat is separate from desktop conversations. Model usage uses the isolated Codex login's limits or billing." };
}
async function startup(enabled) {
  if (process.platform !== "win32") { if (enabled) throw new Error("Automatic startup currently supports Windows only; use your service manager on other systems."); return; }
  await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", path.join(scriptDir, "startup.ps1"), "-Action", enabled ? "Install" : "Remove", "-NodePath", process.execPath, "-ListenerPath", path.join(scriptDir, "listener.mjs"), "-StatePath", stateDir()], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let error = ""; child.stderr.on("data", x => { error += x; });
    child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Startup registration failed: ${error}`)));
  });
}
export async function stopListener() {
  await saveState("control.json", { stop: true });
  for (let i = 0; i < 30; i++) {
    const lock = await readState("lock.json");
    if (!lock) return;
    try { process.kill(lock.pid, 0); } catch (e) { if (e.code === "ESRCH") return; throw e; }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("Listener did not stop. Check status before retrying; no other process was killed.");
}
async function startListener() {
  const c = validateConfig(await readState("config.json", {}));
  if (!c.enabled) throw new Error("Chat is disabled. Complete discord_chat_setup first.");
  if ((await status()).process_running) return { ...await status(), message: "A listener process is already active. Check health, or stop it before restarting." };
  await saveState("control.json", { stop: false });
  const child = spawn(process.execPath, [path.join(scriptDir, "listener.mjs")], { detached: true, windowsHide: true, stdio: "ignore", env: { ...process.env, DISCORD_CHAT_HOME: stateDir() } });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250));
    const s = await status(); if (s.running) return s;
  }
  return { ...await status(), message: "Start requested, but not ready yet. Check status for startup errors." };
}
export async function chatControl(name, args, api) {
  if (name === "discord_chat_status") return status();
  if (name === "discord_chat_control") {
    if (args.action === "start") return startListener();
    if (!["stop", "disable"].includes(args.action)) throw new Error("Unknown action.");
    if (args.action === "disable") {
      const c = await readState("config.json", { enabled: false });
      await saveState("config.json", { ...c, enabled: false, autoStart: false });
      await startup(false);
    }
    await stopListener(); return status();
  }
  if (name !== "discord_chat_setup") throw new Error("Unknown chat tool.");
  let draft = args.reset ? null : await readState("setup.json");
  if (args.field) {
    if (args.answer !== undefined) throw new Error("Start a focused edit without answer, then ask the returned question.");
    const index = steps.findIndex(([key]) => key === args.field);
    if (![3, 4, 5, 6, 7, 8, 9].includes(index)) throw new Error("Unsupported settings field.");
    draft = { step: index, editing: true, config: validateConfig(await readState("config.json", {})) };
    if (["model", "effort"].includes(args.field)) {
      const agent = new CodexAgent(stateDir(), draft.config.codexExecutable);
      try { await agent.connect(); draft.models = await agent.models(); } finally { agent.close(); }
    }
  }
  draft ||= { step: 0, config: { enabled: false, userIds: [], roleIds: [], channelIds: [], effort: "default", writeMode: "confirm", autoStart: false } };
  const key = steps[draft.step][0];
  if (args.answer !== undefined) {
    const answer = args.answer.trim();
    const ids = () => answer.split(",").map(x => x.trim()).filter(Boolean);
    if (key === "auth") {
      if (answer.toLowerCase() !== "ready") throw new Error("Complete the local login, then answer ready.");
      const agent = new CodexAgent(stateDir());
      try { await agent.connect(); const account = await agent.rpc("account/read", {}); if (!account.account) throw new Error("Sign in first using the login command."); draft.models = await agent.models(); draft.config.codexExecutable = agent.command; }
      finally { agent.close(); }
    } else if (key === "guildId") { api.requireAllowedGuild(answer); await api.discord(`/guilds/${answer}`); draft.config.guildId = answer; }
    else if (key === "ownerId") {
      if (!/^\d{17,20}$/.test(answer)) throw new Error("Use your Discord user ID.");
      const { isAdministrator } = await import("./policy.mjs");
      if (!await isAdministrator(api.discord, draft.config.guildId, answer)) throw new Error("Setup owner must be a server administrator.");
      draft.config.ownerId = answer; draft.config.userIds = [answer];
    } else if (key === "userIds" || key === "roleIds" || key === "channelIds") {
      const values = /^(only me|none)$/i.test(answer) ? [] : ids();
      if (values.some(x => !/^\d{17,20}$/.test(x))) throw new Error("Use comma-separated Discord IDs.");
      if (key === "userIds") for (const id of values) await api.discord(`/guilds/${draft.config.guildId}/members/${id}`);
      if (key === "roleIds") { const roles = await api.discord(`/guilds/${draft.config.guildId}/roles`); if (values.some(id => !roles.some(r => r.id === id))) throw new Error("Role does not belong to selected server."); }
      if (key === "channelIds") {
        if (!values.length) throw new Error("Choose at least one channel.");
        for (const id of values) { const c = await api.discord(`/channels/${id}`); if (c.guild_id !== draft.config.guildId || ![0, 5, 11, 12, 15, 16].includes(c.type)) throw new Error("Choose text, forum, or thread channels in the selected server."); }
      }
      draft.config[key] = [...new Set(key === "userIds" ? [draft.config.ownerId, ...values] : values)];
    } else if (key === "model") {
      if (!draft.models.some(m => m.model === answer)) throw new Error("Choose an ID from available_models."); draft.config.model = answer;
    } else if (key === "effort") {
      const model = draft.models.find(m => m.model === draft.config.model);
      if (answer !== "default" && !model.supportedReasoningEfforts?.some(e => e.reasoningEffort === answer)) throw new Error("Unsupported effort for selected model."); draft.config.effort = answer;
    } else if (key === "writeMode") { if (!["confirm", "direct"].includes(answer)) throw new Error("Answer confirm or direct."); draft.config.writeMode = answer; }
    else if (key === "autoStart") { if (!/^(yes|no)$/i.test(answer)) throw new Error("Answer yes or no."); if (/yes/i.test(answer) && process.platform !== "win32") throw new Error("Automatic startup is Windows-only. Answer no and configure a service separately."); draft.config.autoStart = /yes/i.test(answer); }
    else if (key === "finish") {
      if (!/^(yes|no)$/i.test(answer)) throw new Error("Answer yes or no.");
      if (/no/i.test(answer)) return { enabled: (await readState("config.json"))?.enabled || false, message: "Draft retained; existing listener configuration was not changed." };
      validateConfig(draft.config);
      await stopListener();
      await startup(draft.config.autoStart);
      await saveState("config.json", { ...draft.config, enabled: true });
      await fs.rm(path.join(stateDir(), "setup.json"), { force: true });
      return { ...await startListener(), test: "Mention the bot in a selected channel and ask it to introduce itself. Replies without a mention require Message Content intent enabled in Discord Developer Portal." };
    }
    draft.step = draft.editing && key !== "model" ? 10 : draft.step + 1;
  }
  await prepareAgentHome(stateDir());
  await saveState("setup.json", draft);
  return { step: steps[draft.step][0], question: steps[draft.step][1], settings: draft.config,
    ...(steps[draft.step][0] === "model" ? { available_models: draft.models } : {}),
    ...(steps[draft.step][0] === "effort" ? { supported_efforts: draft.models?.find(m => m.model === draft.config.model)?.supportedReasoningEfforts || [] } : {}),
    ...(draft.step === 0 ? { login_command: (await status()).login_command } : {}) };
}
