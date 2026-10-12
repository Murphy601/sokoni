/**
 * Express `trust proxy` for rate-limit IP (STK / OTP / API).
 *
 * nginx on this VM talks to Node on loopback, so only that hop is trusted.
 * A hop count (`1`) or `true` lets a client-supplied X-Forwarded-For look
 * like a proxy (CVE-2026-90711 / proxy-addr IPv4-mapped IPv6 spoofing).
 */

const NAMED = new Set(["loopback", "linklocal", "uniquelocal"]);
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/(?:3[0-2]|[12]?\d))?$/;

export const DEFAULT_TRUST_PROXY = "loopback";

function isSafeProxyEntry(raw) {
  const entry = String(raw || "").trim().toLowerCase();
  if (!entry) return false;
  if (NAMED.has(entry)) return true;
  if (entry === "0.0.0.0" || entry.startsWith("0.0.0.0/") || entry === "::/0") return false;
  if (IPV4.test(entry)) {
    const ip = entry.split("/")[0].split(".").map(Number);
    return ip.length === 4 && ip.every((n) => n >= 0 && n <= 255);
  }
  return false;
}

/**
 * Value for `app.set("trust proxy", …)`.
 * Hop counts and `true` are replaced with loopback.
 */
export function trustedProxySetting(env = process.env) {
  const raw = String(env.TRUST_PROXY ?? "").trim();
  if (!raw) return DEFAULT_TRUST_PROXY;
  if (/^(true|yes|on|\d+)$/i.test(raw)) return DEFAULT_TRUST_PROXY;
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter(isSafeProxyEntry);
  if (!parts.length) return DEFAULT_TRUST_PROXY;
  return parts.length === 1 ? parts[0] : parts;
}
