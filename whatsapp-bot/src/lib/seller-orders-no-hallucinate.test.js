/**
 * Seller shop orders — phone-scoped, no LLM hallucination.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  isSellerShopOrdersIntent,
  executeTool,
  runToolRouter,
} from "../services/ai-tools.js";
import { SPECIALIST_TOOLS } from "../services/agent-graph.js";

test("isSellerShopOrdersIntent catches shop-sales phrasing", () => {
  assert.equal(isSellerShopOrdersIntent("orders purchased from my shop"), true);
  assert.equal(isSellerShopOrdersIntent("show me my shop orders"), true);
  assert.equal(isSellerShopOrdersIntent("my sales"), true);
  assert.equal(isSellerShopOrdersIntent("@Adiv's Thrift"), true);
  assert.equal(isSellerShopOrdersIntent("where is my order"), false);
  assert.equal(isSellerShopOrdersIntent("nike sneakers under 3000"), false);
  assert.equal(isSellerShopOrdersIntent("who is the seller for those orders"), false);
});

test("seller specialist allowlist includes list_seller_orders", () => {
  assert.ok(SPECIALIST_TOOLS.seller.includes("list_seller_orders"));
  assert.ok(!SPECIALIST_TOOLS.seller.includes("list_orders"));
});

test("list_seller_orders without phone fails closed (no fake rows)", async () => {
  const r = await executeTool("list_seller_orders", {}, { phone: "" });
  assert.equal(r.tool, "list_seller_orders");
  assert.equal(r.count, 0);
  assert.deepEqual(r.orders, []);
  assert.equal(r.deterministic, true);
  assert.ok(r.message);
  assert.ok(!/SK-1004|Perfume|T-Shirt/i.test(r.message));
});

test("list_seller_orders unknown phone → not a seller, empty orders", async () => {
  const r = await executeTool("list_seller_orders", {}, { phone: "254700000099" });
  assert.equal(r.count, 0);
  assert.deepEqual(r.orders, []);
  assert.equal(r.deterministic, true);
  assert.ok(/isn't linked|not linked|Seller Hub/i.test(r.message));
  assert.ok(!/SK-1004|SK-1005|Perfume Oil|Cotton T-Shirt/i.test(r.message));
});

test("tool router uses list_seller_orders for shop-order intents", async () => {
  const results = await runToolRouter("show me orders purchased from my shop", {
    phone: "254700000099",
    specialist: "seller",
    allowedTools: SPECIALIST_TOOLS.seller,
  });
  assert.ok(results.some((r) => r.tool === "list_seller_orders"));
  assert.ok(!results.some((r) => r.tool === "list_orders"));
});
