/**
 * Every ~2 hours: nudge live sellers who have not configured Hub shipping rates.
 */
import { listSuppliers } from "./suppliers.js";
import {
  findConfiguredVendorProfile,
  isConfiguredShippingProfile,
} from "./vendor-shipping.js";
import { msgSellerShippingReminder } from "../lib/wa-ux.js";

const REMIND_GAP_MS = Number(process.env.SHIPPING_REMIND_GAP_MS || 2 * 60 * 60 * 1000);
const lastRemindedAt = new Map();

function sellerNeedsShippingReminder(sup) {
  const status = String(sup?.shopStatus || "live").toLowerCase();
  if (status !== "live" && status !== "under_review") return false;
  const phone = String(sup?.phone || "").replace(/\D/g, "");
  if (phone.length < 9) return false;
  const found = findConfiguredVendorProfile([
    sup.shopHandle,
    sup.id,
    sup.sellerId,
    sup.phone,
    sup.mpesaNumber,
  ]);
  return !isConfiguredShippingProfile(found.profile);
}

/**
 * @returns {{ checked: number, reminded: number, skipped: number }}
 */
export async function processSellerShippingReminders({ force = false } = {}) {
  const now = Date.now();
  const suppliers = listSuppliers();
  let checked = 0;
  let reminded = 0;
  let skipped = 0;

  const { sendText } = await import("./whatsapp.js");
  const body = msgSellerShippingReminder();

  for (const sup of suppliers) {
    checked += 1;
    if (!sellerNeedsShippingReminder(sup)) {
      skipped += 1;
      continue;
    }
    const phone = String(sup.phone || "").replace(/\D/g, "");
    const key = phone.slice(-9);
    const prev = lastRemindedAt.get(key) || 0;
    if (!force && now - prev < REMIND_GAP_MS) {
      skipped += 1;
      continue;
    }
    try {
      await sendText(`${phone}@c.us`, body);
      lastRemindedAt.set(key, now);
      reminded += 1;
    } catch (err) {
      console.warn("[shipping-remind] send failed:", phone, err.message);
      skipped += 1;
    }
  }

  if (reminded > 0) {
    console.log(`[shipping-remind] sent ${reminded} (checked ${checked}, skipped ${skipped})`);
  }
  return { checked, reminded, skipped };
}

export function shippingRemindGapMs() {
  return REMIND_GAP_MS;
}
