import { capabilities } from "./surface-adapters.mjs";
import { deliverOutbox } from "./notification-bridge.mjs";

export async function routeNotifications(file, { surface, attachment = null, approved = false } = {}) {
  const caps = capabilities(surface, { attachment, approved });
  if (caps.notification !== "supported") return { ...caps, state: "unavailable", delivered: 0 };
  const result = await deliverOutbox(file, { surface, deliver: attachment.notify });
  return { ...caps, ...result };
}
