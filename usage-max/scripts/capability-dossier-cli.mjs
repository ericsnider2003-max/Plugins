#!/usr/bin/env node
import os from "node:os";
import { capabilityDossier, formatCapabilityDossier } from "./capability-dossier.mjs";
const report = capabilityDossier(process.env.USAGE_MAX_HOME || os.homedir());
console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatCapabilityDossier(report));
