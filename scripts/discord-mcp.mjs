#!/usr/bin/env node

import readline from "node:readline";
import { createHash } from "node:crypto";

const API_BASE = "https://discord.com/api/v10";
const SERVER_VERSION = "0.1.0";
const ADMINISTRATOR_PERMISSIONS = "8";
const RECOMMENDED_PERMISSIONS = "268504080";
const SNOWFLAKE = /^\d{17,20}$/;
const CHANNEL_TYPES = {
  text: 0,
  voice: 2,
  category: 4,
  announcement: 5,
  stage: 13,
  forum: 15,
};

const token = (process.env.DISCORD_BOT_TOKEN || "").trim();
const allowedGuilds = new Set(
  (process.env.DISCORD_ALLOWED_GUILD_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const idSchema = (description) => ({ type: "string", pattern: "^[0-9]{17,20}$", description });

const tools = [
  {
    name: "discord_status",
    description: "Check whether the Discord bot is configured, validate its token, and return both Administrator and least-privilege OAuth invite URLs.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "list_guilds",
    description: "List Discord servers the bot can access, filtered by the configured guild allowlist.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "list_channels",
    description: "List channels in an authorized Discord server, sorted by position.",
    inputSchema: objectSchema({ guild_id: idSchema("Discord server (guild) ID") }, ["guild_id"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "create_channel",
    description: "Create a text, voice, category, announcement, stage, or forum channel in an authorized Discord server.",
    inputSchema: objectSchema(
      {
        guild_id: idSchema("Discord server (guild) ID"),
        name: { type: "string", minLength: 1, maxLength: 100 },
        channel_type: { type: "string", enum: Object.keys(CHANNEL_TYPES), default: "text" },
        parent_id: idSchema("Optional category channel ID"),
        topic: { type: "string", maxLength: 1024 },
        nsfw: { type: "boolean" },
        slowmode_seconds: { type: "integer", minimum: 0, maximum: 21600 },
        position: { type: "integer", minimum: 0 },
        reason: { type: "string", maxLength: 512, description: "Discord audit-log reason" },
      },
      ["guild_id", "name"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "edit_channel",
    description: "Edit an authorized Discord channel. Only supplied fields are changed.",
    inputSchema: objectSchema(
      {
        channel_id: idSchema("Discord channel ID"),
        name: { type: "string", minLength: 1, maxLength: 100 },
        parent_id: { anyOf: [idSchema("Category channel ID"), { type: "null" }] },
        topic: { anyOf: [{ type: "string", maxLength: 1024 }, { type: "null" }] },
        nsfw: { type: "boolean" },
        slowmode_seconds: { type: "integer", minimum: 0, maximum: 21600 },
        position: { type: "integer", minimum: 0 },
        reason: { type: "string", maxLength: 512, description: "Discord audit-log reason" },
      },
      ["channel_id"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "delete_channel",
    description: "Delete an authorized Discord channel. First call without confirm_token to receive the exact target-specific confirmation token.",
    inputSchema: objectSchema(
      {
        channel_id: idSchema("Discord channel ID"),
        confirm_token: { type: "string", description: "Exact token returned by the preview call" },
        reason: { type: "string", maxLength: 512, description: "Discord audit-log reason" },
      },
      ["channel_id"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "send_message",
    description: "Send a plain-text message to an authorized Discord channel. Mentions are suppressed unless allow_mentions is true.",
    inputSchema: objectSchema(
      {
        channel_id: idSchema("Discord text channel ID"),
        content: { type: "string", minLength: 1, maxLength: 2000 },
        allow_mentions: { type: "boolean", default: false },
        suppress_embeds: { type: "boolean", default: false },
      },
      ["channel_id", "content"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "list_roles",
    description: "List roles in an authorized Discord server, sorted from highest to lowest position.",
    inputSchema: objectSchema({ guild_id: idSchema("Discord server (guild) ID") }, ["guild_id"]),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "create_role",
    description: "Create a role in an authorized Discord server. Permissions must be a Discord permission bitfield string; omit it for no permissions.",
    inputSchema: objectSchema(
      {
        guild_id: idSchema("Discord server (guild) ID"),
        name: { type: "string", minLength: 1, maxLength: 100 },
        color: { type: "integer", minimum: 0, maximum: 16777215, description: "Decimal RGB color value" },
        permissions: { type: "string", pattern: "^[0-9]+$", description: "Discord permissions bitfield as a decimal string" },
        hoist: { type: "boolean" },
        mentionable: { type: "boolean" },
        reason: { type: "string", maxLength: 512, description: "Discord audit-log reason" },
      },
      ["guild_id", "name"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "edit_role",
    description: "Edit a role in an authorized Discord server. Only supplied fields are changed.",
    inputSchema: objectSchema(
      {
        guild_id: idSchema("Discord server (guild) ID"),
        role_id: idSchema("Discord role ID"),
        name: { type: "string", minLength: 1, maxLength: 100 },
        color: { type: "integer", minimum: 0, maximum: 16777215 },
        permissions: { type: "string", pattern: "^[0-9]+$" },
        hoist: { type: "boolean" },
        mentionable: { type: "boolean" },
        reason: { type: "string", maxLength: 512, description: "Discord audit-log reason" },
      },
      ["guild_id", "role_id"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "delete_role",
    description: "Delete a role from an authorized Discord server. First call without confirm_token to receive the exact target-specific confirmation token.",
    inputSchema: objectSchema(
      {
        guild_id: idSchema("Discord server (guild) ID"),
        role_id: idSchema("Discord role ID"),
        confirm_token: { type: "string", description: "Exact token returned by the preview call" },
        reason: { type: "string", maxLength: 512, description: "Discord audit-log reason" },
      },
      ["guild_id", "role_id"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "add_member_role",
    description: "Assign a role to a member in an authorized Discord server.",
    inputSchema: objectSchema(
      {
        guild_id: idSchema("Discord server (guild) ID"),
        member_id: idSchema("Discord user/member ID"),
        role_id: idSchema("Discord role ID"),
        reason: { type: "string", maxLength: 512, description: "Discord audit-log reason" },
      },
      ["guild_id", "member_id", "role_id"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "remove_member_role",
    description: "Remove a role from a member in an authorized Discord server.",
    inputSchema: objectSchema(
      {
        guild_id: idSchema("Discord server (guild) ID"),
        member_id: idSchema("Discord user/member ID"),
        role_id: idSchema("Discord role ID"),
        reason: { type: "string", maxLength: 512, description: "Discord audit-log reason" },
      },
      ["guild_id", "member_id", "role_id"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "discord_api_read",
    description: "Call any guild-scoped Discord API v10 JSON endpoint with GET when no dedicated tool exists. The route is checked against the guild allowlist; channel, stage, invite, and bot-managed webhook routes are resolved back to their guild before execution.",
    inputSchema: objectSchema(
      {
        path: { type: "string", minLength: 1, maxLength: 500, description: "Discord API path beginning with /, without /api/v10 or a query string" },
        query: {
          type: "object",
          description: "Optional query parameters",
          additionalProperties: {
            anyOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
              { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } },
            ],
          },
        },
      },
      ["path"],
    ),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "discord_api_write",
    description: "Call any guild-scoped Discord API v10 JSON endpoint with POST, PUT, PATCH, or DELETE when no dedicated tool exists. Every request requires a preview call followed by the exact body-bound confirmation token. Credential-bearing and non-guild routes are blocked.",
    inputSchema: objectSchema(
      {
        method: { type: "string", enum: ["POST", "PUT", "PATCH", "DELETE"] },
        path: { type: "string", minLength: 1, maxLength: 500, description: "Discord API path beginning with /, without /api/v10 or a query string" },
        query: {
          type: "object",
          description: "Optional query parameters",
          additionalProperties: {
            anyOf: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
              { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } },
            ],
          },
        },
        body: { description: "Optional JSON request body matching Discord's official endpoint schema" },
        reason: { type: "string", maxLength: 512, description: "Discord audit-log reason" },
        confirm_token: { type: "string", description: "Exact request-bound token returned by the preview call" },
      },
      ["method", "path"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
];

function requireToken() {
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is not configured. Run scripts/configure.ps1, then restart Codex.");
  }
}

function requireId(value, label) {
  if (!SNOWFLAKE.test(String(value || ""))) throw new Error(`${label} must be a valid Discord snowflake ID.`);
  return String(value);
}

function requireAllowedGuild(guildId) {
  const id = requireId(guildId, "guild_id");
  if (allowedGuilds.size && !allowedGuilds.has(id)) {
    throw new Error(`Guild ${id} is not in DISCORD_ALLOWED_GUILD_IDS.`);
  }
  return id;
}

async function discord(path, { method = "GET", body, reason, retries = 2 } = {}) {
  requireToken();
  const headers = { Authorization: `Bot ${token}`, "User-Agent": "DiscordMCP/0.1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(reason.slice(0, 512));

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 429 && retries > 0) {
    const rate = await response.json().catch(() => ({}));
    const waitMs = Math.min(Math.ceil(Number(rate.retry_after || 1) * 1000), 15000);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return discord(path, { method, body, reason, retries: retries - 1 });
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const detail = data?.message || text || response.statusText;
    throw new Error(`Discord API ${response.status}: ${detail}`);
  }
  return data;
}

function normalizeApiPath(rawPath) {
  const path = String(rawPath || "").trim();
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("path must begin with one /.");
  if (path.includes("?") || path.includes("#")) throw new Error("Put query parameters in the query object, not in path.");
  if (path.includes("\\") || /%2f|%5c/i.test(path) || path.split("/").includes("..")) {
    throw new Error("Encoded slashes, backslashes, and parent-path segments are not allowed.");
  }
  if (/^\/api(?:\/v\d+)?(?:\/|$)/i.test(path)) throw new Error("Omit /api and /api/v10; paths are relative to Discord API v10.");
  if (/^\/(?:interactions|oauth2\/token)(?:\/|$)/i.test(path)) {
    throw new Error("Interaction callbacks and OAuth token routes require temporary user-facing credentials and are blocked.");
  }
  if (/^\/webhooks\/\d{17,20}\/[^/]+/i.test(path)) {
    throw new Error("Webhook-token routes are blocked. Bot-authenticated webhook management routes remain available.");
  }
  return path.replace(/\/$/, "") || "/";
}

function addQuery(path, query) {
  if (query === undefined) return path;
  if (!query || typeof query !== "object" || Array.isArray(query)) throw new Error("query must be an object.");
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (!["string", "number", "boolean"].includes(typeof value)) throw new Error(`Invalid query value for ${key}.`);
      params.append(key, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

function rejectSecrets(value, trail = "body") {
  if (value === null || value === undefined || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecrets(item, `${trail}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:authorization|access_token|refresh_token|client_secret|bot_token|webhook_token|token)$/i.test(key)) {
      throw new Error(`Credential-bearing field ${trail}.${key} is blocked.`);
    }
    rejectSecrets(child, `${trail}.${key}`);
  }
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = /^(?:authorization|access_token|refresh_token|client_secret|bot_token|webhook_token|token)$/i.test(key)
      ? "[REDACTED]"
      : redactSecrets(child);
  }
  return result;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function genericWriteToken(method, path, query, body, reason) {
  const fingerprint = createHash("sha256")
    .update(stableJson({ method, path, query: query || null, body: body ?? null, reason: reason || null }))
    .digest("hex")
    .slice(0, 20);
  return `DISCORD_API_WRITE:${method}:${fingerprint}`;
}

async function authorizeApiPath(rawPath, { readOnly = false } = {}) {
  const path = normalizeApiPath(rawPath);
  const segments = path.split("/").filter(Boolean);
  if (segments[0] === "guilds" && SNOWFLAKE.test(segments[1] || "")) {
    return { path, guild_id: requireAllowedGuild(segments[1]) };
  }
  if (segments[0] === "applications" && SNOWFLAKE.test(segments[1] || "") && segments[2] === "guilds" && SNOWFLAKE.test(segments[3] || "")) {
    return { path, guild_id: requireAllowedGuild(segments[3]), resolved_via: "application_guild" };
  }
  if (segments[0] === "users" && segments[1] === "@me" && segments[2] === "guilds" && SNOWFLAKE.test(segments[3] || "")) {
    return { path, guild_id: requireAllowedGuild(segments[3]), resolved_via: "current_user_guild" };
  }

  if (segments[0] === "channels" && SNOWFLAKE.test(segments[1] || "")) {
    const channel = await channelAndGuild(segments[1]);
    return { path, guild_id: channel.guild_id, resolved_via: "channel" };
  }
  if (segments[0] === "stage-instances" && SNOWFLAKE.test(segments[1] || "")) {
    const channel = await channelAndGuild(segments[1]);
    return { path, guild_id: channel.guild_id, resolved_via: "stage_channel" };
  }
  if (segments[0] === "webhooks" && SNOWFLAKE.test(segments[1] || "") && segments.length === 2) {
    const webhook = await discord(`/webhooks/${segments[1]}`);
    if (!webhook?.guild_id) throw new Error("Only guild-owned, bot-authenticated webhooks are supported.");
    return { path, guild_id: requireAllowedGuild(webhook.guild_id), resolved_via: "webhook" };
  }
  if (segments[0] === "invites" && segments[1] && segments.length === 2) {
    const invite = await discord(`/invites/${encodeURIComponent(segments[1])}`);
    if (!invite?.guild?.id) throw new Error("Only guild invites are supported.");
    return { path, guild_id: requireAllowedGuild(invite.guild.id), resolved_via: "invite" };
  }

  const safeGlobalReads = new Set([
    "/gateway",
    "/gateway/bot",
    "/voice/regions",
    "/users/@me",
    "/applications/@me",
    "/oauth2/applications/@me",
    "/soundboard-default-sounds",
  ]);
  if (readOnly && safeGlobalReads.has(path)) return { path, guild_id: null, resolved_via: "safe_global_read" };

  throw new Error("The route could not be proven to belong to an allowed guild. Use a /guilds/{guild_id}, /channels/{channel_id}, /stage-instances/{channel_id}, /invites/{code}, or bot-authenticated /webhooks/{webhook_id} route.");
}

async function channelAndGuild(channelId) {
  const id = requireId(channelId, "channel_id");
  const channel = await discord(`/channels/${id}`);
  if (!channel.guild_id) throw new Error("DM and group-DM channels are not supported.");
  requireAllowedGuild(channel.guild_id);
  return channel;
}

function pick(source, mapping) {
  const result = {};
  for (const [from, to = from] of mapping) {
    if (Object.prototype.hasOwnProperty.call(source, from)) result[to] = source[from];
  }
  return result;
}

function cleanChannel(channel) {
  return pick(channel, [
    ["id"], ["guild_id"], ["name"], ["type"], ["position"], ["parent_id"], ["topic"], ["nsfw"], ["rate_limit_per_user"],
  ]);
}

function cleanRole(role) {
  return pick(role, [["id"], ["name"], ["color"], ["hoist"], ["position"], ["permissions"], ["managed"], ["mentionable"]]);
}

async function callTool(name, args = {}) {
  switch (name) {
    case "discord_status": {
      if (!token) {
        return { configured: false, allowlist_enabled: allowedGuilds.size > 0, message: "Run scripts/configure.ps1 and restart Codex." };
      }
      const bot = await discord("/users/@me");
      const administratorInviteUrl = `https://discord.com/oauth2/authorize?client_id=${bot.id}&permissions=${ADMINISTRATOR_PERMISSIONS}&scope=bot%20applications.commands`;
      const leastPrivilegeInviteUrl = `https://discord.com/oauth2/authorize?client_id=${bot.id}&permissions=${RECOMMENDED_PERMISSIONS}&scope=bot%20applications.commands`;
      return {
        configured: true,
        bot: pick(bot, [["id"], ["username"], ["global_name"], ["bot"]]),
        allowlist_enabled: allowedGuilds.size > 0,
        allowed_guild_ids: [...allowedGuilds],
        invite_url: administratorInviteUrl,
        administrator_invite_url: administratorInviteUrl,
        least_privilege_invite_url: leastPrivilegeInviteUrl,
        note: "The Administrator invite requests permission bit 8. It grants all permissions and bypasses channel overwrites, but Discord role hierarchy still applies.",
      };
    }
    case "list_guilds": {
      const guilds = await discord("/users/@me/guilds");
      return guilds
        .filter((guild) => !allowedGuilds.size || allowedGuilds.has(guild.id))
        .map((guild) => pick(guild, [["id"], ["name"], ["owner"], ["permissions"]]));
    }
    case "list_channels": {
      const guildId = requireAllowedGuild(args.guild_id);
      const channels = await discord(`/guilds/${guildId}/channels`);
      return channels.sort((a, b) => a.position - b.position).map(cleanChannel);
    }
    case "create_channel": {
      const guildId = requireAllowedGuild(args.guild_id);
      const body = {
        name: args.name,
        type: CHANNEL_TYPES[args.channel_type || "text"],
        ...pick(args, [["parent_id"], ["topic"], ["nsfw"], ["slowmode_seconds", "rate_limit_per_user"], ["position"]]),
      };
      return cleanChannel(await discord(`/guilds/${guildId}/channels`, { method: "POST", body, reason: args.reason }));
    }
    case "edit_channel": {
      const channel = await channelAndGuild(args.channel_id);
      const body = pick(args, [["name"], ["parent_id"], ["topic"], ["nsfw"], ["slowmode_seconds", "rate_limit_per_user"], ["position"]]);
      if (!Object.keys(body).length) throw new Error("Supply at least one channel field to edit.");
      return cleanChannel(await discord(`/channels/${channel.id}`, { method: "PATCH", body, reason: args.reason }));
    }
    case "delete_channel": {
      const channel = await channelAndGuild(args.channel_id);
      const expected = `DELETE_CHANNEL:${channel.id}`;
      if (args.confirm_token !== expected) {
        return { deleted: false, preview: cleanChannel(channel), confirmation_required: true, confirm_token: expected };
      }
      return { deleted: true, channel: cleanChannel(await discord(`/channels/${channel.id}`, { method: "DELETE", reason: args.reason })) };
    }
    case "send_message": {
      const channel = await channelAndGuild(args.channel_id);
      const body = {
        content: args.content,
        allowed_mentions: args.allow_mentions ? { parse: ["users", "roles", "everyone"] } : { parse: [] },
      };
      if (args.suppress_embeds) body.flags = 4;
      const message = await discord(`/channels/${channel.id}/messages`, { method: "POST", body });
      return pick(message, [["id"], ["channel_id"], ["guild_id"], ["content"], ["timestamp"]]);
    }
    case "list_roles": {
      const guildId = requireAllowedGuild(args.guild_id);
      const roles = await discord(`/guilds/${guildId}/roles`);
      return roles.sort((a, b) => b.position - a.position).map(cleanRole);
    }
    case "create_role": {
      const guildId = requireAllowedGuild(args.guild_id);
      const body = { name: args.name, ...pick(args, [["color"], ["permissions"], ["hoist"], ["mentionable"]]) };
      return cleanRole(await discord(`/guilds/${guildId}/roles`, { method: "POST", body, reason: args.reason }));
    }
    case "edit_role": {
      const guildId = requireAllowedGuild(args.guild_id);
      const roleId = requireId(args.role_id, "role_id");
      const body = pick(args, [["name"], ["color"], ["permissions"], ["hoist"], ["mentionable"]]);
      if (!Object.keys(body).length) throw new Error("Supply at least one role field to edit.");
      return cleanRole(await discord(`/guilds/${guildId}/roles/${roleId}`, { method: "PATCH", body, reason: args.reason }));
    }
    case "delete_role": {
      const guildId = requireAllowedGuild(args.guild_id);
      const roleId = requireId(args.role_id, "role_id");
      const roles = await discord(`/guilds/${guildId}/roles`);
      const role = roles.find((item) => item.id === roleId);
      if (!role) throw new Error(`Role ${roleId} was not found in guild ${guildId}.`);
      const expected = `DELETE_ROLE:${guildId}:${roleId}`;
      if (args.confirm_token !== expected) {
        return { deleted: false, preview: cleanRole(role), confirmation_required: true, confirm_token: expected };
      }
      await discord(`/guilds/${guildId}/roles/${roleId}`, { method: "DELETE", reason: args.reason });
      return { deleted: true, role: cleanRole(role) };
    }
    case "add_member_role":
    case "remove_member_role": {
      const guildId = requireAllowedGuild(args.guild_id);
      const memberId = requireId(args.member_id, "member_id");
      const roleId = requireId(args.role_id, "role_id");
      const method = name === "add_member_role" ? "PUT" : "DELETE";
      await discord(`/guilds/${guildId}/members/${memberId}/roles/${roleId}`, { method, reason: args.reason });
      return { success: true, action: name === "add_member_role" ? "added" : "removed", guild_id: guildId, member_id: memberId, role_id: roleId };
    }
    case "discord_api_read": {
      const authorized = await authorizeApiPath(args.path, { readOnly: true });
      const requestPath = addQuery(authorized.path, args.query);
      const data = await discord(requestPath);
      return { method: "GET", path: authorized.path, guild_id: authorized.guild_id, resolved_via: authorized.resolved_via || "guild_path", data: redactSecrets(data) };
    }
    case "discord_api_write": {
      const method = String(args.method || "").toUpperCase();
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("method must be POST, PUT, PATCH, or DELETE.");
      rejectSecrets(args.body);
      const authorized = await authorizeApiPath(args.path);
      const expected = genericWriteToken(method, authorized.path, args.query, args.body, args.reason);
      const preview = {
        method,
        path: authorized.path,
        query: args.query || null,
        body: args.body ?? null,
        reason: args.reason || null,
        guild_id: authorized.guild_id,
        resolved_via: authorized.resolved_via || "guild_path",
      };
      if (args.confirm_token !== expected) {
        return { executed: false, confirmation_required: true, preview, confirm_token: expected };
      }
      const requestPath = addQuery(authorized.path, args.query);
      const data = await discord(requestPath, { method, body: args.body, reason: args.reason });
      return { executed: true, request: preview, data: redactSecrets(data) };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolResult(value, isError = false) {
  const structured = typeof value === "object" && value !== null ? value : { result: value };
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: structured,
    isError,
  };
}

async function handle(message) {
  if (message.id === undefined) return;
  try {
    let result;
    switch (message.method) {
      case "initialize":
        result = {
          protocolVersion: message.params?.protocolVersion || "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "discord-mcp", version: SERVER_VERSION },
          instructions: "Operate only on allowlisted Discord guilds. Prefer dedicated tools; use discord_api_read/write only for official guild-scoped REST endpoints not otherwise covered. Resolve names to IDs before writes. Messages are external communication. Generic writes and deletions require request-bound confirmation tokens returned by preview calls. Never expose or request credentials.",
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools };
        break;
      case "tools/call":
        try {
          result = toolResult(await callTool(message.params?.name, message.params?.arguments || {}));
        } catch (error) {
          result = toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
        }
        break;
      default:
        write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
        return;
    }
    write({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    write({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    void handle(JSON.parse(trimmed));
  } catch (error) {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse error: ${error.message}` } });
  }
});
