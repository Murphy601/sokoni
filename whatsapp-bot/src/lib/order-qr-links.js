/**
 * Dynamic order QR / waybill links for WhatsApp dispatch messages.
 * Printable label already lives at website/label.html?order=SKN-####
 */
import { config } from "../config.js";

function siteBase() {
  const raw = String(config.publicSiteUrl || "https://sokonimall.com").replace(/\/$/, "");
  if (/localhost|127\.0\.0\.1/i.test(raw)) return "https://sokonimall.com";
  return raw || "https://sokonimall.com";
}

/** Seller printable QR waybill (opens label → Print). */
export function generateOrderPrintLabelUrl(orderId) {
  const id = String(orderId || "").trim().toUpperCase();
  if (!id) return `${siteBase()}/label.html`;
  return `${siteBase()}/label.html?order=${encodeURIComponent(id)}`;
}

/** Rider parcel QR / waybill verify page. */
export function generateRiderScanUrl(orderId) {
  const id = String(orderId || "").trim().toUpperCase();
  if (!id) return `${siteBase()}/rider/scan.html`;
  return `${siteBase()}/rider/scan.html?order=${encodeURIComponent(id)}`;
}

export function sellerHubRestockUrl() {
  return `${siteBase()}/suppliers/list.html`;
}

/**
 * Collapse duplicated location fragments
 * e.g. "Nairobi, Westlands, Westlands stage, Westlands" → "Nairobi, Westlands, Westlands stage"
 */
export function dedupeLocationLine(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parts = text
    .split(/[,·|;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return text;

  const out = [];
  const keys = [];
  for (const part of parts) {
    const key = part.toLowerCase().replace(/\s+/g, " ");
    if (keys.includes(key)) continue;
    // Drop if this fragment is already fully covered by a longer kept fragment
    // or is a near-duplicate ("Westland" vs "Westlands").
    const covered = keys.some((k) => k === key || k.includes(key) || key.includes(k));
    if (covered) {
      // Prefer the longer, more specific fragment — replace shorter if needed.
      const idx = keys.findIndex((k) => k !== key && (k.includes(key) || key.includes(k)));
      if (idx >= 0 && key.length > keys[idx].length) {
        keys[idx] = key;
        out[idx] = part;
      }
      continue;
    }
    keys.push(key);
    out.push(part);
  }
  return out.join(", ") || text;
}
