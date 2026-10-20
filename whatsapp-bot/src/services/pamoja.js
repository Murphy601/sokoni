/**
 * Pamoja group-buy pools — WhatsApp share to fill 3–5 buyers.
 * Rewards are Sokoni Points (not cash) when the pool fills.
 */
import { query, isDbEnabled } from "../db/pool.js";
import { awardPoints } from "./sokoni-points.js";
import { POINTS_EARN } from "../lib/sokoni-points.js";
import { growthLive, GROWTH_COMING_SOON } from "../lib/growth-features.js";

function publicCode() {
  return `PJ${Date.now().toString(36).toUpperCase().slice(-6)}${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;
}

function memberKey(phone = "", userId = null) {
  if (userId) return `u:${Number(userId)}`;
  const d = String(phone || "").replace(/\D/g, "");
  return d ? `p:${d.slice(-9)}` : "";
}

export async function createPamojaPool({
  productId,
  leaderPhone = "",
  leaderUserId = null,
  targetSize = 3,
  discountPct = 8,
  hoursOpen = 2,
} = {}) {
  if (!growthLive()) return { ...GROWTH_COMING_SOON };
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const pid = String(productId || "").trim();
  if (!pid) return { error: "invalid", message: "Need a product id." };
  const size = Math.min(5, Math.max(3, Number(targetSize) || 3));
  const code = publicCode();
  const expires = new Date(Date.now() + Math.max(1, Number(hoursOpen) || 2) * 3600 * 1000);
  const key = memberKey(leaderPhone, leaderUserId);
  if (!key) return { error: "invalid", message: "Sign in or use WhatsApp phone to start a Pamoja pool." };

  const { rows } = await query(
    `INSERT INTO pamoja_pools
       (public_code, product_id, leader_phone, leader_user_id, target_size, member_count, discount_pct, expires_at)
     VALUES ($1,$2,$3,$4,$5,1,$6,$7)
     RETURNING *`,
    [
      code,
      pid,
      leaderPhone || null,
      leaderUserId ? Number(leaderUserId) : null,
      size,
      Math.min(20, Math.max(5, Number(discountPct) || 8)),
      expires.toISOString(),
    ]
  );
  const pool = rows[0];
  await query(
    `INSERT INTO pamoja_members (pool_id, member_key, phone, user_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [pool.id, key, leaderPhone || null, leaderUserId ? Number(leaderUserId) : null]
  );

  if (leaderUserId) {
    await awardPoints({
      subjectType: "buyer",
      subjectId: leaderUserId,
      reason: "pamoja_join",
      ref: `pamoja_join_${pool.id}_${key}`,
    });
  }

  return {
    ok: true,
    pool: mapPool(pool),
    shareUrl: `https://sokonimall.com/index.html?pamoja=${encodeURIComponent(code)}`,
    shareText:
      `Pamoja Deal on Sokoni 🛍️\n` +
      `Join my group buy (${size} buyers) for ~${pool.discount_pct}% off.\n` +
      `Pool closes in ${hoursOpen}h — tap to join:\n` +
      `https://sokonimall.com/index.html?pamoja=${encodeURIComponent(code)}`,
  };
}

export async function joinPamojaPool({
  code,
  phone = "",
  userId = null,
} = {}) {
  if (!growthLive()) return { ...GROWTH_COMING_SOON };
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const clean = String(code || "").trim().toUpperCase();
  const key = memberKey(phone, userId);
  if (!clean || !key) return { error: "invalid", message: "Need pool code + identity." };

  const { rows } = await query(`SELECT * FROM pamoja_pools WHERE public_code = $1 LIMIT 1`, [clean]);
  const pool = rows[0];
  if (!pool) return { error: "not_found", message: "Pamoja pool not found." };
  if (pool.status !== "open") {
    return { error: "closed", message: `Pool is ${pool.status}.`, pool: mapPool(pool) };
  }
  if (new Date(pool.expires_at).getTime() < Date.now()) {
    await query(`UPDATE pamoja_pools SET status = 'expired' WHERE id = $1`, [pool.id]);
    return { error: "expired", message: "This Pamoja pool expired." };
  }

  const ins = await query(
    `INSERT INTO pamoja_members (pool_id, member_key, phone, user_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING
     RETURNING pool_id`,
    [pool.id, key, phone || null, userId ? Number(userId) : null]
  );
  if (!ins.rows[0]) {
    return { ok: true, alreadyJoined: true, pool: mapPool(pool) };
  }

  const updated = await query(
    `UPDATE pamoja_pools SET member_count = member_count + 1
      WHERE id = $1 AND status = 'open'
      RETURNING *`,
    [pool.id]
  );
  let next = updated.rows[0] || pool;

  if (userId) {
    await awardPoints({
      subjectType: "buyer",
      subjectId: userId,
      reason: "pamoja_join",
      ref: `pamoja_join_${pool.id}_${key}`,
    });
  }

  if (Number(next.member_count) >= Number(next.target_size)) {
    next = (
      await query(
        `UPDATE pamoja_pools SET status = 'filled', filled_at = NOW()
          WHERE id = $1 RETURNING *`,
        [pool.id]
      )
    ).rows[0];
    await awardPamojaFill(next);
  }

  return { ok: true, pool: mapPool(next), filled: next.status === "filled" };
}

async function awardPamojaFill(pool) {
  const { rows } = await query(
    `SELECT * FROM pamoja_members WHERE pool_id = $1`,
    [pool.id]
  );
  for (const m of rows) {
    if (!m.user_id) continue;
    const isLeader =
      (pool.leader_user_id && Number(m.user_id) === Number(pool.leader_user_id)) ||
      false;
    await awardPoints({
      subjectType: "buyer",
      subjectId: m.user_id,
      reason: isLeader ? "pamoja_fill_leader" : "pamoja_fill_member",
      amount: isLeader ? POINTS_EARN.PAMOJA_FILL_LEADER : POINTS_EARN.PAMOJA_FILL_MEMBER,
      ref: `pamoja_fill_${pool.id}_${m.member_key}`,
    });
  }
}

export async function getPamojaPool(code) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const clean = String(code || "").trim().toUpperCase();
  const { rows } = await query(`SELECT * FROM pamoja_pools WHERE public_code = $1 LIMIT 1`, [clean]);
  if (!rows[0]) return { error: "not_found" };
  return { ok: true, pool: mapPool(rows[0]) };
}

function mapPool(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    code: row.public_code,
    productId: row.product_id,
    targetSize: Number(row.target_size),
    memberCount: Number(row.member_count),
    discountPct: Number(row.discount_pct),
    status: row.status,
    expiresAt: row.expires_at,
    filledAt: row.filled_at || null,
    seatsLeft: Math.max(0, Number(row.target_size) - Number(row.member_count)),
  };
}
