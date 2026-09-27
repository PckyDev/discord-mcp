import { randomBytes } from "node:crypto";

const VIEW = 1n << 10n, HISTORY = 1n << 16n, ADMIN = 8n;
export function basePermissions(guild, roles, member) {
  if (guild.owner_id === member.user.id) return ~0n;
  return roles.filter(r => r.id === guild.id || member.roles.includes(r.id)).reduce((p, r) => p | BigInt(r.permissions), 0n);
}
export function channelPermissions(base, channel, guildId, member) {
  if ((base & ADMIN) === ADMIN) return ~0n;
  const overwrites = channel.permission_overwrites || [];
  const apply = (p, o) => (p & ~BigInt(o?.deny || 0)) | BigInt(o?.allow || 0);
  let result = apply(base, overwrites.find(o => o.id === guildId));
  let allow = 0n, deny = 0n;
  for (const o of overwrites.filter(o => Number(o.type) === 0 && member.roles.includes(o.id))) { allow |= BigInt(o.allow); deny |= BigInt(o.deny); }
  result = (result & ~deny) | allow;
  return apply(result, overwrites.find(o => Number(o.type) === 1 && o.id === member.user.id));
}
export async function isAdministrator(discord, guildId, userId) {
  const [guild, roles, member] = await Promise.all([discord(`/guilds/${guildId}`), discord(`/guilds/${guildId}/roles`), discord(`/guilds/${guildId}/members/${userId}`)]);
  return (basePermissions(guild, roles, member) & ADMIN) === ADMIN;
}
export async function requester(discord, config, message) {
  if (message.guild_id !== config.guildId || !message.author?.id || message.author.bot || message.webhook_id) throw new Error("Not an eligible server message.");
  const [guild, roles, member, channel] = await Promise.all([
    discord(`/guilds/${config.guildId}`), discord(`/guilds/${config.guildId}/roles`),
    discord(`/guilds/${config.guildId}/members/${message.author.id}`), discord(`/channels/${message.channel_id}`),
  ]);
  if (channel.guild_id !== config.guildId) throw new Error("Channel is outside the configured server.");
  if (!config.userIds.includes(message.author.id) && !member.roles.some(r => config.roleIds.includes(r))) throw new Error("Requester is not allowlisted.");
  const thread = [10, 11, 12].includes(channel.type);
  if (!config.channelIds.includes(channel.id) && !(thread && config.channelIds.includes(channel.parent_id))) throw new Error("Channel is not allowlisted.");
  const parent = thread ? await discord(`/channels/${channel.parent_id}`) : channel;
  const base = basePermissions(guild, roles, member);
  const permissions = channelPermissions(base, parent, guild.id, member);
  if ((permissions & (VIEW | HISTORY)) !== (VIEW | HISTORY)) throw new Error("Requester cannot view this channel's history.");
  if (channel.type === 12 && !(permissions & (1n << 34n))) await discord(`/channels/${channel.id}/thread-members/${member.user.id}`);
  return { administrator: Boolean(base & ADMIN), member, channel, fingerprint: JSON.stringify([member.roles, parent.permission_overwrites, guild.owner_id, roles.map(r => [r.id, r.permissions])]) };
}
export function isActivation(message, botId) {
  return !message.author?.bot && !message.webhook_id && Boolean(message.guild_id) &&
    (message.mentions?.some(u => u.id === botId) || message.referenced_message?.author?.id === botId);
}
export function conversationKey(message) { return `${message.guild_id}:${message.channel_id}:${message.author.id}`; }
export class ConfirmationStore {
  constructor(now = Date.now) { this.now = now; this.entries = new Map(); }
  prune() { for (const [key, entry] of this.entries) if (entry.expires < this.now()) this.entries.delete(key); }
  create(message, name, args) {
    this.prune(); if (this.entries.size >= 100) throw new Error("Too many pending confirmations.");
    const id = randomBytes(12).toString("hex");
    this.entries.set(id, { key: conversationKey(message), name, args: structuredClone(args), expires: this.now() + 300000 });
    return id;
  }
  take(message, id) {
    this.prune(); const entry = this.entries.get(id);
    if (!entry || entry.key !== conversationKey(message)) throw new Error("Confirmation expired or belongs to another requester/channel.");
    this.entries.delete(id); return entry;
  }
}
export class ToolPolicy {
  constructor({ config, message, api, confirmations, send, checkActive = async () => {} }) { Object.assign(this, { config, message, api, confirmations, send, checkActive }); this.calls = 0; }
  async authorize(name, args) {
    await this.checkActive();
    const identity = await requester(this.api.discord, this.config, this.message);
    const tool = this.api.tools.find(t => t.name === name && !t.name.startsWith("discord_chat_") && t.name !== "discord_status");
    if (!tool) throw new Error("Tool is not available in Discord chat.");
    const read = tool.annotations?.readOnlyHint === true;
    if (!read && !identity.administrator) throw new Error("Server changes through chat currently require the requester's Administrator permission, not just the bot's.");
    if (args.guild_id && args.guild_id !== this.config.guildId) throw new Error("Cross-server access denied.");
    if (args.channel_id) {
      const c = await this.api.discord(`/channels/${args.channel_id}`);
      if (c.guild_id !== this.config.guildId) throw new Error("Cross-server access denied.");
      if (read && c.id !== this.message.channel_id) throw new Error("Message context stays in the current channel or forum thread to avoid leaking private discussions.");
    }
    if (name === "discord_api_read" || name === "discord_api_write") {
      const route = await this.api.authorizeApiPath(args.path, { readOnly: read });
      if (route.guild_id !== this.config.guildId) throw new Error("Route is outside this server.");
      if (read) {
        const ch = this.message.channel_id, g = this.config.guildId;
        const safe = new RegExp(`^/channels/${ch}(?:/messages(?:/[0-9]{17,20})?|/pins)?$`);
        if (!safe.test(route.path) && ![`/guilds/${g}`, `/guilds/${g}/roles`].includes(route.path)) throw new Error("Read route not available in chat. Use current-channel messages, guild metadata, or roles.");
        args = { ...args, query: { ...args.query, ...(route.path.endsWith("/messages") ? { limit: Math.min(50, Math.max(1, Number(args.query?.limit) || 25)) } : {}) } };
      }
    }
    if (name === "list_guilds") throw new Error("Use the server ID in the request envelope.");
    return { read, args };
  }
  async execute(name, args) {
    await this.checkActive();
    let result = await this.api.callTool(name, args);
    // Existing MCP preview tokens are not user approval. Only the bridge can execute
    // the exact stored request after receiving a separate human confirmation message.
    if (result?.confirmation_required) { await this.checkActive(); result = await this.api.callTool(name, { ...args, confirm_token: result.confirm_token }); }
    // Mutation responses can contain messages, tokens, invites, or webhook metadata.
    // They must not become a cross-channel read mechanism for the model.
    return { success: true, id: result?.id || result?.data?.id || null };
  }
  async call(name, original = {}) {
    if (++this.calls > 20) throw new Error("Tool limit reached. Ask the user to narrow the request.");
    const argsCopy = structuredClone(original); delete argsCopy.confirm_token;
    const { read, args } = await this.authorize(name, argsCopy);
    if (read) {
      if (name === "list_channels") {
        // Do not reveal names/topics of other private channels in a public response.
        return (await this.api.callTool(name, args)).filter(c => c.id === this.message.channel_id);
      }
      return this.api.callTool(name, args);
    }
    if (this.config.writeMode === "confirm") {
      const serialized = JSON.stringify({ tool: name, arguments: args }, null, 2);
      if (serialized.length > 12000) throw new Error("Change is too large to review. Split it into smaller changes.");
      const visible = serialized.replace(/[\\`*_~|>\[\]()]/g, "\\$&");
      if (visible.length > 12000) throw new Error("Change is too large to review. Split it into smaller changes.");
      const id = this.confirmations.create(this.message, name, args);
      await this.send(`Proposed change for user ${this.message.author.id}:\n${visible}\n\nTo approve this exact change within 5 minutes, mention or reply to me with: confirm ${id}`);
      return { pending_confirmation: true, message: "The bridge posted the exact proposal. Wait for the human's confirmation; do not repeat it." };
    }
    return this.execute(name, args);
  }
  async confirm(id) {
    const entry = this.confirmations.take(this.message, id);
    await this.authorize(entry.name, entry.args);
    await this.execute(entry.name, entry.args);
    return "Confirmed change completed.";
  }
}
