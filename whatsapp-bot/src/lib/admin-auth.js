/**
 * Shared admin REST auth — token lives only in bot env
 * (ADMIN_SETUP_TOKEN / SUPPLIER_ADMIN_TOKEN / TIKTOK_SETUP_TOKEN).
 * Prefer X-Admin-Token header so tokens stay out of URLs/logs.
 */

export function adminTokenFromReq(req) {
  return String(
    req.headers["x-admin-token"] ||
      req.headers["x-sokoni-token"] ||
      req.query?.token ||
      req.body?.token ||
      ""
  ).trim();
}

export function expectedAdminToken() {
  return (
    process.env.ADMIN_SETUP_TOKEN ||
    process.env.SUPPLIER_ADMIN_TOKEN ||
    process.env.TIKTOK_SETUP_TOKEN ||
    ""
  );
}

export function isAdminTokenValid(token) {
  const expected = expectedAdminToken();
  return Boolean(expected && token && token === expected);
}

export function requireAdminToken(req, res, next) {
  if (!isAdminTokenValid(adminTokenFromReq(req))) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}
