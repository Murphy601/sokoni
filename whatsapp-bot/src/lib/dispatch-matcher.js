/**
 * Sokoni Dispatch & Radius Engine — score, tier, and rank available riders.
 *
 * Score = (Rating × 40) − (DistanceKm × 20) + (AcceptanceRate% × 0.4)
 * Tiers: 0–3 km (primary), 3–7 km (secondary), >7 km ignored.
 */

export const TIER1_MAX_KM = 3;
export const TIER2_MAX_KM = 7;
export const OFFER_TIMEOUT_MS = 45 * 1000;
export const LATE_PICKUP_PENALTY = 0.2;
export const CANCEL_JOB_PENALTY = 0.5;
export const LATE_PICKUP_MINUTES = 30;

/**
 * @param {{ rating?: number, distanceM?: number|null, acceptanceRate?: number }} r
 */
export function computeRiderDispatchScore(r = {}) {
  const rating = Math.min(5, Math.max(0, Number(r.rating) || 5));
  const distKm =
    r.distanceM != null && Number.isFinite(Number(r.distanceM))
      ? Math.max(0, Number(r.distanceM) / 1000)
      : TIER2_MAX_KM; // unknown distance → treat as edge of secondary tier
  const acceptance = Math.min(100, Math.max(0, Number(r.acceptanceRate) || 70));
  const score = rating * 40 - distKm * 20 + acceptance * 0.4;
  return Math.round(score * 100) / 100;
}

export function distanceTier(distanceM) {
  if (distanceM == null || !Number.isFinite(Number(distanceM))) return "UNKNOWN";
  const km = Number(distanceM) / 1000;
  if (km <= TIER1_MAX_KM) return "TIER1";
  if (km <= TIER2_MAX_KM) return "TIER2";
  return "TOO_FAR";
}

/**
 * Rank eligible riders: Tier1 first (by score), then Tier2 (by score). Drop TOO_FAR.
 * UNKNOWN distance riders go last within Tier2 bucket (scored as 7km).
 */
export function rankRidersByDispatchScore(riders = []) {
  const withMeta = riders.map((r) => {
    const distanceM = r.distanceM != null ? Number(r.distanceM) : null;
    const tier = distanceTier(distanceM);
    const score = computeRiderDispatchScore({
      rating: r.rating,
      distanceM,
      acceptanceRate: r.acceptanceRate,
    });
    return { ...r, distanceM, tier, dispatchScore: score };
  });

  const tier1 = withMeta.filter((r) => r.tier === "TIER1");
  const tier2 = withMeta.filter((r) => r.tier === "TIER2" || r.tier === "UNKNOWN");
  // >7km ignored
  const sortScore = (a, b) => {
    if (b.dispatchScore !== a.dispatchScore) return b.dispatchScore - a.dispatchScore;
    if ((a.distanceM ?? 1e12) !== (b.distanceM ?? 1e12)) {
      return (a.distanceM ?? 1e12) - (b.distanceM ?? 1e12);
    }
    return Number(a.id) - Number(b.id);
  };
  tier1.sort(sortScore);
  tier2.sort(sortScore);
  // Prefer all Tier1 before any Tier2
  return [...tier1, ...tier2];
}

export function clampRiderRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(5, Math.max(1, Math.round(n * 10) / 10));
}
