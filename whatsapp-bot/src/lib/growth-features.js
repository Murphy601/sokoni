/**
 * Kill switch for growth loops (Points, Power Board, Pamoja, rider quest).
 * Keep false until Boss is ready to fund / soft-launch — no earn, redeem, or pools.
 */
export const GROWTH_FEATURES_LIVE = false;

export const GROWTH_COMING_SOON = {
  ok: false,
  error: "coming_soon",
  comingSoon: true,
  message: "Coming soon — Sokoni Points, Power Board & Pamoja are paused for now.",
};

export function growthLive() {
  return GROWTH_FEATURES_LIVE === true;
}
