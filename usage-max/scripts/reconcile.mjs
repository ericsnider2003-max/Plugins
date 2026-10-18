// Keep provider allowance and local activity separate; compare only when both expose comparable values.
export function reconcileObservations(observations, { now = Date.now(), staleMs = EVIDENCE_FRESHNESS_MS, conflictPct = 20 } = {}) {
  const providers = (observations || []).filter((x) => x.authority === "provider" && x.state !== "quarantined");
  return providers.map((provider) => {
    const age = now - Date.parse(provider.capturedAt || 0);
    const series = providers.filter((x) => x.provider === provider.provider && x.account?.slot === provider.account?.slot && x.window?.id === provider.window?.id).sort((a, b) => Date.parse(a.capturedAt || 0) - Date.parse(b.capturedAt || 0));
    const index = series.findIndex((x) => x === provider); const previous = index > 0 ? series[index - 1] : null;
    const previousPct = Number(previous?.window?.usedPercentage); const providerPct = Number(provider.window?.usedPercentage);
    const providerMovementPct = Number.isFinite(previousPct) && Number.isFinite(providerPct) ? providerPct - previousPct : null;
    const previousAt = Date.parse(previous?.capturedAt || 0); const currentAt = Date.parse(provider.capturedAt || 0);
    const locals = (observations || []).filter((x) => x.authority === "local-activity" && x.provider === provider.provider && x.account?.slot === provider.account?.slot && x.state !== "quarantined" && (!previous || (Date.parse(x.capturedAt || 0) >= previousAt && Date.parse(x.capturedAt || 0) <= currentAt)));
    const local = locals.sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0))[0];
    const localPct = Number(local?.data?.usedPercentage);
    let status = "unattributed"; let reason = "local activity is not comparable to provider allowance"; let anomaly = null;
    if (!Number.isFinite(providerPct) || providerPct < 0 || providerPct > 100) { status = "invalid"; reason = "provider quota percentage is invalid"; }
    else if (!Number.isFinite(age) || age > staleMs) { status = "stale"; reason = "provider observation is stale"; }
    else if (Number.isFinite(providerPct) && Number.isFinite(localPct)) { status = Math.abs(providerPct - localPct) > conflictPct ? "conflict" : "consistent"; reason = status === "conflict" ? "provider and local percentages disagree; provider remains authoritative" : "comparable values are within tolerance"; }
    else if (previous && Number.isFinite(providerMovementPct) && providerMovementPct !== 0 && locals.length === 0) { anomaly = "provider-movement-without-local"; reason = "provider allowance moved without matching local activity; invisible-surface usage may explain the delta"; }
    return { provider: provider.provider, account: provider.account?.slot || null, window: provider.window?.id || null, providerCapturedAt: provider.capturedAt, providerPercentage: Number.isFinite(providerPct) ? providerPct : null, providerMovementPct, localPercentage: Number.isFinite(localPct) ? localPct : null, localObservationCount: locals.length, status, anomaly, providerAuthoritative: true, reason };
  });
}
import { EVIDENCE_FRESHNESS_MS } from "./timing.mjs";
