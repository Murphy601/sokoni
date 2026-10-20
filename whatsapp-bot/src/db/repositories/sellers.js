import { query } from "../pool.js";

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export async function ensureDefaultSeller() {
  const { rows } = await query(`SELECT id, user_id FROM sellers WHERE slug = 'sokoni-store' LIMIT 1`);
  let sellerId = rows[0]?.id || null;
  let userId = rows[0]?.user_id != null ? Number(rows[0].user_id) : null;

  if (!sellerId) {
    const { rows: inserted } = await query(
      `INSERT INTO sellers (business_name, slug, city, is_verified, is_active)
       VALUES ($1, $2, $3, TRUE, TRUE)
       RETURNING id, user_id`,
      ["Sokoni Store", "sokoni-store", "Kenya"]
    );
    sellerId = inserted[0].id;
    userId = inserted[0].user_id != null ? Number(inserted[0].user_id) : null;
  }

  // Platform storefront needs a users row so Make an offer / inbox can target it.
  if (!userId) {
    const existingUser = await query(
      `SELECT id FROM users
        WHERE LOWER(handle) = 'sokoni-store' OR LOWER(handle) = '@sokoni-store'
        LIMIT 1`
    );
    if (existingUser.rows[0]) {
      userId = Number(existingUser.rows[0].id);
    } else {
      const created = await query(
        `INSERT INTO users (display_name, role, handle, shop_name, location, is_seller_verified)
         VALUES ($1, 'seller', $2, $1, $3, TRUE)
         RETURNING id`,
        ["Sokoni Store", "sokoni-store", "Kenya"]
      );
      userId = Number(created.rows[0].id);
    }
    await query(`UPDATE sellers SET user_id = $2, updated_at = NOW() WHERE id = $1`, [
      sellerId,
      userId,
    ]);
  }

  return sellerId;
}

export async function getSellerBySlug(slug) {
  const clean = normalizeSlug(slug);
  if (!clean) return null;
  const { rows } = await query(
    `SELECT * FROM sellers WHERE LOWER(slug) = $1 OR LOWER(slug) = $2 LIMIT 1`,
    [clean, `@${clean}`]
  );
  return rows[0] || null;
}

export async function getSellerById(id) {
  const { rows } = await query(`SELECT * FROM sellers WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
}

/**
 * Ensure a sellers row exists for a social user + storefront slug.
 * Reuses existing row by user_id or slug when possible.
 */
export async function ensureSellerLinkedToUser({
  userId,
  slug,
  businessName,
  city = null,
  isVerified = true,
} = {}) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) {
    return { error: "invalid_user", message: "Valid userId is required." };
  }
  const cleanSlug = normalizeSlug(slug);
  if (!cleanSlug || cleanSlug.length < 2) {
    return { error: "invalid_handle", message: "Enter a valid shop handle." };
  }
  const name = String(businessName || cleanSlug).trim().slice(0, 255) || cleanSlug;
  const location = city != null ? String(city).trim().slice(0, 100) || null : null;

  const byUser = await query(`SELECT * FROM sellers WHERE user_id = $1 LIMIT 1`, [uid]);
  if (byUser.rows[0]) {
    const row = byUser.rows[0];
    const { rows } = await query(
      `UPDATE sellers
          SET business_name = COALESCE($2, business_name),
              slug = CASE
                WHEN LOWER(slug) = 'sokoni-store' THEN $3
                ELSE slug
              END,
              city = COALESCE($4, city),
              is_verified = COALESCE($5, is_verified),
              is_active = TRUE,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [row.id, name, cleanSlug, location, Boolean(isVerified)]
    );
    return { ok: true, seller: rows[0] || row };
  }

  const bySlug = await getSellerBySlug(cleanSlug);
  if (bySlug) {
    if (bySlug.user_id && Number(bySlug.user_id) !== uid) {
      return {
        error: "handle_taken",
        message: "That shop handle is already taken.",
      };
    }
    const { rows } = await query(
      `UPDATE sellers
          SET user_id = $2,
              business_name = COALESCE($3, business_name),
              city = COALESCE($4, city),
              is_verified = COALESCE($5, is_verified),
              is_active = TRUE,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [bySlug.id, uid, name, location, Boolean(isVerified)]
    );
    return { ok: true, seller: rows[0] || bySlug };
  }

  try {
    const { rows } = await query(
      `INSERT INTO sellers (user_id, business_name, slug, city, is_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING *`,
      [uid, name, cleanSlug, location, Boolean(isVerified)]
    );
    return { ok: true, seller: rows[0] };
  } catch (err) {
    if (String(err?.code) === "23505") {
      return { error: "handle_taken", message: "That shop handle is already taken." };
    }
    throw err;
  }
}
