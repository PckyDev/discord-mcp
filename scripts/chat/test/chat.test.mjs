import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { basePermissions, channelPermissions, requester, isActivation, ConfirmationStore, ToolPolicy } from "../policy.mjs";
import { ChatRuntime, main } from "../listener.mjs";
import { chatControl, readState, saveState, validateConfig } from "../config.mjs";
import { CodexAgent, agentEnvironment } from "../codex.mjs";
import { Gateway } from "../gateway.mjs";

const G = "111111111111111111", U = "222222222222222222", C = "333333333333333333", B = "444444444444444444", R = "555555555555555555", OTHER = "666666666666666666";
const config = () => ({ enabled: true, guildId: G, ownerId: U, userIds: [U], roleIds: [], channelIds: [C], model: "test-model", effort: "default", writeMode: "confirm", autoStart: false });
const message = () => ({ id: "777777777777777777", guild_id: G, channel_id: C, author: { id: U }, mentions: [{ id: B }], content: `<@${B}> hello` });
function fakeApi(admin = true) {
  const calls = [];
  const channels = new Map([[C, { id: C, guild_id: G, type: 0, permission_overwrites: [] }]]);
  const member = { user: { id: U }, roles: [R] };
  const roles = [{ id: G, permissions: "66560" }, { id: R, permissions: admin ? "8" : "0" }];
  const api = {
    calls, channels, member, roles,
    tools: [
      { name: "discord_api_read", annotations: { readOnlyHint: true } },
      { name: "discord_api_write" }, { name: "create_channel" }, { name: "list_channels", annotations: { readOnlyHint: true } },
      { name: "discord_chat_control" },
    ].map(t => ({ description: t.name, inputSchema: { type: "object" }, ...t })),
    async discord(p, options) {
      calls.push({ p, options });
      if (p === `/guilds/${G}`) return { id: G, owner_id: OTHER };
      if (p === `/guilds/${G}/roles`) return roles;
      if (p === `/guilds/${G}/members/${U}`) return member;
      if (p === `/channels/${C}/messages` && options?.method === "POST") return { id: "888888888888888888" };
      if (channels.has(p.split("/")[2]) && p.split("/").length === 3) return channels.get(p.split("/")[2]);
      throw new Error("Not found");
    },
    async authorizeApiPath(p) { return { path: p, guild_id: p.includes(OTHER) ? OTHER : G }; },
    async callTool(name, args) { calls.push({ name, args }); if (name === "list_channels") return [{ id: C }, { id: OTHER }]; return { id: "new-id", secret: "not for output" }; },
    requireAllowedGuild(id) { if (id !== G) throw new Error("Not allowed"); return id; },
  };
  return api;
}
test("activation requires mention or reply and ignores bots, webhooks, and DMs", () => {
  const m = message(); assert.equal(isActivation(m, B), true);
  assert.equal(isActivation({ ...m, mentions: [] }, B), false);
  assert.equal(isActivation({ ...m, mentions: [], referenced_message: { author: { id: B } } }, B), true);
  assert.equal(isActivation({ ...m, author: { id: U, bot: true } }, B), false);
  assert.equal(isActivation({ ...m, webhook_id: OTHER }, B), false);
  assert.equal(isActivation({ ...m, guild_id: undefined }, B), false);
});
test("permission overwrite precedence and administrator bypass", () => {
  const member = { user: { id: U }, roles: [R] };
  const ch = { permission_overwrites: [{ id: G, type: 0, deny: "1024", allow: "0" }, { id: R, type: 0, deny: "0", allow: "1024" }, { id: U, type: 1, deny: "1024", allow: "0" }] };
  assert.equal(channelPermissions(66560n, ch, G, member) & 1024n, 0n);
  assert.notEqual(channelPermissions(8n, ch, G, member) & 1024n, 0n);
  assert.notEqual(basePermissions({ id: G, owner_id: U }, [], member) & 8n, 0n);
});
test("requester allowlists, roles, revoked history, and private thread membership fail closed", async () => {
  const api = fakeApi(false), c = config(), m = message();
  await requester(api.discord, c, m);
  await assert.rejects(requester(api.discord, { ...c, userIds: [] }, m), /allowlisted/);
  await requester(api.discord, { ...c, userIds: [], roleIds: [R] }, m);
  api.channels.get(C).permission_overwrites = [{ id: U, type: 1, deny: "65536", allow: "0" }];
  await assert.rejects(requester(api.discord, c, m), /history/);
  api.channels.get(C).permission_overwrites = [];
  api.channels.set(OTHER, { id: OTHER, guild_id: G, type: 12, parent_id: C });
  await assert.rejects(requester(api.discord, c, { ...m, channel_id: OTHER }), /Not found/);
});
test("confirmation is random, expiring, exact, same-user/channel and single use", () => {
  let now = 1000; const store = new ConfirmationStore(() => now), m = message();
  const args = { name: "original" }; const id = store.create(m, "create_channel", args); args.name = "tampered";
  assert.match(id, /^[a-f0-9]{24}$/);
  assert.throws(() => store.take({ ...m, author: { id: OTHER } }, id));
  assert.throws(() => store.take({ ...m, channel_id: OTHER }, id));
  assert.equal(store.take(m, id).args.name, "original"); assert.throws(() => store.take(m, id));
  const expired = store.create(m, "create_channel", {}); now += 300001; assert.throws(() => store.take(m, expired));
});
test("model cannot execute its own confirmation; requester privileges are rechecked", async () => {
  const api = fakeApi(), store = new ConfirmationStore(), sent = [];
  const policy = new ToolPolicy({ config: config(), message: message(), api, confirmations: store, send: async s => sent.push(s) });
  const proposal = await policy.call("create_channel", { guild_id: G, name: "hello", confirm_token: "forged" });
  assert.equal(proposal.pending_confirmation, true); assert.equal(api.calls.filter(c => c.name).length, 0);
  const id = [...store.entries.keys()][0]; assert.match(sent[0], new RegExp(id));
  api.roles[1].permissions = "0";
  await assert.rejects(policy.confirm(id), /Administrator/);
  assert.equal(api.calls.filter(c => c.name).length, 0);
});
test("approved writes reuse exact stored request; direct results cannot leak raw payloads", async () => {
  const api = fakeApi(), store = new ConfirmationStore();
  const policy = new ToolPolicy({ config: config(), message: message(), api, confirmations: store, send: async () => {} });
  await policy.call("create_channel", { guild_id: G, name: "hello" });
  await policy.confirm([...store.entries.keys()][0]);
  assert.equal(api.calls.find(c => c.name).args.name, "hello");
  policy.config.writeMode = "direct";
  assert.deepEqual(await policy.call("create_channel", { guild_id: G, name: "world" }), { success: true, id: "new-id" });
});
test("context reads bound query size and reject cross-channel, cross-server and control tools", async () => {
  const api = fakeApi();
  const p = new ToolPolicy({ config: config(), message: message(), api, confirmations: new ConfirmationStore(), send: async () => {} });
  await p.call("discord_api_read", { path: `/channels/${C}/messages`, query: { around: message().id, limit: 1000 } });
  assert.equal(api.calls.find(c => c.name).args.query.limit, 50);
  await assert.rejects(p.call("discord_api_read", { path: `/channels/${OTHER}/messages` }), /outside/);
  await assert.rejects(p.call("discord_api_read", { path: `/guilds/${G}/messages/search` }), /Read route/);
  await assert.rejects(p.call("discord_chat_control", { action: "disable" }), /not available/);
  await assert.rejects(p.call("create_channel", { guild_id: OTHER, name: "bad" }), /Cross-server/);
  assert.deepEqual(await p.call("list_channels", { guild_id: G }), [{ id: C }]);
});
test("runtime deduplicates, separates sessions, suppresses mentions, and supports reset", async () => {
  const api = fakeApi(); let now = 100000; const runs = [];
  const agent = { async run(c, thread, tools, input) { runs.push({ thread, input, tools }); return { threadId: "thread-1", text: "Hello @everyone" }; }, close() {} };
  const rt = new ChatRuntime({ config: config(), botId: B, apiClient: api, agent, now: () => now });
  await rt.enqueue(message()); await rt.enqueue(message()); assert.equal(runs.length, 1);
  now += 6000; await rt.enqueue({ ...message(), id: "777777777777777778" }); assert.equal(runs[1].thread, "thread-1");
  assert.equal(runs[0].tools.some(t => t.name.startsWith("discord_chat_")), false);
  const post = api.calls.find(x => x.options?.method === "POST"); assert.deepEqual(post.options.body.allowed_mentions, { parse: [], replied_user: false });
  now += 6000; await rt.enqueue({ ...message(), id: "777777777777777779", content: `<@${B}> reset conversation` }); assert.equal(rt.sessions.size, 0);
  rt.close(); await rt.enqueue({ ...message(), id: "777777777777777780" }); assert.equal(runs.length, 2);
});
test("setup starts disabled, asks one question, validates choices, and does not start a listener", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "discord-chat-test-")); const previous = process.env.DISCORD_CHAT_HOME; process.env.DISCORD_CHAT_HOME = root;
  try {
    assert.equal((await chatControl("discord_chat_status", {}, {})).config.enabled, false);
    const first = await chatControl("discord_chat_setup", {}, {}); assert.equal(first.step, "auth"); assert.equal(typeof first.question, "string");
    assert.equal(await readState("config.json"), null); assert.equal(await readState("lock.json"), null);
    await main(); assert.equal(await readState("lock.json"), null);
    await saveState("setup.json", { step: 9, config: config() });
    await assert.rejects(chatControl("discord_chat_setup", { answer: "maybe" }, fakeApi()), /yes or no/);
    const next = await chatControl("discord_chat_setup", { answer: "no" }, fakeApi()); assert.equal(next.step, "finish");
    await chatControl("discord_chat_setup", { answer: "no" }, fakeApi()); assert.equal(await readState("config.json"), null);
    await saveState("config.json", config());
    const edit = await chatControl("discord_chat_setup", { field: "userIds" }, fakeApi()); assert.equal(edit.step, "userIds");
    const review = await chatControl("discord_chat_setup", { answer: "only me" }, fakeApi()); assert.equal(review.step, "finish");
    assert.equal((await readState("config.json")).enabled, true);
    assert.equal((await chatControl("discord_chat_setup", { answer: "no" }, fakeApi())).enabled, true);
    assert.throws(() => validateConfig({ ...config(), channelIds: [] }));
    assert.throws(() => validateConfig({ ...config(), userIds: [] }));
  } finally { if (previous === undefined) delete process.env.DISCORD_CHAT_HOME; else process.env.DISCORD_CHAT_HOME = previous; await fs.rm(root, { recursive: true, force: true }); }
});
test("valid human confirmation bypasses model cooldown and cannot be executed twice", async () => {
  const api = fakeApi(); let runs = 0;
  const agent = { async run() { runs++; return { threadId: "t", text: "hello" }; }, close() {} };
  const rt = new ChatRuntime({ config: config(), botId: B, apiClient: api, agent, now: () => 100000 });
  await rt.enqueue(message());
  const id = rt.confirmations.create(message(), "create_channel", { guild_id: G, name: "approved" });
  await rt.enqueue({ ...message(), id: "777777777777777781", content: `<@${B}> confirm ${id}` });
  assert.equal(api.calls.filter(x => x.name === "create_channel").length, 1);
  await rt.enqueue({ ...message(), id: "777777777777777782", content: `<@${B}> confirm ${id}` });
  assert.equal(api.calls.filter(x => x.name === "create_channel").length, 1); assert.equal(runs, 1);
});
test("a stopped bridge cannot execute a pending approval", async () => {
  const api = fakeApi(), store = new ConfirmationStore();
  const id = store.create(message(), "create_channel", { guild_id: G, name: "blocked" });
  const p = new ToolPolicy({ config: config(), message: message(), api, confirmations: store, send: async () => {}, checkActive: async () => { throw new Error("disabled"); } });
  await assert.rejects(p.confirm(id), /disabled/); assert.equal(api.calls.length, 0);
});
test("agent environment excludes bot secrets and inherited Codex settings", () => {
  const env = agentEnvironment("/isolated"); assert.equal(env.DISCORD_BOT_TOKEN, undefined); assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.CODEX_HOME, path.join("/isolated", "agent-home"));
});
test("app-server payload locks model, removes environment and exposes only supplied tools", async () => {
  const agent = new CodexAgent("/test"); const calls = [];
  agent.rpc = async (method, params) => { calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "t" } };
    if (method === "turn/start") {
      await agent.receive({ method: "item/completed", params: { threadId: "t", item: { type: "agentMessage", text: "ok" } } });
      await agent.receive({ method: "turn/completed", params: { threadId: "t", turn: { status: "completed" } } });
      return {};
    }
  };
  const result = await agent.run(config(), null, fakeApi().tools.slice(0, 1), { request: "hello" }, async () => ({}));
  assert.equal(result.text, "ok"); assert.deepEqual(calls[0].params.environments, []); assert.equal(calls[0].params.allowProviderModelFallback, false); assert.equal(calls[1].params.model, config().model);
});
test("app-server denies other requests and stops on model rerouting", async () => {
  const agent = new CodexAgent("/test"); const sent = []; agent.send = m => sent.push(m);
  await agent.receive({ id: 1, method: "item/permissions/requestApproval", params: {} }); assert.equal(sent[0].error.code, -32601);
  let rejected = ""; agent.active = { threadId: "t", warnings: [], reject: e => { rejected = e.message; } };
  await agent.receive({ method: "model/rerouted", params: { threadId: "t", fromModel: "a", toModel: "b" } }); assert.match(rejected, /Locked-model run stopped/); assert.equal(agent.active, null);
});
test("Gateway identifies, resumes and stops on privileged-intent rejection", () => {
  const sockets = [], errors = [], ready = [], messages = [];
  class FakeSocket {
    constructor() { this.handlers = {}; this.readyState = 1; this.sent = []; sockets.push(this); }
    addEventListener(k, fn) { this.handlers[k] = fn; }
    send(s) { this.sent.push(JSON.parse(s)); }
    close() {}
  }
  const g = new Gateway({ token: "test", WebSocketImpl: FakeSocket, onReady: x => ready.push(x), onMessage: x => messages.push(x), onError: (...x) => errors.push(x), random: () => 0.5 });
  try {
    g.connect(); g.packet({ op: 10, d: { heartbeat_interval: 60000 } }); assert.equal(sockets[0].sent[0].op, 2); assert.equal(sockets[0].sent[0].d.intents, 33281);
    g.packet({ op: 0, t: "READY", s: 1, d: { session_id: "s", resume_gateway_url: "wss://gateway.discord.gg", user: { id: B } } });
    g.packet({ op: 0, t: "MESSAGE_CREATE", s: 2, d: message() }); assert.equal(messages.length, 1);
    g.connect(); g.packet({ op: 10, d: { heartbeat_interval: 60000 } }); assert.equal(sockets[1].sent[0].op, 6); assert.equal(sockets[1].sent[0].d.seq, 2);
    sockets[1].handlers.close({ code: 4014 }); assert.equal(errors[0][1], true); assert.equal(g.closed, true);
  } finally { g.close(); }
});
