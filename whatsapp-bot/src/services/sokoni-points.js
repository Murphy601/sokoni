/**
 * Sokoni Points wallet — earn / redeem.
 */
import { query, isDbEnabled } from "../db/pool.js";
import {
  POINTS_EARN,
  POINTS_REDEEM_THRESHOLD,
  POINTS_REDEEM_KES,
  redeemBlocks,
} from "../lib/sokoni-points.js";
import { growthLive, GROWTH_COMING_SOON } from "../lib/growth-features.js";

const REASON_AMOUNTS = {
  buyer_order_complete: POINTS_EARN.BUYER_ORDER_COMPLETE,
  seller_order_complete: POINTS_EARN.SELLER_ORDER_COMPLETE,
  seller_badge_level_up: POINTS_EARN.SELLER_BADGE_LEVEL_UP,
  rider_delivery: POINTS_EARN.RIDER_DELIVERY,
  rider_daily_quest: POINTS_EARN.RIDER_DAILY_QUEST,
  pamoja_join: POINTS_EARN.PAMOJA_JOIN,
  pamoja_fill_leader: POINTS_EARN.PAMOJA_FILL_LEADER,
  pamoja_fill_member: POINTS_EARN.PAMOJA_FILL_MEMBER,
};

function normalizeSubject(type) {
  const t = String(type || "").toLowerCase();
  if (t === "buyer" || t === "seller" || t === "rider") return t;
  return null;
}

export async function getPointsBalance(subjectType, subjectId) {
  if (!isDbEnabled()) return { balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 };
  const type = normalizeSubject(subjectType);
  const id = Number(subjectId);
  if (!type || !Number.isInteger(id) || id < 1) {
    return { balance: 0, lifetimeEarned: 0, lifetimeRedeemed: 0 };
  }
  const { rows } = await query(
    `SELECT balance, lifetime_earned, lifetime_redeemed
       FROM sokoni_points_wallets
      WHERE subject_type = $1 AND subject_id = $2`,
    [type, id]
  );
  const row = rows[0];
  return {
    balance: Number(row?.balance || 0),
    lifetimeEarned: Number(row?.lifetime_earned || 0),
    lifetimeRedeemed: Number(row?.lifetime_redeemed || 0),
    redeemThreshold: POINTS_REDEEM_THRESHOLD,
    redeemKes: POINTS_REDEEM_KES,
  };
}

/**
 * Credit points (idempotent when ref provided).
 */
export async function awardPoints({
  subjectType,
  subjectId,
  reason,
  amount = null,
  ref = "",
  meta = {},
} = {}) {
  if (!growthLive()) return { ...GROWTH_COMING_SOON, awarded: 0 };
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const type = normalizeSubject(subjectType);
  const id = Number(subjectId);
  const delta = Math.floor(Number(amount != null ? amount : REASON_AMOUNTS[reason] || 0));
  if (!type || !Number.isInteger(id) || id < 1 || delta <= 0) {
    return { ok: false, reason: "invalid" };
  }

  if (ref) {
    const existing = await query(
      `SELECT id FROM sokoni_points_ledger
        WHERE subject_type = $1 AND subject_id = $2 AND reason = $3 AND ref = $4
        LIMIT 1`,
      [type, id, String(reason).slice(0, 64), String(ref).slice(0, 120)]
    );
    if (existing.rows[0]) {
      const bal = await getPointsBalance(type, id);
      return { ok: true, duplicate: true, ...bal, awarded: 0 };
    }
  }

  await query(
    `INSERT INTO sokoni_points_wallets (subject_type, subject_id, balance, lifetime_earned, updated_at)
     VALUES ($1, $2, $3, $3, NOW())
     ON CONFLICT (subject_type, subject_id) DO UPDATE SET
       balance = sokoni_points_wallets.balance + EXCLUDED.balance,
       lifetime_earned = sokoni_points_wallets.lifetime_earned + EXCLUDED.lifetime_earned,
       updated_at = NOW()`,
    [type, id, delta]
  );

  const bal = await getPointsBalance(type, id);
  await query(
    `INSERT INTO sokoni_points_ledger
       (subject_type, subject_id, delta, balance_after, reason, ref, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      type,
      id,
      delta,
      bal.balance,
      String(reason).slice(0, 64),
      ref ? String(ref).slice(0, 120) : null,
      JSON.stringify(meta || {}),
    ]
  );

  return { ok: true, awarded: delta, ...bal };
}

/** Redeem whole blocks of 1000 pts → KES 100 credit notes (ledger only; Till applied by ops). */
export async function redeemPoints({ subjectType, subjectId } = {}) {
  if (!growthLive()) return { ...GROWTH_COMING_SOON };
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const type = normalizeSubject(subjectType);
  const id = Number(subjectId);
  if (!type || !Number.isInteger(id) || id < 1) return { ok: false, reason: "invalid" };

  const before = await getPointsBalance(type, id);
  const plan = redeemBlocks(before.balance);
  if (plan.blocks < 1) {
    return {
      ok: false,
      reason: "below_threshold",
      message: `Need ${POINTS_REDEEM_THRESHOLD} points to redeem (≈ KES ${POINTS_REDEEM_KES}). You have ${before.balance}.`,
      ...before,
    };
  }

  await query(
    `UPDATE sokoni_points_wallets SET
       balance = balance - $3,
       lifetime_redeemed = lifetime_redeemed + $3,
       updated_at = NOW()
     WHERE subject_type = $1 AND subject_id = $2`,
    [type, id, plan.pointsSpent]
  );
  const after = await getPointsBalance(type, id);
  await query(
    `INSERT INTO sokoni_points_ledger
       (subject_type, subject_id, delta, balance_after, reason, ref, meta)
     VALUES ($1,$2,$3,$4,'redeem',$5,$6::jsonb)`,
    [
      type,
      id,
      -plan.pointsSpent,
      after.balance,
      `redeem_${Date.now()}`,
      JSON.stringify({ kesCredit: plan.kesCredit, blocks: plan.blocks }),
    ]
  );

  return {
    ok: true,
    ...after,
    redeemedPoints: plan.pointsSpent,
    kesCredit: plan.kesCredit,
    message: `Redeemed ${plan.pointsSpent} pts → KES ${plan.kesCredit} store credit (ops will apply on checkout).`,
  };
}
