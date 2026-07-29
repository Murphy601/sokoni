import { isDbEnabled, query } from "../pool.js";

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
    user: {
      id: userId,
      phone: row.phone,
      role: row.role || "buyer",
      handle: row.handle || null,
      displayName: row.display_name || null,
      shopName: row.shop_name || null,
      created: true,
    },
  };
}
