import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deactivatedLoginBlock } from "./seller-verification.js";

describe("deactivated seller login block", () => {
  it("returns account_deactivated with support email", () => {
    const block = deactivatedLoginBlock();
    assert.equal(block.error, "account_deactivated");
    assert.equal(block.shopStatus, "deactivated");
    assert.match(block.supportEmail, /@/);
    assert.match(block.message, /Account deactivated/i);
    assert.match(block.message, /Contact support for more information/i);
    assert.ok(block.message.includes(block.supportEmail));
  });
});
