export async function worker({ stageId }) { return { outcome: stageId === "direct" ? "completed" : "continue", checkpoint: { version: 1, path: `cp-${stageId}`, digest: `digest-${stageId}` }, effects: [{ effectId: `effect-${stageId}`, kind: "stage", state: "committed" }] }; }
export async function verify() { return { checks: [{ name: "worker", passed: true }] }; }
