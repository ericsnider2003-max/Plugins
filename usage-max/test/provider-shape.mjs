import assert from "node:assert/strict";
import { compareLimitShape, limitShape, shapeSignature } from "../scripts/provider-shape.mjs";

const oldCapture = { rate_limits: { primary: { label: "WEEKLY", window_minutes: 300, used_percentage: 12 } } };
const sameCapture = { rate_limits: { primary: { label: "WEEKLY", window_minutes: 300, used_percentage: 99 } } };
const changedCapture = { rate_limits: { primary: { label: "WEEKLY", window_minutes: 10080, used_percentage: 12 } } };
assert.deepEqual(limitShape(oldCapture), [{ key: "primary", label: "WEEKLY", windowMinutes: 300 }]);
assert.equal(shapeSignature(oldCapture), shapeSignature(sameCapture));
assert.equal(compareLimitShape(oldCapture, sameCapture).changed, false);
assert.equal(compareLimitShape(oldCapture, changedCapture).reason, "shape_changed");
assert.equal(compareLimitShape(null, changedCapture).changed, false);
console.log("provider shape quarantine tests passed");
