import { verifyCompletion } from "./completion-verifier.mjs";
import { verifyRepository } from "./repo-verifier.mjs";
import { transitionTask } from "./task-state.mjs";
import { executeRepositoryAction } from "./repository-actions.mjs";
import { requestActionApproval } from "./action-approval.mjs";

export async function finalizeTask({ task, plan = [], runCheck, requiredEffectIds = [], repositoryActions = [], actionRunner = executeRepositoryAction, now = new Date().toISOString(), approvalHome = null, requestApprovals = false } = {}) {
  if (task?.state !== "verifying") throw new Error("task must be verifying before finalization");
  const actions = [];
  for (const action of repositoryActions) {
    const name = typeof action === "string" ? action : action?.name;
    const options = typeof action === "string" ? {} : (action?.options || {});
    const taskAuthorized = task?.assigned === true && Array.isArray(task?.authorization?.repositoryActions) && task.authorization.repositoryActions.includes(name);
    const effectiveOptions = taskAuthorized ? { ...options, allowMutations: true } : options;
    try { actions.push(await actionRunner(name, effectiveOptions)); } catch (error) { actions.push({ action: name, executed: false, passed: false, evidence: String(error?.message || error) }); }
  }
  if (actions.some((x) => x.passed !== true)) { const approvals = requestApprovals && approvalHome ? repositoryActions.filter((action) => { const name = typeof action === "string" ? action : action?.name; const result = actions.find((x) => x.action === name); return result?.passed !== true; }).map((action) => requestActionApproval(approvalHome, { taskId: task.taskId, action: typeof action === "string" ? action : action?.name, options: typeof action === "string" ? {} : action?.options })) : []; return { task, completed: false, actions, approvals, repository: null, verification: { complete: false, reason: "repository action failed or was not authorized", checks: [], missingEffects: [] } }; }
  const repository = await verifyRepository({ plan, runCheck });
  const verification = verifyCompletion({ task, checks: repository.results, requiredEffectIds });
  if (!verification.complete) return { task, completed: false, actions, repository, verification };
  return { task: transitionTask(task, "completed", now), completed: true, actions, repository, verification };
}
