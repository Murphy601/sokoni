/**
 * "Where is my order?" is a read of that phone's orders.
 * It never pages the admin.
 */

export function isWhereIsMyOrder(text) {
  const n = String(text || "")
    .toLowerCase()
    .replace(/[!?.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || n.length > 80) return false;
  return (
    /\bwhere('?s| is) my order\b/.test(n) ||
    /\bwhere('?s| is) (the|my) parcel\b/.test(n) ||
    /\border (yangu )?(iko )?wapi\b/.test(n) ||
    /\bwapi order\b/.test(n) ||
    /\bstatus ya order\b/.test(n) ||
    /\btrack my order\b/.test(n) ||
    /\bhaven'?t received my order\b/.test(n)
  );
}
