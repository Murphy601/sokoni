#!/usr/bin/env node
/**
 * Fire seller + admin dispute WhatsApp alerts for an existing order (no buyer chat).
 *
 *   cd ~/sokoni/whatsapp-bot
 *   node scripts/test-dispute-alerts-for-order.mjs SKN-1234
 */
import { getOrder, normalizeOrderId } from "../src/services/orders.js";
import {
  sendSellerDisputeAlert,
  sendAdminDisputeAlert,
} from "../src/services/dispute-protocol.js";
import { config } from "../src/config.js";

const raw = process.argv[2] || "";
const orderId = normalizeOrderId(raw) || String(raw || "").toUpperCase();
if (!orderId || !/^SKN?-/i.test(orderId)) {
  console.error("Usage: node scripts/test-dispute-alerts-for-order.mjs SKN-1234");
  process.exit(1);
}

const order = getOrder(orderId);
if (!order) {
  console.error("FAIL: order not found:", orderId);
  process.exit(1);
}

console.log("Order:", order.id, "| product:", order.productId || "—", "| sellerPhone:", order.sellerPhone || "—");
console.log("Supplier:", order.supplierId || "—");
console.log("Admin primary:", config.admin.primary || "(unset)");
console.log("WAHA:", config.waha.apiUrl || "(unset)", "| key:", config.waha.apiKey ? "set" : "MISSING");

const issueType = "VM smoke test dispute alert";
const sellerOk = await sendSellerDisputeAlert(order.id, {
  disputeId: null,
  issueType,
});
const adminOk = await sendAdminDisputeAlert(order.id, {
  phone: order.phone || "",
  disputeId: null,
  issueType,
  opened: true,
});

console.log("Seller alert:", sellerOk ? "OK" : "FAIL");
console.log("Admin alert:", adminOk ? "OK" : "FAIL");
process.exit(sellerOk || adminOk ? 0 : 1);
