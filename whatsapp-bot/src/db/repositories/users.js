import { isDbEnabled, query } from "../pool.js";
import { ensureSellerLinkedToUser } from "./sellers.js";

function normalizePhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  return d;
}

function parseUserId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function mapUserRow(row, { created = false } = {}) {
  return {
    id: Number(row.id),
    phone: row.phone,
    role: row.role || "buyer",
    handle: row.handle || null,
    displayName: row.display_name || null,
    shopName: row.shop_name || null,
    bio: row.bio || null,
    avatarUrl: row.avatar_url || null,
    location: row.location || null,
    created,
  };
}

export async function findOrCreateBuyerUserByPhone(phone) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const digits = normalizePhone(phone);
  if (!digits || digits.length < 12) {
    return { error: "invalid_phone", message: "Enter a valid WhatsApp number." };
  }

  const existing = await query(
    `SELECT id, phone, role, handle, display_name, shop_name
       FROM users
      WHERE phone = $1
      LIMIT 1`,
    [digits]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    return {
      ok: true,
      user: {
        id: Number(row.id),
        phone: row.phone,
        role: row.role || "buyer",
        handle: row.handle || null,
        displayName: row.display_name || null,
        shopName: row.shop_name || null,
        created: false,
      },
    };
  }

  const displayName = `Buyer ${digits.slice(-4)}`;
  const inserted = await query(
    `INSERT INTO users (phone, display_name, role)
     VALUES ($1, $2, 'buyer')
     RETURNING id, phone, role, handle, display_name, shop_name`,
    [digits, displayName]
  );
  const row = inserted.rows[0];
  const userId = parseUserId(row?.id);
  if (!userId) {
    return { error: "user_create_failed", message: "Could not create buyer profile right now." };
  }

  return {
    ok: true,
    user: mapUserRow(row, { created: true }),
  };
}

/**
 * Provision / upgrade a users + sellers storefront for a peer seller (JSON suppliers → Postgres).
 * Safe to call repeatedly from auth + onboard + listing publish.
 */
export async function ensureSellerSocialProfile({
  phone,
  handle,
  shopName,
  location = null,
  mpesaNumber = null,
  isVerified = true,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }

  const digits = normalizePhone(phone);
  if (!digits || digits.length < 12) {
    return { error: "invalid_phone", message: "Enter a valid WhatsApp number." };
  }

  let cleanHandle = normalizeHandle(handle);
  if (!cleanHandle || cleanHandle.length < 2) {
    return { error: "invalid_handle", message: "Enter a valid shop handle." };
  }

  const name = String(shopName || cleanHandle).trim().slice(0, 255) || cleanHandle;
  const city = location != null ? String(location).trim().slice(0, 120) || null : null;
  const mpesa = mpesaNumber != null ? normalizePhone(mpesaNumber) || null : null;

  const existingByPhone = await query(
    `SELECT id, phone, role, handle, display_name, shop_name, bio, avatar_url, location
       FROM users
      WHERE phone = $1
      LIMIT 1`,
    [digits]
  );

  let userRow = existingByPhone.rows[0] || null;
  let created = false;

  async function handleOwnerId(candidate) {
    const clash = await query(
      `SELECT id, phone FROM users
        WHERE (LOWER(handle) = $1 OR LOWER(handle) = $2)
        LIMIT 1`,
      [candidate, `@${candidate}`]
    );
    return clash.rows[0] || null;
  }

  // If preferred handle is taken by someone else, keep existing handle or suffix with phone tail.
  const owner = await handleOwnerId(cleanHandle);
  if (owner && (!userRow || Number(owner.id) !== Number(userRow.id))) {
    if (userRow?.handle) {
      cleanHandle = normalizeHandle(userRow.handle) || cleanHandle;
    } else {
      const suffix = digits.slice(-4);
      const base = cleanHandle.slice(0, 35);
      cleanHandle = normalizeHandle(`${base}-${suffix}`) || `shop-${suffix}`;
      const again = await handleOwnerId(cleanHandle);
      if (again && Number(again.id) !== Number(userRow?.id || 0)) {
        cleanHandle = `shop-${digits.slice(-8)}`;
      }
    }
  }

  if (userRow) {
    const { rows } = await query(
      `UPDATE users
          SET handle = COALESCE($2, handle),
              shop_name = COALESCE($3, shop_name),
              display_name = COALESCE($3, display_name),
              location = COALESCE($4, location),
              mpesa_number = COALESCE($5, mpesa_number),
              role = CASE WHEN role = 'admin' THEN role ELSE 'seller' END,
              is_seller_verified = COALESCE($6, is_seller_verified),
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, phone, role, handle, display_name, shop_name, bio, avatar_url, location`,
      [userRow.id, cleanHandle, name, city, mpesa, Boolean(isVerified)]
    );
    userRow = rows[0] || userRow;
  } else {
    try {
      const { rows } = await query(
        `INSERT INTO users (
           phone, display_name, role, handle, shop_name, location, mpesa_number, is_seller_verified
         ) VALUES ($1, $2, 'seller', $3, $2, $4, $5, $6)
         RETURNING id, phone, role, handle, display_name, shop_name, bio, avatar_url, location`,
        [digits, name, cleanHandle, city, mpesa, Boolean(isVerified)]
      );
      userRow = rows[0];
      created = true;
    } catch (err) {
      if (String(err?.code) === "23505") {
        const retry = await query(
          `SELECT id, phone, role, handle, display_name, shop_name, bio, avatar_url, location
             FROM users WHERE phone = $1 LIMIT 1`,
          [digits]
        );
        if (!retry.rows[0]) {
          return { error: "handle_taken", message: "That shop handle is already taken." };
        }
        userRow = retry.rows[0];
      } else {
        throw err;
      }
    }
  }

  const userId = parseUserId(userRow?.id);
  if (!userId) {
    return { error: "user_create_failed", message: "Could not create seller profile right now." };
  }

  const linked = await ensureSellerLinkedToUser({
    userId,
    slug: normalizeHandle(userRow.handle) || cleanHandle,
    businessName: userRow.shop_name || name,
    city: userRow.location || city,
    isVerified,
  });
  if (linked.error) return linked;

  return {
    ok: true,
    created,
    user: mapUserRow(userRow, { created }),
    seller: {
      id: Number(linked.seller.id),
      userId,
      slug: linked.seller.slug,
      businessName: linked.seller.business_name,
    },
  };
}
