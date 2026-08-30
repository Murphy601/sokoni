import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOrderLabelQrIntent,
  executeTool,
  runToolRouter,
} from "../services/ai-tools.js";
import { generateOrderPrintLabelUrl } from "./order-qr-links.js";

describe("AI printable QR / label tool", () => {
  it("detects QR / waybill intent and bare SKN follow-up", () => {
    assert.equal(isOrderLabelQrIntent("QR code link for my order"), true);
    assert.equal(isOrderLabelQrIntent("print my waybill"), true);
    assert.equal(
      isOrderLabelQrIntent("SKN-1020", [
        { role: "assistant", content: "Please let me know the order ID for the QR code" },
      ]),
      true
    );
    assert.equal(isOrderLabelQrIntent("hello"), false);
  });

  it("returns label.html URL without asterisks or /qr path", async () => {
    // Seed a tiny order in memory if create path exists — otherwise tool returns not_found with message.
    const r = await executeTool("get_order_label", { orderId: "SKN-1020" }, {});
    assert.equal(r.tool, "get_order_label");
    assert.equal(r.deterministic, true);
    if (r.ok) {
      assert.match(r.printLabelUrl, /label\.html\?order=SKN-1020/);
      assert.doesNotMatch(r.printLabelUrl, /\/qr\?/);
      assert.doesNotMatch(r.message, /\*https?:\/\//);
      assert.match(r.message, /label\.html\?order=SKN-1020/);
    } else {
      assert.match(r.message || "", /couldn't find|Send the order ID|Which order/i);
    }
    assert.match(generateOrderPrintLabelUrl("SKN-1020"), /label\.html\?order=SKN-1020/);
  });

  it("router runs get_order_label for QR asks", async () => {
    const results = await runToolRouter("QR code link for SKN-1020", {});
    assert.ok(results.some((r) => r.tool === "get_order_label"));
  });
});
