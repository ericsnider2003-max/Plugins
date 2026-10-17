// Durable local approval request for an allowlisted repository mutation.
// Requesting approval never executes the action.
import path from "node:path";
import { writeNotice } from "./notifications.mjs";

export function requestActionApproval(home, { taskId, action, options = {} } = {}) {
  if (!home || !taskId || !action) throw new Error("home, taskId, and action are required");
  const files = Array.isArray(options.files) ? options.files.map((x) => String(x)).slice(0, 50) : [];
  const scope = files.length ? ` files=${files.join(",")}` : "";
  const notice = writeNotice(path.join(home, ".usage-max", "notifications.jsonl"), { noticeId: `action-approval-${taskId}-${action}`, kind: "repository-action-approval", message: `Task ${taskId} requests approved repository action ${action}.${scope} Review and explicitly authorize the task-scoped mutation before execution.` });
  return { taskId, action, requested: true, duplicate: notice.duplicate, noticeId: notice.notice.noticeId };
}
