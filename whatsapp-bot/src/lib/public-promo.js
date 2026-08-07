/**
 * Buyer-facing promo fields for public product APIs / site catalog.
 * Never exposes seller list-net or other private cost fields.
 */
import { computeProductTotals } from "../services/shipping-tiers.js";

export function productHasActivePromo(product) {
  return Boolean(product?.promo && typeof product.promo === "object" && product.promo.active);
}

/**
 * @param {Record<string, unknown>} product
 * @param {{ totalKes?: number }} [opts]
 */
export function publicPromoFields(product, opts = {}) {
  if (!product) return {};
  const promo = product.promo && typeof product.promo === "object" ? product.promo : null;
  const active = Boolean(promo?.active);
  const current =
    opts.totalKes != null
      ? Math.round(Number(opts.totalKes) || 0)
      : Math.round(Number(computeProductTotals(product).totalKes) || 0);

  let original =
    product.originalPriceKes != null ? Math.round(Number(product.originalPriceKes) || 0) : 0;
  if (active && promo?.listPriceKes != null) {
    original = Math.round(Number(promo.listPriceKes) || 0);
  }

  if (!original || !current || original <= current) {
    if (!active) return {};
    return {
      onPromo: true,
      promo: {
        active: true,
        type: promo.type || null,
        value: promo.value != null ? Number(promo.value) : null,
      },
    };
  }

  const discountPct = Math.max(1, Math.round((1 - current / original) * 100));
  return {
    originalPriceKes: original,
    onPromo: true,
    discountPct,
    promo: active
      ? {
          active: true,
          type: promo.type || null,
          value: promo.value != null ? Number(promo.value) : null,
        }
      : { active: true, type: "sale", value: discountPct },
  };
}
