/**
 * Shared admin REST auth — token lives only in bot env.
 * Accepts MASTER_ADMIN_SECRET (Boss), ADMIN_SETUP_TOKEN, SUPPLIER_ADMIN_TOKEN,
 * or TIKTOK_SETUP_TOKEN via header only.
 * Query-string tokens are ignored so they cannot land in access logs or Referer.
 */

import crypto from "node:crypto";

export function adminTokenFromReq(req) {
  return String(
    req.headers["x-master-admin-secret"] ||
      req.headers["x-admin-token"] ||
      req.headers["x-sokoni-token"] ||
      req.body?.token ||
      req.body?.masterAdminSecret ||
      ""
  ).trim();
}

function adminTokenCandidates() {
  return [
    process.env.MASTER_ADMIN_SECRET,
    process.env.ADMIN_SETUP_TOKEN,
    process.env.SUPPLIER_ADMIN_TOKEN,
    process.env.TIKTOK_SETUP_TOKEN,
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
}

/** Primary token for docs / legacy callers (prefer MASTER, then setup). */
export function expectedAdminToken() {
  return adminTokenCandidates()[0] || "";
}

/** True when the request presents the dedicated MASTER_ADMIN_SECRET. */
function tokenEquals(presented, expected) {
  const a = crypto.createHash("sha256").update(String(presented)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

export function isMasterAdminToken(token) {
  const master = String(process.env.MASTER_ADMIN_SECRET || "").trim();
  if (!master || !token) return false;
  return tokenEquals(token, master);
}

export function isAdminTokenValid(token) {
  if (!token) return false;
  return adminTokenCandidates().some((candidate) => tokenEquals(token, candidate));
}

export function requireAdminToken(req, res, next) {
  if (!isAdminTokenValid(adminTokenFromReq(req))) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}
