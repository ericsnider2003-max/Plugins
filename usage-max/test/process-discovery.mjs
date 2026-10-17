import assert from "node:assert/strict";
import { discoverProviderProcesses, runtimeCapabilities } from "../scripts/process-discovery.mjs";

const report = discoverProviderProcesses({ platform: "win32", now: Date.parse("2026-10-15T08:00:00Z"), run: () => '"codex.exe","1","Console","1","1 K"\r\n"cowork-svc.exe","2","Console","1","1 K"\r\n"chrome.exe","3","Console","1","1 K"\r\n' });
assert.equal(report.available, true); assert.equal(report.providers["codex-cli"].running, true); assert.equal(report.providers.cowork.running, true); assert.equal(report.providers["claude-code"].running, false); assert.equal(report.webSurfaces.chatgpt, "not-detectable-from-generic-browser-process");
const ambiguous = discoverProviderProcesses({ platform: "win32", run: () => '"codex.exe","1"\r\n"chatgpt.exe","2"\r\n' }); assert.equal(ambiguous.ambiguity.openaiHost, "chatgpt-and-codex-processes-coexist");
const failed = discoverProviderProcesses({ platform: "win32", run: () => { throw new Error("denied"); } }); assert.equal(failed.available, false); assert.equal(failed.providers["codex-cli"].running, false);
assert.deepEqual(runtimeCapabilities([{ name: "chatgpt.exe", commandLine: "ChatGPT.exe --enable-features=WebMCPSupport --enable-blink-features=WebMCP" }]), { chatgptWebMcp: "enabled", commandLineObserved: true });
const capable = discoverProviderProcesses({ platform: "win32", includeCommandLines: true, run: () => '"chatgpt.exe","1"\r\n', runDetails: () => JSON.stringify([{ Name: "ChatGPT.exe", CommandLine: "ChatGPT.exe --enable-features=WebMCPSupport --enable-blink-features=WebMCP" }]) }); assert.equal(capable.runtimeCapabilities.chatgptWebMcp, "enabled"); assert.equal(capable.runtimeCapabilities.available, true);
console.log("process discovery tests passed");
