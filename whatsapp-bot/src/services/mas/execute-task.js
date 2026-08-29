/**
 * MAS executeTask — capability gateway with timeouts, circuit breakers, fallbacks.
 * Never overrides Cloudinary → HeyGen → Remotion or primary chat/vision chains.
 */
import { routesForTask } from "./routes.js";
import { callProviderRoute } from "./providers.js";
import { circuitAllow, circuitFailure, circuitSuccess } from "./circuit-breaker.js";
import { masFlags, isTaskLive, canShadow } from "./flags.js";
import { agentsForTask } from "./agent-catalog.js";

/**
 * @param {string} task
 * @param {object} payload
 * @param {{ mode?: 'shadow'|'assist'|'live'|'auto', timeoutMs?: number }} [opts]
 */
export async function executeTask(task, payload = {}, opts = {}) {
  const flags = masFlags();
  const mode = opts.mode || "auto";

  if (!flags.enabled) {
    return {
      ok: false,
      skipped: true,
      reason: "mas_disabled",
      task,
      primaryUnchanged: true,
    };
  }

  const live = mode === "live" || mode === "assist" || (mode === "auto" && isTaskLive(task));
  const shadow = mode === "shadow" || (mode === "auto" && !live && canShadow(task));

  if (!live && !shadow && mode !== "force") {
    return {
      ok: false,
      skipped: true,
      reason: "task_not_enabled",
      task,
      agents: agentsForTask(task).map((a) => a.id),
      primaryUnchanged: true,
    };
  }

  const timeoutMs = Number(opts.timeoutMs) || flags.timeoutMs || 2000;
  const routes = routesForTask(task);
  const attempts = [];

  for (const route of routes) {
    if (!circuitAllow(route.provider, route.model)) {
      attempts.push({ provider: route.provider, model: route.model, skipped: "circuit_open" });
      continue;
    }
    try {
      const result = await callProviderRoute(route, task, payload, { timeoutMs });
      if (result.stub) {
        attempts.push({ ...result, skipped: "stub" });
        continue;
      }
      if (result.ok || result.provider === "heuristic") {
        circuitSuccess(route.provider, route.model);
        return {
          ...result,
          ok: result.ok !== false,
          task,
          mode: live ? "live" : "shadow",
          attempts,
          primaryUnchanged: !live,
          agents: agentsForTask(task).map((a) => a.id),
        };
      }
      attempts.push(result);
      circuitFailure(route.provider, route.model);
    } catch (err) {
      circuitFailure(route.provider, route.model);
      attempts.push({
        provider: route.provider,
        model: route.model,
        error: err.message || String(err),
      });
    }
  }

  return {
    ok: false,
    degraded: true,
    task,
    mode: live ? "live" : "shadow",
    attempts,
    message: `All MAS routes failed for ${task}`,
    primaryUnchanged: true,
    agents: agentsForTask(task).map((a) => a.id),
  };
}
