/**
 * Pricing for a bundle of items bought together at one agreed price.
 *
 * A buyer picks three items listed at 1,200 + 1,000 + 800 and the seller
 * agrees 2,600. Those items still become three order lines, each with its own
 * escrow hold, its own dispatch and its own payout, so the 400 discount has to
 * be split across them. Get that wrong and a seller is underpaid on one line
 * and overpaid on another, and the totals stop reconciling.
 *
 * Two rules the split must never break:
 *
 *  1. The parts sum to the agreed price exactly. Not within a shilling --
 *     exactly, because the sum is what the buyer is charged.
 *  2. No line drops to zero or below. A free line breaks the payout maths and
 *     reads as a bug to the seller.
 */

/** Smallest a single line may be worth after its share of the discount. */
export const MIN_LINE_KES = 1;

/**
 * Split an agreed bundle price across lines, in proportion to what each is
 * worth at list price.
 *
 * Largest-remainder: floor every share, then hand the leftover shillings to
 * the lines with the biggest fractional parts. Rounding each share on its own
 * would leave the total a shilling or two out, and on money "close" is wrong.
 *
 * @param {Array<{id?: string, priceKes: number}>} lines
 * @param {number} agreedTotalKes
 * @returns {{ok:true, lines:Array<{id?:string, listKes:number, priceKes:number, discountKes:number}>, totalKes:number, discountKes:number}
 *          |{ok:false, error:string, message:string}}
 */
export function apportionBundlePrice(lines, agreedTotalKes) {
  const list = (Array.isArray(lines) ? lines : []).map((l) => ({
    id: l?.id,
    listKes: Math.round(Number(l?.priceKes) || 0),
  }));

  if (list.length < 2) {
    return { ok: false, error: "bundle_too_small", message: "A bundle needs at least 2 items." };
  }
  if (list.some((l) => l.listKes <= 0)) {
    return { ok: false, error: "bad_line_price", message: "Every item needs a price." };
  }

  const listTotal = list.reduce((s, l) => s + l.listKes, 0);
  const agreed = Math.round(Number(agreedTotalKes) || 0);

  if (agreed <= 0) {
    return { ok: false, error: "invalid_total", message: "Enter a bundle price." };
  }
  if (agreed > listTotal) {
    // A bundle that costs more than buying separately is a mistake, not an
    // offer. Refuse rather than quietly charging it.
    return {
      ok: false,
      error: "above_list",
      message: `A bundle can't cost more than the items separately (KES ${listTotal.toLocaleString("en-US")}).`,
    };
  }
  if (agreed < list.length * MIN_LINE_KES) {
    return {
      ok: false,
      error: "below_floor",
      message: `That's too low for ${list.length} items.`,
    };
  }

  // Exact shares, then floor, then give the remainder to the largest fractions.
  const exact = list.map((l) => (l.listKes / listTotal) * agreed);
  const floored = exact.map((v) => Math.floor(v));
  let remainder = agreed - floored.reduce((s, v) => s + v, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; k < order.length && remainder > 0; k++) {
    floored[order[k].i] += 1;
    remainder -= 1;
  }

  // Flooring can still push a small line to zero when the discount is steep.
  // Lift those to the floor and take the shillings back off the largest lines,
  // which can afford them without going under themselves.
  for (let i = 0; i < floored.length; i++) {
    if (floored[i] >= MIN_LINE_KES) continue;
    let needed = MIN_LINE_KES - floored[i];
    floored[i] = MIN_LINE_KES;
    const donors = floored
      .map((v, j) => ({ j, v }))
      .filter((d) => d.j !== i && d.v > MIN_LINE_KES)
      .sort((a, b) => b.v - a.v);
    for (const d of donors) {
      if (needed <= 0) break;
      const canGive = Math.min(needed, d.v - MIN_LINE_KES);
      floored[d.j] -= canGive;
      needed -= canGive;
    }
    if (needed > 0) {
      return {
        ok: false,
        error: "below_floor",
        message: `That's too low for ${list.length} items.`,
      };
    }
  }

  const out = list.map((l, i) => ({
    id: l.id,
    listKes: l.listKes,
    priceKes: floored[i],
    discountKes: l.listKes - floored[i],
  }));
  const total = out.reduce((s, l) => s + l.priceKes, 0);

  // Belt and braces. If this ever fires the split is wrong and the buyer
  // would be charged something other than what they agreed.
  if (total !== agreed) {
    return {
      ok: false,
      error: "split_mismatch",
      message: "Could not split that price across the items.",
    };
  }

  return { ok: true, lines: out, totalKes: total, discountKes: listTotal - total };
}

/** Sum of the list prices, for showing what the bundle saves. */
export function bundleListTotal(lines) {
  return (Array.isArray(lines) ? lines : []).reduce(
    (s, l) => s + Math.round(Number(l?.priceKes) || 0),
    0
  );
}

/**
 * Suggested opening price for a bundle.
 *
 * Ten percent off, rounded down to the nearest fifty so it reads like a price
 * a person would say rather than a calculation. Only a suggestion -- both
 * sides can change it.
 */
export function suggestBundlePrice(lines) {
  const listTotal = bundleListTotal(lines);
  if (listTotal <= 0) return 0;
  const suggested = Math.floor((listTotal * 0.9) / 50) * 50;
  return Math.max(MIN_LINE_KES * (Array.isArray(lines) ? lines.length : 1), suggested);
}
