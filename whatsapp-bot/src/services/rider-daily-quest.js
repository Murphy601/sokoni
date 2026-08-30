/**
 * Rider daily quest — 8 deliveries / day → Sokoni Points (not cash).
 */
import { query, isDbEnabled } from "../db/pool.js";
import { awardPoints } from "./sokoni-points.js";
import { POINTS_EARN, RIDER_DAILY_QUEST_TARGET } from "../lib/sokoni-points.js";

function eatDate() {
  // Africa/Nairobi calendar day
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function getRiderDailyQuest(riderId) {
  if (!isDbEnabled()) return null;
  const id = Number(riderId);
  if (!Number.isInteger(id) || id < 1) return null;
  const day = eatDate();
  const { rows } = await query(
    `SELECT * FROM rider_daily_quests WHERE rider_id = $1 AND quest_date = $2::date`,
    [id, day]
  );
  if (rows[0]) return mapQuest(rows[0]);
  return {
    riderId: id,
    questDate: day,
    target: RIDER_DAILY_QUEST_TARGET,
    progress: 0,
    completed: false,
    pointsAwarded: 0,
    rewardPoints: POINTS_EARN.RIDER_DAILY_QUEST,
    hint: `Complete ${RIDER_DAILY_QUEST_TARGET} deliveries today for +${POINTS_EARN.RIDER_DAILY_QUEST} Sokoni Points (1000 pts ≈ KES 100).`,
  };
}

/**
 * Call after successful rider CONFIRM / delivery.
 */
export async function recordRiderDeliveryForQuest(riderId, orderRef = "") {
  if (!isDbEnabled()) return { ok: false, reason: "no_db" };
  const id = Number(riderId);
  if (!Number.isInteger(id) || id < 1) return { ok: false, reason: "invalid" };
  const day = eatDate();

  await awardPoints({
    subjectType: "rider",
    subjectId: id,
    reason: "rider_delivery",
    ref: orderRef ? `rider_del_${orderRef}` : `rider_del_${day}_${Date.now()}`,
  });

  await query(
    `INSERT INTO rider_daily_quests (rider_id, quest_date, target_deliveries, progress, updated_at)
     VALUES ($1, $2::date, $3, 1, NOW())
     ON CONFLICT (rider_id, quest_date) DO UPDATE SET
       progress = LEAST(rider_daily_quests.target_deliveries, rider_daily_quests.progress + 1),
       updated_at = NOW()`,
    [id, day, RIDER_DAILY_QUEST_TARGET]
  );

  const quest = await getRiderDailyQuest(id);
  let questBonus = null;
  if (quest && quest.progress >= quest.target && !quest.completed) {
    const pts = await awardPoints({
      subjectType: "rider",
      subjectId: id,
      reason: "rider_daily_quest",
      ref: `rider_quest_${id}_${day}`,
    });
    await query(
      `UPDATE rider_daily_quests SET completed = TRUE, points_awarded = $3, updated_at = NOW()
        WHERE rider_id = $1 AND quest_date = $2::date`,
      [id, day, pts.awarded || POINTS_EARN.RIDER_DAILY_QUEST]
    );
    questBonus = pts;
  }

  return {
    ok: true,
    quest: await getRiderDailyQuest(id),
    questBonus,
    deliveryPoints: POINTS_EARN.RIDER_DELIVERY,
  };
}

function mapQuest(row) {
  return {
    riderId: Number(row.rider_id),
    questDate: row.quest_date,
    target: Number(row.target_deliveries || RIDER_DAILY_QUEST_TARGET),
    progress: Number(row.progress || 0),
    completed: Boolean(row.completed),
    pointsAwarded: Number(row.points_awarded || 0),
    rewardPoints: POINTS_EARN.RIDER_DAILY_QUEST,
    hint: Boolean(row.completed)
      ? `Daily quest done — +${row.points_awarded || POINTS_EARN.RIDER_DAILY_QUEST} pts banked.`
      : `${row.progress}/${row.target_deliveries} deliveries · +${POINTS_EARN.RIDER_DAILY_QUEST} pts at ${row.target_deliveries}/8`,
  };
}
