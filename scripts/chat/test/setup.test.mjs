import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { chatControl, enableDraft, readState, saveState, startListener, status } from "../config.mjs";
import { reconcileStartup, startupArgs } from "../startup.mjs";

const configuration = () => ({ enabled: false, guildId: "111111111111111111", ownerId: "222222222222222222", userIds: ["222222222222222222"], roleIds: [], channelIds: ["333333333333333333"], model: "test-model", effort: "default", writeMode: "confirm", autoStart: false });
const draft = () => ({ step: 10, config: configuration(), models: [{ model: "test-model" }] });
async function isolated(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "discord-setup-test-"));
  const previous = process.env.DISCORD_CHAT_HOME; process.env.DISCORD_CHAT_HOME = root;
  try { await fn(root); }
  finally { if (previous === undefined) delete process.env.DISCORD_CHAT_HOME; else process.env.DISCORD_CHAT_HOME = previous; await fs.rm(root, { recursive: true, force: true }); }
}
function fakeChild() {
  const child = new EventEmitter(); child.pid = 12345; child.exitCode = null;
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}; child.unref = () => {};
  return child;
}
test("startup command uses inline commands, quotes paths, and never changes execution policy", async () => {
  const args = await startupArgs(false, "C:\\a path\\Pocky's state");
  assert.equal(args.includes("-File"), false); assert.equal(args.includes("-ExecutionPolicy"), false);
  const command = Buffer.from(args.at(-1), "base64").toString("utf16le");
  assert.match(command, /Pocky''s state/); assert.doesNotMatch(command, /Set-ExecutionPolicy/);
});
test("installation and removal failures are distinct; unverifiable success is rejected", async () => {
  for (const enabled of [true, false]) {
    const spawnProcess = () => { const child = fakeChild(); queueMicrotask(() => { child.stderr.end("Access denied"); child.emit("close", 1); }); return child; };
    await assert.rejects(reconcileStartup(enabled, "unused", { platform: "win32", spawnProcess }), new RegExp(`Startup ${enabled ? "installation" : "removal"} failed: Access denied`));
  }
  const spawnProcess = () => { const child = fakeChild(); queueMicrotask(() => { child.stdout.end('{"present":true}'); child.emit("close", 0); }); return child; };
  await assert.rejects(reconcileStartup(false, "unused", { platform: "win32", spawnProcess }), /Could not verify/);
});
test("fresh manual enablement saves configuration then verifies health before deleting the draft", () => isolated(async () => {
  const pending = draft(); let starts = 0, checks = 0;
  await saveState("setup.json", pending);
  const result = await chatControl("discord_chat_setup", { answer: "yes" }, {}, {
    stop: async () => {}, reconcile: async enabled => { assert.equal(enabled, false); checks++; return { present: false }; },
    start: async () => { starts++; assert.equal((await readState("config.json")).enabled, true); assert.equal((await readState("setup.json")).step, 10); return { running: true }; },
  });
  assert.equal(result.enabled, true); assert.equal(result.running, true); assert.equal(starts, 1); assert.equal(checks, 1);
  assert.equal(await readState("setup.json"), null);
}));
test("failed installation retains the draft; focused autostart edit recovers without restarting setup", () => isolated(async () => {
  const pending = draft(); pending.config.autoStart = true; await saveState("setup.json", pending);
  await assert.rejects(chatControl("discord_chat_setup", { answer: "yes" }, {}, {
    stop: async () => {}, reconcile: async () => { throw new Error("Startup installation failed: denied"); }, start: async () => assert.fail("must not start"),
  }), /Startup installation failed/);
  assert.equal((await readState("config.json")).enabled, false);
  assert.deepEqual(await readState("setup.json"), pending);
  // Reproduce the original initial-state configuration as well.
  await saveState("config.json", { enabled: false });
  const edit = await chatControl("discord_chat_setup", { field: "autoStart" }, {});
  assert.equal(edit.step, "autoStart"); assert.equal(edit.settings.guildId, pending.config.guildId);
  assert.deepEqual((await readState("setup.json")).models, pending.models);
  assert.equal((await chatControl("discord_chat_setup", { answer: "no" }, {})).step, "finish");
  let tasks = 1; // A failed install may still have created an entry before failing verification.
  const recovered = await chatControl("discord_chat_setup", { answer: "yes" }, {}, {
    stop: async () => {}, reconcile: async enabled => { assert.equal(enabled, false); tasks = 0; return { present: false }; }, start: async () => ({ running: true }),
  });
  assert.equal(tasks, 0); assert.equal(recovered.enabled, true);
}));
test("removal failure blocks enabling and preserves recovery information", () => isolated(async () => {
  await assert.rejects(enableDraft(draft(), {
    stop: async () => {}, reconcile: async () => { throw new Error("Startup removal failed: denied"); }, start: async () => assert.fail("must not start"),
  }), /Startup removal failed/);
  assert.equal((await readState("config.json")).enabled, false); assert.equal((await readState("setup.json")).step, 10);
}));
test("unhealthy listener rolls back enablement and startup registration, retaining draft", () => isolated(async () => {
  const pending = draft(); pending.config.autoStart = true; const changes = [];
  await assert.rejects(enableDraft(pending, { stop: async () => {}, reconcile: async enabled => changes.push(enabled), start: async () => ({ running: false }) }), /health was not verified/);
  assert.deepEqual(changes, [true, false]); assert.equal((await readState("config.json")).enabled, false);
  assert.equal((await readState("config.json")).autoStart, false); assert.equal((await readState("setup.json")).config.autoStart, true);
}));
test("cleanup removal failure is not hidden behind listener failure", () => isolated(async () => {
  const pending = draft(); pending.config.autoStart = true;
  await assert.rejects(enableDraft(pending, { stop: async () => {}, reconcile: async enabled => { if (!enabled) throw new Error("Startup removal failed: denied"); }, start: async () => { throw new Error("listener failed"); } }), /listener failed.*Cleanup failed: Startup removal failed/s);
  assert.equal((await readState("config.json")).enabled, false); assert.ok(await readState("setup.json"));
}));
test("concurrent setup operations cannot create duplicate listeners or startup entries", () => isolated(async () => {
  await saveState("setup.json", draft()); let release, entered;
  const entering = new Promise(r => { entered = r; }); const block = new Promise(r => { release = r; }); let installs = 0, starts = 0;
  const first = chatControl("discord_chat_setup", { answer: "yes" }, {}, { stop: async () => { entered(); await block; }, reconcile: async () => { installs++; }, start: async () => { starts++; return { running: true }; } });
  await entering;
  await assert.rejects(chatControl("discord_chat_setup", { answer: "yes" }, {}), /operation is in progress/);
  release(); await first; assert.equal(installs, 1); assert.equal(starts, 1);
}));
test("start reuses an initializing listener and rejects readiness timeout without spawning a duplicate", () => isolated(async () => {
  await saveState("config.json", { ...configuration(), enabled: true });
  await assert.rejects(startListener({ spawnProcess: () => assert.fail("duplicate process"), getStatus: async () => ({ process_running: true, running: false }), sleep: async () => {}, attempts: 2 }), /health verification timed out/);
}));
test("start waits for matching health and reports child failure", () => isolated(async () => {
  await saveState("config.json", { ...configuration(), enabled: true }); let checks = 0;
  const spawnProcess = () => { const child = fakeChild(); queueMicrotask(() => child.emit("spawn")); return child; };
  const ready = await startListener({ spawnProcess, getStatus: async () => (++checks > 2 ? { running: true } : { process_running: false, running: false }), sleep: async () => {}, attempts: 3 });
  assert.equal(ready.running, true);
  let count = 0;
  await assert.rejects(startListener({ spawnProcess, getStatus: async () => (++count > 1 ? { running: false, health: { pid: 12345, error: "login failed" } } : { process_running: false, running: false }), sleep: async () => {}, attempts: 2 }), /login failed/);
}));
test("stale health from an old listener cannot claim enabled", () => isolated(async () => {
  await saveState("config.json", { ...configuration(), enabled: true });
  await saveState("lock.json", { pid: process.pid, instanceId: "new" });
  await saveState("health.json", { pid: process.pid, instanceId: "old", updatedAt: Date.now(), running: true });
  assert.equal((await status()).enabled, false);
  await saveState("health.json", { pid: process.pid, instanceId: "new", updatedAt: Date.now(), running: true });
  assert.equal((await status()).enabled, true);
}));

test("Windows Restricted policy: missing task removal is a verified idempotent no-op", { skip: process.platform !== "win32" }, () => isolated(async root => {
  const options = { spawnProcess: (cmd, args, opts) => spawn(cmd, ["-ExecutionPolicy", "Restricted", ...args], opts) };
  const first = await reconcileStartup(false, root, options);
  const second = await reconcileStartup(false, root, options);
  assert.equal(first.present, false); assert.equal(first.changed, false); assert.deepEqual(first, second);
  const enabled = await enableDraft(draft(), { stop: async () => {}, reconcile: value => reconcileStartup(value, root, options), start: async () => ({ running: true }) });
  assert.equal(enabled.enabled, true); assert.equal(await readState("setup.json"), null);
}));

// Explicit opt-in because this integration test briefly creates a real, non-running
// per-user startup shortcut for a unique temporary state directory and removes it.
test("Windows Restricted policy: install/update yields one entry, removal verifies absence", { skip: process.platform !== "win32" || process.env.DISCORD_TEST_STARTUP !== "1" }, () => isolated(async root => {
  const options = { spawnProcess: (cmd, args, opts) => spawn(cmd, ["-ExecutionPolicy", "Restricted", ...args], opts) };
  try {
    const first = await reconcileStartup(true, root, options); const second = await reconcileStartup(true, root, options);
    assert.equal(first.present, true); assert.equal(first.taskName, second.taskName);
    assert.equal(first.entryPath, second.entryPath);
    assert.equal((await fs.readdir(path.dirname(first.entryPath))).filter(name => name === path.basename(first.entryPath)).length, 1);
    const removed = await reconcileStartup(false, root, options); assert.equal(removed.changed, true); assert.equal(removed.present, false);
    assert.equal((await reconcileStartup(false, root, options)).changed, false);
  } finally { await reconcileStartup(false, root, options); }
}));
