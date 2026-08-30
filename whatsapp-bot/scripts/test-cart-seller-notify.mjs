/**
 * Cart paid → one seller message listing all their lines + listing IDs.
 * Run: node whatsapp-bot/scripts/test-cart-seller-notify.mjs
 */
import { msgSellerPaid, msgSellerCartPaid } from "../src/services/communication-hub.js";

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

const single = msgSellerPaid({
  id: "SK-1019",
  productId: "hb-tlom7-003",
  productName: "Product listing",
  location: "Archways Mall hub",
  sellerPayoutKes: 400,
});
assert(single.includes("hb-tlom7-003"), "single paid includes listing id");
assert(single.includes("SK-1019"), "single paid includes order id");
assert(single.includes("DISPATCH SK-1019"), "single paid includes DISPATCH");

const parent = { id: "SKN-1002" };
const sameSellerKids = [
  {
    id: "SKN-1002-1",
    parentOrderId: "SKN-1002",
    productId: "fa-tlom7-001",
    productName: "Flip Flop",
    location: "Archways Mall hub",
    sellerPayoutKes: 200,
    supplierId: "sup-a",
  },
  {
    id: "SKN-1002-2",
    parentOrderId: "SKN-1002",
    productId: "hb-tlom7-003",
    productName: "Product listing",
    location: "Archways Mall hub",
    sellerPayoutKes: 400,
    supplierId: "sup-a",
  },
];

const cartMsg = msgSellerCartPaid(parent, sameSellerKids);
assert(cartMsg.includes("SKN-1002"), "cart msg has parent id");
assert(cartMsg.includes("fa-tlom7-001"), "cart msg has item A listing id");
assert(cartMsg.includes("hb-tlom7-003"), "cart msg has item B listing id");
assert(cartMsg.includes("SKN-1002-1"), "cart msg has child tracking A");
assert(cartMsg.includes("SKN-1002-2"), "cart msg has child tracking B");
assert(cartMsg.includes("DISPATCH SKN-1002-1"), "cart msg DISPATCH A");
assert(cartMsg.includes("DISPATCH SKN-1002-2"), "cart msg DISPATCH B");
assert(cartMsg.includes("label.html?order="), "cart msg includes printable QR links");
assert((cartMsg.match(/NEW PAID CART/g) || []).length === 1, "exactly one cart header");

// Grouping helper (mirrors escrow batching)
function groupBySupplier(children) {
  const map = new Map();
  for (const c of children) {
    const key = c.supplierId || `__none__:${c.id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  }
  return [...map.values()];
}

const mixed = [
  ...sameSellerKids,
  {
    id: "SKN-1002-3",
    parentOrderId: "SKN-1002",
    productId: "sm-tlom7-001",
    productName: "Other seller item",
    location: "Archways Mall hub",
    sellerPayoutKes: 100,
    supplierId: "sup-b",
  },
];
const groups = groupBySupplier(mixed);
assert(groups.length === 2, "two sellers → two notify groups");
assert(groups.find((g) => g.length === 2)?.[0].supplierId === "sup-a", "seller A gets both lines");
assert(groups.find((g) => g.length === 1)?.[0].supplierId === "sup-b", "seller B gets one line");

const msgs = groups.map((g) => msgSellerCartPaid(parent, g));
assert(msgs.length === 2, "two WhatsApp bodies for two sellers");
assert(msgs.some((m) => m.includes("fa-tlom7-001")), "seller A body has listing A");
assert(msgs.some((m) => m.includes("sm-tlom7-001")), "seller B body has listing B");
assert(msgs.every((m) => m.includes("label.html?order=")), "each body has QR waybill link");

if (failures.length) {
  console.error("FAIL:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("OK: cart seller notify is 1 message/seller with listing + tracking IDs.");
console.log("--- sample ---");
console.log(cartMsg);
