#!/usr/bin/env node
import assert from "node:assert/strict";
import { fixedDecimal, roundDecimal } from "../scripts/lib.mjs";
assert.equal(roundDecimal(1.005, 2), 1.01);
assert.equal(roundDecimal(2.675, 2), 2.68);
assert.equal(roundDecimal(-1.005, 2), -1.01);
assert.equal(fixedDecimal(0.005, 2), "0.01");
assert.equal(fixedDecimal(Number.NaN, 2), "?");
console.log("deterministic rounding tests passed");
