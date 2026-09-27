import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;

// Restricted execution policy permits commands, but not .ps1 files. Invoke the
// bundled commands inline, without modifying any execution-policy setting.
export async function startupArgs(enabled, root) {
  const source = await fs.readFile(path.join(here, "startup.ps1"), "utf8");
  const command = `try { & {\n${source}\n} -Action ${quote(enabled ? "Install" : "Remove")} -NodePath ${quote(process.execPath)} -ListenerPath ${quote(path.join(here, "listener.mjs"))} -StatePath ${quote(root)} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")];
}

export async function reconcileStartup(enabled, root, { platform = process.platform, spawnProcess = spawn } = {}) {
  if (platform !== "win32") {
    if (enabled) throw new Error("Startup installation failed: automatic startup supports Windows only.");
    return { present: false, supported: false };
  }
  const action = enabled ? "installation" : "removal";
  try {
    const args = await startupArgs(enabled, root);
    return await new Promise((resolve, reject) => {
      const child = spawnProcess("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("Timed out; startup entry state is unknown. Retry to reconcile it.")); }, 15000);
      child.stdout.on("data", x => { stdout = (stdout + x).slice(-16000); });
      child.stderr.on("data", x => { stderr = (stderr + x).slice(-4000); });
      child.once("error", e => { clearTimeout(timer); reject(e); });
      child.once("close", code => {
        clearTimeout(timer);
        if (code !== 0) { reject(new Error(stderr.trim() || `PowerShell exited with code ${code}.`)); return; }
        try {
          const result = JSON.parse(stdout.trim());
          if (result.present !== enabled) throw new Error("Startup entry verification did not match the requested state.");
          resolve(result);
        } catch (e) { reject(new Error(`Could not verify startup entry: ${e.message}`)); }
      });
    });
  } catch (e) { throw new Error(`Startup ${action} failed: ${e.message}`); }
}
