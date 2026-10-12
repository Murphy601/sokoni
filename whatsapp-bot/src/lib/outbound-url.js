/**
 * Allowlisted outbound fetches (seller media, catalog cache, ops voicenotes).
 * Hostname allowlist + private/loopback/metadata rejection — no user-supplied
 * URL may reach the VM loopback, RFC1918, or cloud metadata.
 */

import { config } from "../config.js";

const CLOUD_METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "metadata.goog",
  "169.254.169.254",
]);

function isProduction() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
}

function configuredMediaHosts() {
  const hosts = new Set(["res.cloudinary.com", "sokonimall.com", "www.sokonimall.com", "bot.sokonimall.com"]);
  for (const raw of [config.waha?.apiUrl, config.publicSiteUrl, config.botPublicUrl]) {
    try {
      if (raw) hosts.add(new URL(String(raw)).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  return hosts;
}

function ipv4FromHost(host) {
  const h = String(host || "");
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffffffff) {
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    }
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts;
}

function ipv4IsLoopback(parts) {
  return parts[0] === 127;
}

function ipv4IsPrivateOrLinkLocal(parts) {
  if (parts[0] === 10) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

export function hostnameIsLoopback(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0" || h === "::") return true;
  if (h === "localhost.localdomain" || h.endsWith(".localhost")) return true;
  const parts = ipv4FromHost(h);
  if (parts && ipv4IsLoopback(parts)) return true;
  return false;
}

export function hostnameIsPrivateOrMetadata(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (CLOUD_METADATA_HOSTS.has(h)) return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const parts = ipv4FromHost(h);
  if (parts && (ipv4IsLoopback(parts) || ipv4IsPrivateOrLinkLocal(parts))) return true;
  return hostnameIsLoopback(h);
}

function isPublicAllowlistedHost(host) {
  const h = String(host || "").toLowerCase();
  if (h === "res.cloudinary.com" || h.endsWith(".cloudinary.com")) return true;
  if (h === "sokonimall.com" || h.endsWith(".sokonimall.com")) return true;
  return false;
}

/**
 * @param {string} url
 * @param {{ allowDevLoopback?: boolean, allowPrivateConfigured?: boolean }} [opts]
 */
export function isAllowlistedOutboundUrl(url, opts = {}) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (!host) return false;

    if (hostnameIsPrivateOrMetadata(host)) {
      if (hostnameIsLoopback(host) && opts.allowDevLoopback && !isProduction()) return true;
      if (opts.allowPrivateConfigured && configuredMediaHosts().has(host)) return true;
      return false;
    }

    if (isPublicAllowlistedHost(host)) return true;
    if (opts.allowPrivateConfigured && configuredMediaHosts().has(host)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Seller-supplied photo/video URLs — never loopback/private in production. */
export function isSellerMediaUrl(url) {
  return isAllowlistedOutboundUrl(url, { allowDevLoopback: !isProduction() });
}

/** Ops / daily-drop / WAHA media — configured hosts only (may be localhost WAHA). */
export function isOpsMediaUrl(url) {
  return isAllowlistedOutboundUrl(url, { allowPrivateConfigured: true });
}

/**
 * Fetch an allowlisted URL without following redirects off the allowlist.
 * @param {string} url
 * @param {{ timeoutMs?: number, maxRedirects?: number, allowPrivateConfigured?: boolean, allowDevLoopback?: boolean }} [opts]
 */
export async function fetchAllowlistedUrl(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 90_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = String(url || "").trim();
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isAllowlistedOutboundUrl(current, opts)) {
      const err = new Error("url_not_allowed");
      err.code = "url_not_allowed";
      throw err;
    }
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "image/*,video/*,audio/*,*/*" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).href;
      continue;
    }
    return res;
  }
  const err = new Error("url_redirect_denied");
  err.code = "url_redirect_denied";
  throw err;
}
