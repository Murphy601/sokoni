import test from "node:test";
import assert from "node:assert/strict";
import {
  isSellerShopOrdersIntent,
  isOrderSellerLookupIntent,
  isSellerListingsIntent,
  extractAllOrderIdsFromText,
  runToolRouter,
  executeTool,
} from "../services/ai-tools.js";
import { SPECIALIST_TOOLS } from "../services/agent-graph.js";
import {
  softMapSpokenToMasterCommand,
  normalizeMasterCommand,
  isOverrideCommand,
} from "../services/admin-override.js";

test("who is the seller is NOT shop-orders intent", () => {
  assert.equal(isOrderSellerLookupIntent("Do you know who the seller is for those orders"), true);
  assert.equal(isSellerShopOrdersIntent("Do you know who the seller is for those orders"), false);
  assert.equal(isSellerShopOrdersIntent("who is the seller on the dispute"), false);
  assert.equal(isSellerShopOrdersIntent("show me orders purchased from my shop"), true);
});

test("active listings intent", () => {
  assert.equal(isSellerListingsIntent("Show me active listings"), true);
  assert.equal(isSellerListingsIntent("my products"), true);
  assert.equal(isSellerListingsIntent("list riders"), false);
});

test("extractAllOrderIdsFromText picks multiple SKNs", () => {
  const ids = extractAllOrderIdsFromText("CONFIRM SKN-1011 1234 and SKN-1010 5678");
  assert.deepEqual(ids, ["SKN-1011", "SKN-1010"]);
});

test("router: who is seller → lookup_order_seller with history ids", async () => {
  const results = await runToolRouter("who is the seller for those orders", {
    phone: "254757764009",
    specialist: "general",
    allowedTools: SPECIALIST_TOOLS.general,
    history: [
      { role: "assistant", content: "Reply CONFIRM SKN-1011 1234 or CONFIRM SKN-1010 5678" },
    ],
  });
  assert.ok(results.some((r) => r.tool === "lookup_order_seller"));
  assert.ok(!results.some((r) => r.tool === "list_seller_orders"));
  const hit = results.find((r) => r.tool === "lookup_order_seller");
  assert.equal(hit.deterministic, true);
  // Orders may not exist in empty store — still must not invent perfume/tee
  assert.ok(!/Perfume Oil|Cotton T-Shirt|SK-1004/i.test(hit.message || ""));
});

test("router: active listings → list_seller_listings", async () => {
  const results = await runToolRouter("Show me active listings", {
    phone: "254700000099",
    specialist: "seller",
    allowedTools: SPECIALIST_TOOLS.seller,
  });
  assert.ok(results.some((r) => r.tool === "list_seller_listings"));
});

test("Boss soft-map LIST RIDERS / VERIFIED SELLERS", () => {
  assert.equal(softMapSpokenToMasterCommand("List available riders"), "LIST_RIDERS");
  assert.equal(softMapSpokenToMasterCommand("List verified sellers"), "LIST_SELLERS");
  assert.equal(normalizeMasterCommand("LIST AVAILABLE RIDERS"), "LIST_RIDERS");
  assert.equal(normalizeMasterCommand("LIST VERIFIED SELLERS"), "LIST_SELLERS");
  assert.equal(isOverrideCommand("LIST RIDERS"), true);
});

test("lookup_order_seller missing ids fails closed", async () => {
  const r = await executeTool("lookup_order_seller", { orderIds: [] }, { history: [] });
  assert.equal(r.tool, "lookup_order_seller");
  assert.equal(r.deterministic, true);
  assert.ok(/SKN-/i.test(r.message));
});
