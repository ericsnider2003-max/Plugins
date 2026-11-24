// Ported from Umbrella Project skills/usage-max/identifiers.mjs (Umbrella commit 0e94f22 tree) on 2026-11-24;
// keep behaviour identical; Umbrella callers depend on this API.
// Plugin copy lives in usage-max/scripts/governance/.
function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function assertSafeIdentifier(value, name = 'identifier') {
  assert(typeof value === 'string' && value.length > 0 && value.length <= 128, `${name} must be 1-128 characters`);
  assert(value !== '.' && value !== '..' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value), `${name} contains unsafe path characters`);
  return value;
}

