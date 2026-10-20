/**
 * Per-route circuit breaker — fail-soft for free / NIM endpoints.
 */
const circuits = new Map();

const DEFAULT_FAILURES = 3;
const DEFAULT_OPEN_MS = 60_000;

function keyOf(provider, model) {
  return `${provider}::${model || "*"}`;
}

export function circuitAllow(provider, model) {
  const k = keyOf(provider, model);
  const c = circuits.get(k);
  if (!c) return true;
  if (c.state !== "open") return true;
  if (Date.now() >= c.openUntil) {
    c.state = "half";
    return true;
  }
  return false;
}

export function circuitSuccess(provider, model) {
  circuits.set(keyOf(provider, model), { state: "closed", failures: 0, openUntil: 0 });
}

export function circuitFailure(provider, model, { failures = DEFAULT_FAILURES, openMs = DEFAULT_OPEN_MS } = {}) {
  const k = keyOf(provider, model);
  const prev = circuits.get(k) || { state: "closed", failures: 0, openUntil: 0 };
  const nextFailures = prev.failures + 1;
  if (nextFailures >= failures) {
    circuits.set(k, { state: "open", failures: nextFailures, openUntil: Date.now() + openMs });
  } else {
    circuits.set(k, { state: "closed", failures: nextFailures, openUntil: 0 });
  }
}

export function circuitSnapshot() {
  const out = {};
  for (const [k, v] of circuits.entries()) {
    out[k] = { ...v, open: v.state === "open" && Date.now() < v.openUntil };
  }
  return out;
}

/** Test helper */
export function resetCircuits() {
  circuits.clear();
}
