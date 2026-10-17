// Repository verification is deliberately allowlisted and injected. The core
// does not shell out to arbitrary commands or commit on a user's behalf.
const checks = new Set(["tests", "lint", "git-clean", "commit-present", "install", "subagents-closed"]);
export async function verifyRepository({ plan = [], runCheck }) {
  if (typeof runCheck !== "function") throw new Error("runCheck is required");
  const results = [];
  for (const item of plan) {
    const name = typeof item === "string" ? item : item.name;
    if (!checks.has(name)) results.push({ name, passed: false, evidence: "check is not allowlisted" });
    else {
      try { const result = await runCheck(name, typeof item === "string" ? {} : item); results.push({ name, passed: result?.passed === true, evidence: result?.evidence || null }); }
      catch (error) { results.push({ name, passed: false, evidence: String(error?.message || error) }); }
    }
  }
  return { results, passed: results.length > 0 && results.every((x) => x.passed) };
}
