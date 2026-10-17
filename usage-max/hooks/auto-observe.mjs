#!/usr/bin/env node
import { autoObserve } from "../scripts/auto-observe.mjs";
import os from "node:os";
let input = {}; try { input = JSON.parse(process.env.USAGE_MAX_HOOK_INPUT || "{}"); } catch {}
await autoObserve({ home: process.env.USAGE_MAX_HOME || os.homedir(), input });
