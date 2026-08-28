/**
 * Buyer-facing promo fields for public product APIs / site catalog.
 * Never exposes seller list-net or other private cost fields.
 *
 * Strike-through + % OFF only when current price < compare-at (original) price.
 * Price raises clear compare-at — badges must not appear.
 */
import { computeProductTotals } from "../services/shipping-tiers.js";

export function productHasActivePromo(product) {
  return Boolean(product?.promo && typeof product.promo === "object" && product.promo.active);
}

function resolveCompareAtKes(product, promo) {
  let original =
    product?.compareAtPrice != null
      ? Math.round(Number(product.compareAtPrice) || 0)
      : product?.originalPriceKes != null
        ? Math.round(Number(product.originalPriceKes) || 0)
        : 0;
  if (promo?.active && promo?.listPriceKes != null) {
    const list = Math.round(Number(promo.listPriceKes) || 0);
    if (list > 0) original = Math.max(original || 0, list);
  }
  return original > 0 ? original : 0;
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

  const original = resolveCompareAtKes(product, promo);

  // Strict rule: badges / strike-through only when current < compare-at.
  if (!original || !current || current >= original) {
    return {};
  }

  const discountPct = Math.max(1, Math.round(((original - current) / original) * 100));
  return {
    originalPriceKes: original,
    compareAtPrice: original,
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
