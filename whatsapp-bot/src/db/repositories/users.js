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
    phone: row.phone || null,
    email: row.email || null,
    role: row.role || "buyer",
    handle: row.handle || null,
    displayName: row.display_name || null,
    shopName: row.shop_name || null,
    bio: row.bio || null,
    avatarUrl: row.avatar_url || null,
    location: row.location || null,
    hasPassword: Boolean(row.password_hash),
    created,
  };
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .slice(0, 255);
}

const ACCOUNT_USER_COLS =
  "id, phone, email, role, handle, display_name, shop_name, bio, avatar_url, location, password_hash";

export async function findUserByPhone(phone) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const digits = normalizePhone(phone);
  if (!digits || digits.length < 12) {
    return { error: "invalid_phone", message: "Enter a valid WhatsApp number." };
  }
  const { rows } = await query(
    `SELECT ${ACCOUNT_USER_COLS}
       FROM users
      WHERE phone = $1
      LIMIT 1`,
    [digits]
  );
  if (!rows[0]) return { ok: true, user: null };
  return { ok: true, user: mapUserRow(rows[0]), passwordHash: rows[0].password_hash || null };
}

export async function findUserByEmail(email) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) {
    return { error: "invalid_email", message: "Enter a valid email address." };
  }
  const { rows } = await query(
    `SELECT ${ACCOUNT_USER_COLS}
       FROM users
      WHERE LOWER(email) = $1
      LIMIT 1`,
    [normalized]
  );
  if (!rows[0]) return { ok: true, user: null };
  return { ok: true, user: mapUserRow(rows[0]), passwordHash: rows[0].password_hash || null };
}

export async function findUserById(userId) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const id = parseUserId(userId);
  if (!id) return { error: "invalid_user", message: "Invalid user." };
  const { rows } = await query(
    `SELECT ${ACCOUNT_USER_COLS}
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  if (!rows[0]) return { ok: true, user: null };
  return { ok: true, user: mapUserRow(rows[0]), passwordHash: rows[0].password_hash || null };
}

/**
 * Create a site account with email + password (phone optional).
 */
export async function createEmailAccountUser({
  email,
  passwordHash,
  displayName,
  phone = null,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const normalized = normalizeEmail(email);
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { error: "invalid_email", message: "Enter a valid email address." };
  }
  if (!passwordHash) {
    return { error: "invalid_password", message: "Password is required." };
  }

  let digits = null;
  if (phone) {
    digits = normalizePhone(phone);
    if (!digits || digits.length < 12) {
      return { error: "invalid_phone", message: "Enter a valid Kenyan WhatsApp number, or leave phone blank." };
    }
    const phoneTaken = await query(`SELECT id FROM users WHERE phone = $1 LIMIT 1`, [digits]);
    if (phoneTaken.rows[0]) {
      return {
        error: "phone_taken",
        message: "That phone is already on another Sokoni account. Log in or use a different number.",
      };
    }
  }

  const name =
    String(displayName || "").trim().slice(0, 120) ||
    normalized.split("@")[0].slice(0, 40) ||
    "Sokoni shopper";

  try {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, display_name, phone, role)
       VALUES ($1, $2, $3, $4, 'buyer')
       RETURNING ${ACCOUNT_USER_COLS}`,
      [normalized, passwordHash, name, digits]
    );
    return { ok: true, user: mapUserRow(rows[0], { created: true }) };
  } catch (err) {
    if (String(err?.code) === "23505") {
      return { error: "email_taken", message: "An account with that email already exists. Log in instead." };
    }
    throw err;
  }
}

export async function updateUserPasswordHash(userId, passwordHash) {
  const id = parseUserId(userId);
  if (!id || !passwordHash) return { error: "invalid_input", message: "Invalid password update." };
  const { rows } = await query(
    `UPDATE users
        SET password_hash = $2,
            password_reset_token = NULL,
            password_reset_expires_at = NULL,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${ACCOUNT_USER_COLS}`,
    [id, passwordHash]
  );
  if (!rows[0]) return { error: "not_found", message: "Account not found." };
  return { ok: true, user: mapUserRow(rows[0]) };
}

export async function setUserPasswordResetToken(userId, token, expiresAt) {
  const id = parseUserId(userId);
  if (!id) return { error: "invalid_user", message: "Invalid user." };
  const { rows } = await query(
    `UPDATE users
        SET password_reset_token = $2,
            password_reset_expires_at = $3,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, email`,
    [id, token || null, expiresAt || null]
  );
  if (!rows[0]) return { error: "not_found", message: "Account not found." };
  return { ok: true, userId: Number(rows[0].id), email: rows[0].email };
}

export async function findUserByPasswordResetToken(token) {
  const t = String(token || "").trim();
  if (!t) return { ok: true, user: null };
  const { rows } = await query(
    `SELECT ${ACCOUNT_USER_COLS}, password_reset_expires_at
       FROM users
      WHERE password_reset_token = $1
      LIMIT 1`,
    [t]
  );
  if (!rows[0]) return { ok: true, user: null };
  return {
    ok: true,
    user: mapUserRow(rows[0]),
    passwordHash: rows[0].password_hash || null,
    resetExpiresAt: rows[0].password_reset_expires_at
      ? new Date(rows[0].password_reset_expires_at).getTime()
      : null,
  };
}

/** Attach or update phone on an existing email account (Phase C link). */
export async function linkPhoneToUser(userId, phone) {
  const id = parseUserId(userId);
  const digits = normalizePhone(phone);
  if (!id) return { error: "invalid_user", message: "Invalid user." };
  if (!digits || digits.length < 12) {
    return { error: "invalid_phone", message: "Enter a valid WhatsApp number." };
  }
  const taken = await query(
    `SELECT ${ACCOUNT_USER_COLS} FROM users WHERE phone = $1 AND id <> $2 LIMIT 1`,
    [digits, id]
  );
  if (taken.rows[0]) {
    return {
      error: "phone_taken",
      message: "That phone is already linked to another account.",
      otherUser: mapUserRow(taken.rows[0]),
      otherPasswordHash: taken.rows[0].password_hash || null,
    };
  }
  const { rows } = await query(
    `UPDATE users
        SET phone = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING ${ACCOUNT_USER_COLS}`,
    [id, digits]
  );
  if (!rows[0]) return { error: "not_found", message: "Account not found." };
  return { ok: true, user: mapUserRow(rows[0]) };
}

/**
 * Merge a phone-only social user into an email account (or absorb email into phone user).
 * Prefer keeping the email account id when the phone user has no password/email.
 */
export async function unifyEmailAccountWithPhone({
  accountUserId,
  phone,
  passwordHash = null,
  email = null,
  displayName = null,
} = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured." };
  }
  const accountId = parseUserId(accountUserId);
  const digits = normalizePhone(phone);
  if (!accountId || !digits) {
    return { error: "invalid_input", message: "Account and phone are required." };
  }

  const accountRes = await findUserById(accountId);
  if (accountRes.error || !accountRes.user) {
    return { error: "not_found", message: "Account not found." };
  }
  const account = accountRes.user;

  if (account.phone && account.phone === digits) {
    return { ok: true, user: account, merged: false };
  }
  if (account.phone && account.phone !== digits) {
    return {
      error: "phone_mismatch",
      message: "This account already has a different WhatsApp number.",
    };
  }

  const phoneOwner = await query(
    `SELECT ${ACCOUNT_USER_COLS} FROM users WHERE phone = $1 LIMIT 1`,
    [digits]
  );
  const other = phoneOwner.rows[0] ? mapUserRow(phoneOwner.rows[0]) : null;

  if (!other) {
    return linkPhoneToUser(accountId, digits);
  }

  if (other.id === accountId) {
    return { ok: true, user: account, merged: false };
  }

  // Phone user already has its own email/password — do not steal it.
  if (other.email && other.hasPassword && other.email !== account.email) {
    return {
      error: "phone_taken",
      message: "That WhatsApp belongs to another Sokoni login. Use that email, or a different number.",
    };
  }

  // Prefer phone user's row if account is email-only orphan: move credentials onto phone user, delete account.
  const keepId = other.id;
  const dropId = accountId;
  const emailToKeep = account.email || other.email || email;
  const hashToKeep = passwordHash || accountRes.passwordHash || phoneOwner.rows[0].password_hash;
  const nameToKeep = account.displayName || other.displayName || displayName;

  await query(
    `UPDATE users
        SET email = COALESCE($2, email),
            password_hash = COALESCE($3, password_hash),
            display_name = COALESCE($4, display_name),
            updated_at = NOW()
      WHERE id = $1`,
    [keepId, emailToKeep, hashToKeep, nameToKeep]
  );

  // Clear unique email/phone from dropped row then delete.
  await query(
    `UPDATE users
        SET email = NULL, phone = NULL, password_hash = NULL, updated_at = NOW()
      WHERE id = $1`,
    [dropId]
  );
  try {
    await query(`DELETE FROM users WHERE id = $1`, [dropId]);
  } catch (err) {
    console.warn("[users] could not delete merged orphan user", dropId, err.message);
  }

  const refreshed = await findUserById(keepId);
  return { ok: true, user: refreshed.user, merged: true, keptUserId: keepId, droppedUserId: dropId };
}

export async function updateAccountProfile(userId, { displayName, phone } = {}) {
  const id = parseUserId(userId);
  if (!id) return { error: "invalid_user", message: "Invalid user." };

  let digits = undefined;
  if (phone !== undefined) {
    if (phone === null || phone === "") {
      digits = null;
    } else {
      digits = normalizePhone(phone);
      if (!digits || digits.length < 12) {
        return { error: "invalid_phone", message: "Enter a valid WhatsApp number." };
      }
      const taken = await query(
        `SELECT id FROM users WHERE phone = $1 AND id <> $2 LIMIT 1`,
        [digits, id]
      );
      if (taken.rows[0]) {
        return { error: "phone_taken", message: "That phone is already linked to another account." };
      }
    }
  }

  const name =
    displayName !== undefined ? String(displayName || "").trim().slice(0, 120) || null : undefined;

  const { rows } = await query(
    `UPDATE users
        SET display_name = COALESCE($2, display_name),
            phone = CASE WHEN $3::boolean THEN $4 ELSE phone END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${ACCOUNT_USER_COLS}`,
    [id, name ?? null, digits !== undefined, digits ?? null]
  );
  if (!rows[0]) return { error: "not_found", message: "Account not found." };
  return { ok: true, user: mapUserRow(rows[0]) };
}

export { normalizeEmail, normalizePhone };

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
