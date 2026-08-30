import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shopHandleLookupKeys,
  shopHandlesMatch,
  parseHandleAndOptionalScore,
  stripHandleAt,
} from "./shop-handle.js";
import {
  isOverrideCommand,
  normalizeMasterCommand,
  softMapSpokenToMasterCommand,
} from "../services/admin-override.js";

describe("shop-handle parse (multi-word + apostrophe)", () => {
  it("builds lookup keys so Adiv's thrift ≈ adiv_thrift", () => {
    const keys = shopHandleLookupKeys("@Adiv's thrift");
    assert.ok(keys.includes("adiv_thrift") || keys.includes("adivs_thrift"));
    assert.ok(keys.some((k) => k.includes("adiv")));
    assert.equal(shopHandlesMatch("@Adiv's thrift", "adiv_thrift"), true);
    assert.equal(shopHandlesMatch("Adiv's thrift", "@adiv_thrift"), true);
    assert.equal(shopHandlesMatch("nairobi_kicks", "coast_thrift"), false);
  });

  it("parses handle + optional score", () => {
    assert.deepEqual(parseHandleAndOptionalScore("@Adiv's thrift 4.8"), {
      handle: "Adiv's thrift",
      score: 4.8,
    });
    assert.deepEqual(parseHandleAndOptionalScore("@Adiv's thrift"), {
      handle: "Adiv's thrift",
      score: null,
    });
    assert.deepEqual(parseHandleAndOptionalScore("adiv_thrift 4.8"), {
      handle: "adiv_thrift",
      score: 4.8,
    });
    assert.equal(stripHandleAt("@Adiv's thrift"), "Adiv's thrift");
  });
});

describe("Boss VERIFY SHOP / SET RATINGS commands", () => {
  it("detects SET RATINGS plural and VERIFY with multi-word handle", () => {
    assert.equal(isOverrideCommand("Verify shop @Adiv's thrift"), true);
    assert.equal(isOverrideCommand("Set ratings @Adiv's thrift"), true);
    assert.equal(isOverrideCommand("Set rating @Adiv's thrift 4.8"), true);
  });

  it("normalizes multi-word VERIFY SHOP without truncating at space", () => {
    assert.equal(
      normalizeMasterCommand("Verify shop @Adiv's thrift"),
      "VERIFY_SHOP Adiv's thrift"
    );
    assert.equal(
      normalizeMasterCommand("VERIFY SHOP @nairobi_kicks"),
      "VERIFY_SHOP nairobi_kicks"
    );
  });

  it("normalizes SET RATINGS with score; missing score stays on interceptor path", () => {
    assert.equal(
      normalizeMasterCommand("Set ratings @Adiv's thrift 4.8"),
      "SET_RATING Adiv's thrift 4.8"
    );
    assert.equal(
      normalizeMasterCommand("SET RATING @Adiv's thrift 4.8"),
      "SET_RATING Adiv's thrift 4.8"
    );
    // No score → still SET_RATING (executor prompts) — never fall through to product search
    assert.equal(
      normalizeMasterCommand("Set ratings @Adiv's thrift"),
      "SET_RATING Adiv's thrift"
    );
    assert.equal(
      softMapSpokenToMasterCommand("Set ratings @Adiv's thrift"),
      "SET_RATING Adiv's thrift"
    );
  });
});
