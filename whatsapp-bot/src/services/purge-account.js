/**
 * Hard purge — permanently remove seller or rider identity from Sokoni.
 * Historical orders/dispatches keep money rails but lose personal links (SET NULL).
 * Re-join later = fresh registration (phone / handle / plate freed).
 */
import {
  getSupplier,
  getSupplierByHandle,
  findSupplierByPhone,
  removeSupplierFromStore,
  removeApplicationsForPhone,
} from "./suppliers.js";
import { isDbEnabled, query } from "../db/pool.js";

function digitsOnly(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  return d;
}

function nationalTail(raw) {
  const d = digitsOnly(raw);
  return d.length >= 9 ? d.slice(-9) : d;
}

function normalizeHandle(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

async function notifyWhatsApp(phone, text) {
  const digits = digitsOnly(phone);
  if (!digits || digits.length < 9) return { ok: false };
  try {
    const { sendTextReliable } = await import("./whatsapp.js");
    await sendTextReliable(`${digits}@c.us`, text, { label: "purge-account" });
    return { ok: true };
  } catch {
    try {
      const { sendText } = await import("./whatsapp.js");
      await sendText(`${digits}@c.us`, text);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
}

/**
 * @param {string} handleOrIdOrPhone
 * @param {{ adminLabel?: string, confirm?: boolean, notify?: boolean }} [opts]
 */
export async function purgeSellerAccount(
  handleOrIdOrPhone,
  { adminLabel = "Boss", confirm = false, notify = true } = {}
) {
  if (!confirm) {
    return {
      ok: false,
      error: "confirm_required",
      message:
        "Permanent delete. Reply *DELETE SELLER @handle CONFIRM* (or panel confirm) to wipe this seller completely.",
    };
  }

  const shop =
    getSupplierByHandle(handleOrIdOrPhone) ||
    getSupplier(handleOrIdOrPhone) ||
    findSupplierByPhone(handleOrIdOrPhone);

  if (!shop?.id) {
    return { ok: false, error: "not_found", message: `Seller *${handleOrIdOrPhone}* not found.` };
  }

  const handle = normalizeHandle(shop.shopHandle || shop.businessName || shop.id);
  const phone = digitsOnly(shop.phone || shop.mpesaNumber || "");
  const stats = {
    productsDeleted: 0,
    jsonListingsRemoved: 0,
    supplierRemoved: false,
    usersCleared: 0,
    sellersDeleted: 0,
    sessionsCleared: false,
    applicationsRemoved: 0,
  };

  try {
    const { hideListingsForSupplier } = await import("./listing-moderation.js");
    await hideListingsForSupplier(shop.id, {
      reason: "Seller permanently deleted",
      phone,
      handle,
    });
  } catch (err) {
    console.warn("[purge-account] hide before delete:", err.message);
  }

  stats.jsonListingsRemoved = await removeJsonListingsForSeller({
    supplierId: shop.id,
    phone,
    handle,
  });

  if (isDbEnabled()) {
    try {
      const userIds = await resolveUserIds({ phone, handle });
      const sellerIds = await resolveSellerIds(userIds);

      const prodClauses = [];
      const prodParams = [];
      if (shop.id) {
        prodParams.push(String(shop.id));
        prodClauses.push(`(legacy_json->>'supplierId') = $${prodParams.length}`);
      }
      if (handle) {
        prodParams.push(handle);
        const hi = prodParams.length;
        prodClauses.push(`(
          LOWER(REPLACE(COALESCE(legacy_json->>'shopHandle',''), '@', '')) = $${hi}
          OR LOWER(REPLACE(COALESCE(legacy_json->>'sellerHandle',''), '@', '')) = $${hi}
        )`);
      }
      if (userIds.length) {
        prodParams.push(userIds);
        prodClauses.push(`seller_user_id = ANY($${prodParams.length}::int[])`);
      }
      if (sellerIds.length) {
        prodParams.push(sellerIds);
        prodClauses.push(`seller_id = ANY($${prodParams.length}::int[])`);
      }
      if (prodClauses.length) {
        const { rows: delProducts } = await query(
          `DELETE FROM products
            WHERE ${prodClauses.join(" OR ")}
            RETURNING id`,
          prodParams
        );
        stats.productsDeleted = delProducts.length;
        if (delProducts.length) {
          try {
            await query(`DELETE FROM product_search_embeddings WHERE product_ref = ANY($1::text[])`, [
              delProducts.map((r) => r.id),
            ]);
          } catch {
            /* optional table */
          }
        }
      }

      if (sellerIds.length) {
        const { rows: delSellers } = await query(
          `DELETE FROM sellers WHERE id = ANY($1::int[]) RETURNING id`,
          [sellerIds]
        );
        stats.sellersDeleted = delSellers.length;
      } else if (userIds.length) {
        const { rows: delSellers } = await query(
          `DELETE FROM sellers WHERE user_id = ANY($1::int[]) RETURNING id`,
          [userIds]
        );
        stats.sellersDeleted = delSellers.length;
      }

      if (userIds.length) {
        await query(
          `UPDATE users SET
             phone = NULL,
             email = NULL,
             handle = NULL,
             shop_name = NULL,
             bio = NULL,
             avatar_url = NULL,
             location = NULL,
             mpesa_number = NULL,
             national_id = NULL,
             display_name = 'Deleted account',
             is_seller_verified = FALSE,
             available_balance = 0,
             pending_escrow = 0,
             updated_at = NOW()
           WHERE id = ANY($1::int[])`,
          [userIds]
        );
        try {
          await query(
            `DELETE FROM rating_events WHERE subject_type = 'seller' AND subject_id = ANY($1::int[])`,
            [userIds]
          );
        } catch {
          /* ignore */
        }
        const { rows: delUsers } = await query(
          `DELETE FROM users WHERE id = ANY($1::int[]) RETURNING id`,
          [userIds]
        );
        stats.usersCleared = delUsers.length;
      }

      try {
        if (handle) {
          await query(
            `DELETE FROM vendor_shipping_profiles
              WHERE LOWER(REPLACE(vendor_key, '@', '')) = $1`,
            [handle]
          );
        }
      } catch {
        /* schema variance */
      }
    } catch (err) {
      console.warn("[purge-account] db seller purge:", err.message);
    }
  }

  try {
    const rem = removeSupplierFromStore(shop.id);
    stats.supplierRemoved = Boolean(rem?.ok);
    if (phone) {
      stats.applicationsRemoved = removeApplicationsForPhone(phone)?.removed || 0;
    }
  } catch (err) {
    console.warn("[purge-account] supplier store:", err.message);
  }

  try {
    const { revokeSellerSession } = await import("./seller-verification.js");
    await revokeSellerSession(phone);
    stats.sessionsCleared = true;
  } catch {
    /* ignore */
  }
  try {
    const { clearSellerChatIdsForPhone } = await import("./seller-chat-ids.js");
    clearSellerChatIdsForPhone(phone);
  } catch {
    /* ignore */
  }

  try {
    const { invalidateProductCache } = await import("./catalog.js");
    invalidateProductCache();
  } catch {
    /* ignore */
  }

  if (notify && phone) {
    await notifyWhatsApp(
      phone,
      `🗑️ *Account deleted*\n\n` +
        `Your Sokoni seller account *@${handle || "shop"}* has been *permanently deleted*.\n` +
        `All shop and listing data was removed. You may register again later as a new seller or rider.\n\n` +
        `support@sokonimall.com`
    );
  }

  return {
    ok: true,
    action: "DELETE_SELLER",
    handle: handle ? `@${handle}` : shop.id,
    phone: phone || null,
    stats,
    message:
      `Seller *${handle ? `@${handle}` : shop.id}* *PERMANENTLY DELETED*. ` +
      `Products removed: ${stats.productsDeleted}. Supplier record wiped. ` +
      `They can re-register from scratch.` +
      ` _By ${adminLabel}_`,
  };
}

async function removeJsonListingsForSeller({ supplierId, phone, handle }) {
  try {
    const { readFile, writeFile } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const MASTER = path.join(__dirname, "..", "data", "products.json");
    if (!existsSync(MASTER)) return 0;
    const raw = JSON.parse(await readFile(MASTER, "utf-8"));
    const list = Array.isArray(raw) ? raw : raw.products || [];
    const sid = String(supplierId || "");
    const cleanHandle = normalizeHandle(handle);
    const national = nationalTail(phone);
    const next = list.filter((p) => {
      if (sid && String(p.supplierId || "") === sid) return false;
      const ph = normalizeHandle(p.shopHandle || p.sellerHandle);
      if (cleanHandle && ph === cleanHandle) return false;
      const sp = String(p.sellerPhone || p.phone || "").replace(/\D/g, "");
      if (national.length >= 9 && sp.slice(-9) === national) return false;
      return true;
    });
    const removed = list.length - next.length;
    if (removed) {
      if (Array.isArray(raw)) await writeFile(MASTER, JSON.stringify(next, null, 2) + "\n");
      else await writeFile(MASTER, JSON.stringify({ ...raw, products: next }, null, 2) + "\n");
    }
    return removed;
  } catch (err) {
    console.warn("[purge-account] json listings:", err.message);
    return 0;
  }
}

async function resolveUserIds({ phone, handle }) {
  const ids = new Set();
  const national = nationalTail(phone);
  const cleanHandle = normalizeHandle(handle);
  if (national.length >= 9) {
    const { rows } = await query(
      `SELECT id FROM users
        WHERE regexp_replace(COALESCE(phone,''), '\\D', '', 'g') LIKE '%' || $1
        LIMIT 20`,
      [national]
    );
    for (const r of rows) ids.add(Number(r.id));
  }
  if (cleanHandle) {
    const { rows } = await query(
      `SELECT id FROM users
        WHERE LOWER(REPLACE(COALESCE(handle,''), '@', '')) = $1
        LIMIT 10`,
      [cleanHandle]
    );
    for (const r of rows) ids.add(Number(r.id));
  }
  return [...ids].filter((n) => Number.isInteger(n) && n > 0);
}

async function resolveSellerIds(userIds) {
  if (!userIds.length) return [];
  const { rows } = await query(`SELECT id FROM sellers WHERE user_id = ANY($1::int[])`, [userIds]);
  return rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * @param {string} phoneRaw
 * @param {{ adminLabel?: string, confirm?: boolean, notify?: boolean }} [opts]
 */
export async function purgeRiderAccount(
  phoneRaw,
  { adminLabel = "Boss", confirm = false, notify = true } = {}
) {
  if (!confirm) {
    return {
      ok: false,
      error: "confirm_required",
      message:
        "Permanent delete. Reply *DELETE RIDER +254… CONFIRM* (or panel confirm) to wipe this rider completely.",
    };
  }

  const digits = digitsOnly(phoneRaw);
  if (digits.length < 9) {
    return { ok: false, error: "invalid_phone", message: "Need a full rider phone number." };
  }
  if (!isDbEnabled()) {
    return { ok: false, error: "database_not_configured", message: "Database is not configured." };
  }

  const national = digits.slice(-9);
  const { rows } = await query(
    `SELECT * FROM riders
      WHERE regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1
         OR phone = $2
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [national, digits]
  );
  const row = rows[0];
  if (!row) {
    return { ok: false, error: "not_found", message: `No rider matches *${phoneRaw}*.` };
  }

  const riderId = Number(row.id);
  const name = row.full_name || "Rider";
  const phone = row.phone || digits;
  const stats = {
    dispatchesUnlinked: 0,
    payoutsRemoved: 0,
    questsRemoved: 0,
    ratingEventsRemoved: 0,
    riderDeleted: false,
  };

  try {
    const { enforceRiderAction } = await import("./enforce-account.js");
    await enforceRiderAction(phone, "SUSPEND", {
      reason: "Rider permanently deleted",
      adminLabel,
    });
  } catch (err) {
    console.warn("[purge-account] rider suspend before delete:", err.message);
  }

  try {
    const result = await query(
      `UPDATE delivery_dispatches SET rider_id = NULL, updated_at = NOW()
        WHERE rider_id = $1`,
      [riderId]
    );
    stats.dispatchesUnlinked = result.rowCount || 0;
  } catch {
    /* ignore */
  }

  try {
    const result = await query(`DELETE FROM rider_payouts WHERE rider_id = $1`, [riderId]);
    stats.payoutsRemoved = result.rowCount || 0;
  } catch {
    /* ignore */
  }

  try {
    const result = await query(`DELETE FROM rider_daily_quests WHERE rider_id = $1`, [riderId]);
    stats.questsRemoved = result.rowCount || 0;
  } catch {
    /* ignore */
  }

  try {
    const result = await query(
      `DELETE FROM rating_events WHERE subject_type = 'rider' AND subject_id = $1`,
      [riderId]
    );
    stats.ratingEventsRemoved = result.rowCount || 0;
  } catch {
    /* ignore */
  }

  try {
    await query(`DELETE FROM delivery_otp_audit WHERE rider_id = $1`, [riderId]);
  } catch {
    /* ignore */
  }

  const del = await query(`DELETE FROM riders WHERE id = $1`, [riderId]);
  stats.riderDeleted = Boolean(del.rowCount);

  if (notify && phone) {
    await notifyWhatsApp(
      phone,
      `🗑️ *Account deleted*\n\n` +
        `Your Sokoni rider profile has been *permanently deleted*.\n` +
        `You may apply again later as a new rider (or register as a seller).\n\n` +
        `support@sokonimall.com`
    );
  }

  return {
    ok: Boolean(stats.riderDeleted),
    action: "DELETE_RIDER",
    riderId,
    phone,
    name,
    stats,
    message: stats.riderDeleted
      ? `Rider *${name}* (*${phone}*) *PERMANENTLY DELETED*. Identity wiped — they can re-apply fresh. _By ${adminLabel}_`
      : `Could not delete rider *${name}* (*${phone}*).`,
  };
}
