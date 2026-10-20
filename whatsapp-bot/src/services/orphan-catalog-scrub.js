/**
 * One-shot / cron: hide DB products whose peer shop no longer exists in suppliers store.
 * Run after DELETE SELLER when orphans may still be in_stock under sokoni-store remap.
 */
import { isDbEnabled, query } from "../db/pool.js";
import { listSuppliers } from "./suppliers.js";
import { invalidateProductCache } from "./catalog.js";

function normalizeHandle(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

/**
 * @returns {{ ok: boolean, hidden: number, checked: number, error?: string }}
 */
export async function scrubOrphanPeerProducts({ dryRun = false } = {}) {
  if (!isDbEnabled()) {
    return { ok: false, hidden: 0, checked: 0, error: "database_not_configured" };
  }

  const liveHandles = new Set();
  const liveIds = new Set();
  for (const s of listSuppliers() || []) {
    if (s?.id) liveIds.add(String(s.id));
    for (const raw of [s.shopHandle, s.businessName, s.shopName]) {
      const h = normalizeHandle(raw);
      if (h) liveHandles.add(h);
    }
  }

  const { rows } = await query(
    `SELECT id,
            legacy_json->>'supplierId' AS supplier_id,
            legacy_json->>'shopHandle' AS shop_handle,
            legacy_json->>'sellerHandle' AS seller_handle,
            legacy_json->>'sellerPhone' AS seller_phone,
            in_stock, is_sold
       FROM products
      WHERE in_stock = TRUE
        AND is_sold = FALSE
        AND (
          COALESCE(legacy_json->>'shopHandle','') <> ''
          OR COALESCE(legacy_json->>'sellerHandle','') <> ''
          OR COALESCE(legacy_json->>'supplierId','') <> ''
          OR COALESCE(legacy_json->>'sellerPhone','') <> ''
        )`
  );

  const orphanIds = [];
  for (const row of rows) {
    const handle = normalizeHandle(row.shop_handle || row.seller_handle);
    const sid = String(row.supplier_id || "").trim();
    const isPeer =
      (handle && handle !== "sokoni-store") ||
      /^(sup[_-]|seller[_-])/i.test(sid);
    if (!isPeer) continue;
    if (sid && liveIds.has(sid)) continue;
    if (handle && liveHandles.has(handle)) continue;
    orphanIds.push(row.id);
  }

  if (!orphanIds.length) {
    return { ok: true, hidden: 0, checked: rows.length };
  }
  if (dryRun) {
    return { ok: true, hidden: orphanIds.length, checked: rows.length, dryRun: true, ids: orphanIds };
  }

  const { rows: updated } = await query(
    `UPDATE products SET
       in_stock = FALSE,
       updated_at = NOW(),
       legacy_json = COALESCE(legacy_json, '{}'::jsonb) || jsonb_build_object(
         'inStock', false,
         'moderation', jsonb_build_object(
           'status', 'hidden',
           'reason', 'orphan_peer_scrub',
           'hiddenAt', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
         )
       )
     WHERE id = ANY($1::text[])
     RETURNING id`,
    [orphanIds]
  );

  try {
    invalidateProductCache();
  } catch {
    /* ignore */
  }

  return { ok: true, hidden: updated.length, checked: rows.length };
}
