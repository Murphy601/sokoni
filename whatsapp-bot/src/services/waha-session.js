/**
 * Read-only WAHA session status for ops / linking checks.
 * Never exposes QR, pairing codes, or full phone numbers on public surfaces.
 */
import { config } from "../config.js";

function redactJid(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const phone = raw.replace(/@.*$/, "").replace(/\D/g, "");
  if (phone.length < 6) return "linked";
  return `${phone.slice(0, 3)}…${phone.slice(-2)}`;
}

async function wahaFetch(pathname, { timeoutMs = 4000 } = {}) {
  const base = config.waha.apiUrl;
  if (!base) {
    return { ok: false, error: "not_configured" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (config.waha.apiKey) headers["X-Api-Key"] = config.waha.apiKey;
    const res = await fetch(`${base}${pathname}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: "waha_http_error",
        statusCode: res.status,
        body,
      };
    }
    return { ok: true, body };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "timeout" : "unreachable",
      message: err?.message || String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full status for token-protected admin ops.
 */
export async function getWahaSessionStatus() {
  const session = config.waha.session || "default";
  const configured = Boolean(config.waha.apiUrl);

  if (!configured) {
    return {
      configured: false,
      linked: false,
      session,
      status: null,
      engine: null,
      nowebStoreEnabled: null,
      webhookUrl: null,
      me: null,
      reachable: false,
      hint: "Set WAHA_API_URL (and WAHA_API_KEY) on the bot, then bash scripts/deploy-waha.sh",
    };
  }

  const result = await wahaFetch(`/api/sessions/${encodeURIComponent(session)}`);
  if (!result.ok) {
    return {
      configured: true,
      linked: false,
      session,
      status: null,
      engine: null,
      nowebStoreEnabled: null,
      webhookUrl: null,
      me: null,
      reachable: false,
      error: result.error,
      statusCode: result.statusCode || null,
      hint:
        result.error === "unreachable" || result.error === "timeout"
          ? "WAHA not reachable — run bash scripts/deploy-waha.sh on the VM"
          : "Cannot read session — run bash scripts/configure-waha-session.sh",
    };
  }

  const data = result.body || {};
  const cfg = data.config || {};
  const store = cfg.noweb?.store || {};
  const hooks = Array.isArray(cfg.webhooks) ? cfg.webhooks : [];
  const status = data.status || null;
  const engine =
    (typeof data.engine === "string" ? data.engine : data.engine?.engine) || null;
  const meId = data.me?.id || data.me?.user || null;

  let hint = null;
  if (status === "WORKING") {
    hint = "WhatsApp linked — send/receive ready.";
  } else if (status === "SCAN_QR_CODE") {
    hint = "Needs pairing — on the VM run: bash scripts/waha-link-whatsapp.sh";
  } else if (status === "FAILED" || status === "STOPPED") {
    hint = "Session not live — bash scripts/configure-waha-session.sh (or RESET_WAHA_SESSION=1)";
  } else if (status) {
    hint = `Session status is ${status}. Prefer WORKING.`;
  }

  return {
    configured: true,
    linked: status === "WORKING",
    session,
    status,
    engine,
    nowebStoreEnabled: store.enabled === true,
    webhookUrl: hooks[0]?.url || null,
    me: redactJid(meId),
    reachable: true,
    hint,
  };
}

/**
 * Compact boolean for public /health (no phone / webhook details).
 */
export async function getWahaHealthSummary() {
  const full = await getWahaSessionStatus();
  return {
    wahaConfigured: full.configured,
    wahaReachable: Boolean(full.reachable),
    wahaLinked: Boolean(full.linked),
    wahaSessionStatus: full.status || null,
  };
}
