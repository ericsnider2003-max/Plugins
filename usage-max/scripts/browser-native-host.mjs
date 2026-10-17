#!/usr/bin/env node
// Dry-run-first installer for the browser native-messaging bridge.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = process.env.USAGE_MAX_HOME || os.homedir();
const args = process.argv.slice(2); const idIndex = args.indexOf("--extension-id"); const extensionId = idIndex >= 0 ? args[idIndex + 1] : "";
const apply = args.includes("--apply"); const browser = args.includes("--edge") ? "edge" : "chrome";
const hostName = "com.usage_max.adapter";
const manifestDir = path.join(home, ".usage-max", "browser-native-host");
const manifestFile = path.join(manifestDir, `${hostName}.json`);
const extensionIdFile = path.join(home, ".usage-max", "browser-extension-id");
const hostScript = path.join(root, "browser-adapter", "native-host.mjs");
const manifest = { name: hostName, description: "Usage-max local attachment bootstrap", path: process.execPath, type: "stdio", args: [hostScript], allowed_origins: extensionId ? [`chrome-extension://${extensionId}/`] : [] };
if (!extensionId) { console.error("browser-native-host: --extension-id is required (copy it from the installed extension details)"); process.exit(2); }
if (process.platform !== "win32") { console.error("browser-native-host: automatic registry installation is currently Windows-only"); process.exit(2); }
const key = browser === "edge" ? "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.usage_max.adapter" : "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.usage_max.adapter";
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", browser, manifestFile, registryKey: key, manifest }, null, 2));
if (!apply) process.exit(0);
fs.mkdirSync(manifestDir, { recursive: true }); fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
const result = spawnSync("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", manifestFile, "/f"], { encoding: "utf8", windowsHide: true });
if (result.status !== 0) { console.error(result.stderr || result.stdout || "registry installation failed"); process.exit(result.status || 1); }
fs.writeFileSync(extensionIdFile, `${extensionId.toLowerCase()}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`installed ${hostName}; restart the browser extension to bootstrap the loopback receiver automatically`);
