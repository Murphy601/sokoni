/** Sokoni retail = supplier cost + flat KES 100 + 8%. */
export const MARKUP_FLAT_KES = 100;
export const MARKUP_PERCENT = 0.08;

export function computeRetailPrice(supplierPriceKes) {
  const cost = Math.max(0, Number(supplierPriceKes) || 0);
  const percentPart = Math.round(cost * MARKUP_PERCENT);
  const raw = cost + MARKUP_FLAT_KES + percentPart;
  return roundRetail(raw);
}

export function computeMargin(supplierPriceKes, retailPriceKes = null) {
  const cost = Math.max(0, Number(supplierPriceKes) || 0);
  const retail = retailPriceKes != null ? Number(retailPriceKes) : computeRetailPrice(cost);
  return Math.max(0, retail - cost);
}

/** Round up to nearest KES 50 for clean COD totals. */
export function roundRetail(amount) {
  const n = Math.max(0, Number(amount) || 0);
  return Math.ceil(n / 50) * 50;
}

export function pricingBreakdown(supplierPriceKes) {
  const cost = Math.max(0, Number(supplierPriceKes) || 0);
  const percentPart = Math.round(cost * MARKUP_PERCENT);
  const retail = computeRetailPrice(cost);
  return {
    supplierPriceKes: cost,
    flatMarkupKes: MARKUP_FLAT_KES,
    percentMarkupKes: percentPart,
    retailPriceKes: retail,
    marginKes: retail - cost,
  };
}
