/**
 * Seller Power Board — progress toward next badge tier.
 * Performance tiers are separate from 🔷 VERIFIED STORE trust chip.
 */
import { VERIFIED_MIN_RATING, clampRating, disputeRate } from "./weighted-rating.js";

const LADDER = [
  {
    id: "newbie",
    label: "🐣 New Store",
    emoji: "🐣",
  },
  {
    id: "rising",
    label: "🛡️ Rising Merchant",
    emoji: "🛡️",
    needOrders: 10,
    needRating: VERIFIED_MIN_RATING,
    needVerifiedStore: true,
  },
  {
    id: "top_rated",
    label: "🌟 Top Rated",
    emoji: "🌟",
    needOrders: 50,
    needRating: 4.7,
    needDisputeRateBelow: 0.02,
  },
  {
    id: "legend",
    label: "👑 Sokoni Legend",
    emoji: "👑",
    needOrders: 200,
    needRating: 4.9,
    needUnresolved: 0,
  },
];

/** Map engine tier ids → power-board ids */
function normalizeTier(tier) {
  const t = String(tier || "newbie").toLowerCase();
  if (t === "verified") return "rising";
  return t;
}

/**
 * @param {{
 *   completedOrders?: number,
 *   avgRating?: number,
 *   unrated?: boolean,
 *   isVerifiedStore?: boolean,
 *   disputeCount?: number,
 *   unresolvedDisputes?: number,
 *   badgeTier?: string,
 * }} stats
 */
export function buildSellerPowerBoard(stats = {}) {
  const completed = Math.max(0, Number(stats.completedOrders ?? stats.salesCount ?? 0) || 0);
  const unrated = Boolean(stats.unrated);
  const rating = unrated ? 0 : clampRating(Number(stats.avgRating || 0));
  const verifiedStore = Boolean(stats.isVerifiedStore ?? stats.isSellerVerified);
  const disputes = Math.max(0, Number(stats.disputeCount || 0));
  const unresolved = Math.max(0, Number(stats.unresolvedDisputes || 0));
  const dRate = disputeRate(disputes, completed);
  const currentId = normalizeTier(stats.badgeTier || stats.tier || "newbie");

  let currentIdx = LADDER.findIndex((t) => t.id === currentId);
  if (currentIdx < 0) currentIdx = 0;

  // Recompute highest earned rung from stats (authoritative)
  let earnedIdx = 0;
  if (
    completed >= 10 &&
    rating >= VERIFIED_MIN_RATING &&
    verifiedStore &&
    !unrated
  ) {
    earnedIdx = 1;
  }
  if (completed >= 50 && rating >= 4.7 && dRate < 0.02 && !unrated) {
    earnedIdx = 2;
  }
  if (completed >= 200 && rating >= 4.9 && unresolved === 0 && !unrated) {
    earnedIdx = 3;
  }
  currentIdx = Math.max(currentIdx, earnedIdx);

  const current = LADDER[currentIdx];
  const next = LADDER[currentIdx + 1] || null;

  /** @type {{ id: string, label: string, done: boolean, detail: string }[]} */
  const checklist = [];
  let progressPct = 100;
  let headline = `You're at ${current.label}`;
  let nextHint = "You've unlocked every seller tier — keep the score strong.";

  if (next) {
    const needOrders = next.needOrders || 0;
    const ordersLeft = Math.max(0, needOrders - completed);
    const orderPct = needOrders > 0 ? Math.min(100, Math.round((completed / needOrders) * 100)) : 100;

    checklist.push({
      id: "orders",
      label: `Complete ${needOrders} orders`,
      done: completed >= needOrders,
      detail: `${completed} / ${needOrders}${ordersLeft ? ` · ${ordersLeft} to go` : ""}`,
    });

    if (next.needRating != null) {
      const ok = !unrated && rating >= next.needRating;
      checklist.push({
        id: "rating",
        label: `Keep rating ≥ ${next.needRating}`,
        done: ok,
        detail: unrated ? "UNRATED (need 5 buyer reviews)" : `Now ★ ${rating.toFixed(1)}`,
      });
    }

    if (next.needVerifiedStore) {
      checklist.push({
        id: "verified_store",
        label: "🔷 VERIFIED STORE",
        done: verifiedStore,
        detail: verifiedStore ? "Active" : "Ask Boss: VERIFY STORE @handle",
      });
    }

    if (next.needDisputeRateBelow != null) {
      const ok = dRate < next.needDisputeRateBelow;
      checklist.push({
        id: "disputes",
        label: `Dispute rate under ${Math.round(next.needDisputeRateBelow * 100)}%`,
        done: ok,
        detail: `${(dRate * 100).toFixed(1)}%`,
      });
    }

    if (next.needUnresolved != null) {
      checklist.push({
        id: "unresolved",
        label: "Zero open disputes",
        done: unresolved <= next.needUnresolved,
        detail: `${unresolved} open`,
      });
    }

    const doneCount = checklist.filter((c) => c.done).length;
    progressPct = Math.round(
      (doneCount / Math.max(1, checklist.length)) * 0.55 * 100 + orderPct * 0.45
    );
    progressPct = Math.min(99, Math.max(orderPct, progressPct));

    headline = `${current.label} → ${next.label}`;
    if (ordersLeft > 0) {
      nextHint = `Complete ${ordersLeft} more order${ordersLeft === 1 ? "" : "s"} to unlock ${next.label}`;
    } else {
      nextHint = `Almost there — finish the checklist for ${next.label}`;
    }
  }

  return {
    currentTier: current.id,
    currentLabel: current.label,
    currentEmoji: current.emoji,
    nextTier: next?.id || null,
    nextLabel: next?.label || null,
    nextEmoji: next?.emoji || null,
    headline,
    nextHint,
    progressPct: next ? progressPct : 100,
    completedOrders: completed,
    avgRating: unrated ? 0 : rating,
    unrated,
    isVerifiedStore: verifiedStore,
    checklist,
    ladder: LADDER.map((t, i) => ({
      id: t.id,
      label: t.label,
      emoji: t.emoji,
      unlocked: i <= currentIdx,
      current: i === currentIdx,
    })),
    pointsNote: "Level-ups earn +25 Sokoni Points (1000 pts ≈ KES 100 credit).",
  };
}
