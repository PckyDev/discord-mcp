import { spawn } from "node:child_process";
import { stateDir } from "./config.mjs";
import { prepareAgentHome, agentEnvironment, executable } from "./codex.mjs";
await prepareAgentHome(stateDir());
const child = spawn(executable(), ["login", "--device-auth"], { env: agentEnvironment(stateDir()), stdio: "inherit", windowsHide: true });
child.on("error", () => { console.error("Cannot launch Codex. Install Codex CLI or set DISCORD_CHAT_CODEX_EXECUTABLE to its executable."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code || 0; });
