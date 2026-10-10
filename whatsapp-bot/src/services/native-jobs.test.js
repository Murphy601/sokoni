import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractWahaOrderCart } from "./whatsapp-native-cart.js";
import { looksLikeWaitlistAsk, joinWaitlist, resetWaitlistNotifyCooldown } from "./product-waitlist.js";
import {
  isConsumableOrder,
  isDeliveredAboutDaysAgo,
  orderDeliveredAt,
  reorderMenuText,
} from "./reorder-reminders.js";
import { executeOpsTool, OPS_TOOL_NAMES } from "./ops-tools.js";
import { parseWahaMessage } from "../handlers/webhookHandler.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

describe("native WhatsApp cart extract", () => {
  it("reads WAHA orderMessage line items", () => {
    const cart = extractWahaOrderCart({
      _data: {
        message: {
          orderMessage: {
            orderId: "wamid-1",
            items: [
              { name: "Vintage leather jacket", quantity: 1, amount: 4500, productId: "sku-jacket" },
              { title: "Serum 30ml", qty: 2, price: 1200 },
            ],
          },
        },
      },
    });
    assert.equal(cart.itemCount, 2);
    assert.equal(cart.lines[0].retailerId, "sku-jacket");
    assert.equal(cart.lines[1].quantity, 2);
  });

  it("lets a cart-only webhook through parseWahaMessage", () => {
    const parsed = parseWahaMessage({
      event: "message",
      payload: {
        from: "254711111111@c.us",
        to: "254700000000@c.us",
        body: "",
        orderMessage: {
          items: [{ name: "Serum 30ml", quantity: 1, amount: 1200, productId: "serum-1" }],
        },
      },
    });
    assert.ok(parsed);
    assert.equal(parsed.direction, "incoming");
  });
});

describe("back-in-stock waitlist", () => {
  it("recognises notify-me phrasing and stores a file row", async () => {
    resetWaitlistNotifyCooldown();
    assert.equal(looksLikeWaitlistAsk("Tell me when it's back"), true);
    assert.equal(looksLikeWaitlistAsk("how much is shipping"), false);
    const joined = await joinWaitlist({
      phone: "0711111111",
      productId: "sku-jacket",
      productName: "Vintage leather jacket",
    });
    assert.equal(joined.ok, true);
    assert.ok(["file", "postgres"].includes(joined.source));
    assert.match(joined.phone, /254711111111/);
  });
});

describe("30-day reorder window", () => {
  it("only matches consumables delivered about 30 days ago", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const delivered = {
      status: "delivered",
      productName: "Vitamin C serum",
      history: [{ status: "delivered", at: now - 30 * 24 * 60 * 60 * 1000 }],
    };
    assert.equal(isConsumableOrder(delivered), true);
    assert.equal(isConsumableOrder({ productName: "Leather jacket" }), false);
    assert.equal(isDeliveredAboutDaysAgo(delivered, 30, now), true);
    assert.equal(orderDeliveredAt(delivered) > 0, true);
    assert.match(reorderMenuText(delivered), /Re-order now/i);
    assert.match(reorderMenuText(delivered), /Remind me in a week/i);
  });
});

describe("search_store_policies tool", () => {
  it("is a named ops tool and fails soft without embeddings", async () => {
    assert.ok(OPS_TOOL_NAMES.includes("search_store_policies"));
    const result = await executeOpsTool("search_store_policies", { query: "When is my money released?" });
    assert.equal(result.tool, "search_store_policies");
    assert.ok(Array.isArray(result.hits));
    assert.ok(
      result.ok === true ||
        ["database_offline", "embed_unavailable", "embed_failed", "search_failed"].includes(result.error)
    );
  });

  it("uses cosine distance on platform_knowledge, not a second table", () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "knowledge-rag.js"), "utf-8");
    assert.match(src, /1 - \(embedding <=> \$1::vector\)/);
    assert.match(src, /FROM platform_knowledge/);
    assert.doesNotMatch(src, /CREATE TABLE.*store_policies/i);
  });
});
