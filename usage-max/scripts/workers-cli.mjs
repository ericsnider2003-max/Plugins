#!/usr/bin/env node
import { workerAdapterDefinitions } from "./worker-adapters.mjs";
console.log(JSON.stringify(workerAdapterDefinitions(), null, 2));
