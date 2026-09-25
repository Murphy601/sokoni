import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SELLER_STEPS,
  SELLER_STEP_COUNT,
  stepNumber,
  promptFor,
  summaryText,
  normalizeHandle,
  handleFromShopName,
  isSellerApplyCommand,
} from "./seller-onboarding.js";

describe("SELL entry command", () => {
  for (const t of [
    "SELL",
    "sell",
    "start selling",
    "become a seller",
    "seller apply",
    "sell on sokoni",
    "vendor menu",
  ]) {
    it(`starts the flow: "${t}"`, () => assert.equal(isSellerApplyCommand(t), true));
  }

  for (const t of [
    "how do i become a seller",
    "i want to sell my phone",
    "sell me something",
    "",
  ]) {
    it(`does not start the flow: "${t}"`, () => assert.equal(isSellerApplyCommand(t), false));
  }
});

describe("handle normalisation", () => {
  it("strips @ and lowercases", () => {
    assert.equal(normalizeHandle("@Adiv_Thrift"), "adiv_thrift");
  });

  it("collapses punctuation and spaces to underscores", () => {
    assert.equal(normalizeHandle("Beauty  Collections!"), "beauty_collections");
  });

  it("trims leading and trailing underscores", () => {
    assert.equal(normalizeHandle("__shop__"), "shop");
  });

  it("caps length", () => {
    assert.ok(normalizeHandle("a".repeat(80)).length <= 30);
  });

  it("falls back rather than returning empty", () => {
    assert.equal(handleFromShopName("!!!"), "shop");
    assert.equal(handleFromShopName(""), "shop");
  });

  it("derives a usable handle from a shop name", () => {
    assert.equal(handleFromShopName("Mama Njeri Kitenge"), "mama_njeri_kitenge");
  });
});

describe("every step has a prompt", () => {
  const steps = Object.values(SELLER_STEPS);

  it("covers all declared steps", () => {
    assert.equal(steps.length, SELLER_STEP_COUNT);
  });

  for (const step of steps) {
    it(`prompts for "${step}"`, () => {
      const out = promptFor(step, { phone: "254700000001", shopName: "Test Shop", shopHandle: "test_shop" });
      assert.ok(typeof out === "string" && out.trim().length > 10, `empty prompt for ${step}`);
    });
  }

  it("numbers steps 1..N", () => {
    assert.equal(stepNumber(SELLER_STEPS.SHOP_NAME), 1);
    assert.equal(stepNumber(SELLER_STEPS.CONFIRM), SELLER_STEP_COUNT);
  });

  it("asks only for what onboardSeller needs", () => {
    const all = Object.values(SELLER_STEPS)
      .map((s) => promptFor(s, { phone: "254700000001", shopName: "Test Shop", shopHandle: "test_shop" }))
      .join("\n")
      .toLowerCase();
    for (const need of ["shop", "handle", "m-pesa", "national id"]) {
      assert.ok(all.includes(need), `flow never asks for: ${need}`);
    }
    // KRA PIN was removed from seller onboarding in #288 — must not come back.
    assert.ok(!all.includes("kra"), "flow must not ask for a KRA PIN");
    // The old supplier-programme questions must not reappear.
    for (const gone of ["delivery area", "contact person", "email address"]) {
      assert.ok(!all.includes(gone), `retired supplier question resurfaced: ${gone}`);
    }
  });

  it("marks the National ID step optional", () => {
    assert.match(promptFor(SELLER_STEPS.NATIONAL_ID, {}), /skip/i);
  });

  it("shows the shop link the handle will produce", () => {
    assert.match(promptFor(SELLER_STEPS.HANDLE, { shopName: "Test Shop" }), /shop\.html\?handle=test_shop/);
  });
});

describe("confirmation summary", () => {
  const draft = {
    shopName: "Mama Njeri Kitenge",
    shopHandle: "mama_njeri_kitenge",
    mpesaNumber: "254700000001",
    nationalId: "12345678",
  };

  it("shows every value back before creating the shop", () => {
    const out = summaryText(draft);
    for (const v of ["Mama Njeri Kitenge", "@mama_njeri_kitenge", "254700000001"]) {
      assert.ok(out.includes(v), `summary missing ${v}`);
    }
  });

  it("never echoes the raw National ID", () => {
    assert.ok(!summaryText(draft).includes("12345678"), "ID must not be echoed back in chat");
    assert.match(summaryText(draft), /provided/i);
  });

  it("says skipped when no ID was given", () => {
    assert.match(summaryText({ ...draft, nationalId: "" }), /skipped/i);
  });

  it("offers confirm, restart and cancel", () => {
    const out = summaryText(draft);
    for (const w of ["confirm", "restart", "cancel"]) {
      assert.match(out, new RegExp(w, "i"));
    }
  });

  it("renders an empty draft rather than throwing", () => {
    assert.ok(summaryText({}).includes("—"));
  });
});
