import { readFile } from "node:fs/promises";
import { buildDemo, loadDemoConfig } from "./app.js";

const config = loadDemoConfig();

async function apiKey(): Promise<string> {
  if (config.apiKey) return config.apiKey;
  const file = process.env.KEYLINK_API_KEY_FILE;
  if (!file) return "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const text = (await readFile(file, "utf8")).trim();
      if (text) return text;
    } catch {
      /* key file is written on the Keylink server's first boot */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return "";
}

async function waitForKeylink(base: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(base.replace(/\/$/, "") + "/health");
      if (response.ok) return;
    } catch {
      /* server still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const key = await apiKey();
await waitForKeylink(config.keylinkUrl);
const app = await buildDemo({ ...config, apiKey: key });
await app.listen({ port: config.port, host: config.host });
app.log.info({ port: config.port, keylink: config.keylinkUrl }, "Fieldnote demo listening");
if (!key) app.log.warn("No KEYLINK_API_KEY. Create an application in the Keylink console and export the key.");
