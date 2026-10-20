import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOverrideCommand, normalizeMasterCommand } from "./admin-override.js";
import { looksLikeAdminProbe } from "./boss-intercept.js";

describe("DELETE SELLER / RIDER commands", () => {
  it("detects delete verbs", () => {
    assert.equal(isOverrideCommand("DELETE SELLER @nairobi_kicks CONFIRM"), true);
    assert.equal(isOverrideCommand("DELETE RIDER +254712345678 CONFIRM"), true);
    assert.equal(looksLikeAdminProbe("DELETE SELLER @x CONFIRM"), true);
  });

  it("normalizes with CONFIRM flag", () => {
    assert.equal(
      normalizeMasterCommand("DELETE SELLER @nairobi_kicks CONFIRM"),
      "DELETE_SELLER nairobi_kicks CONFIRM"
    );
    assert.equal(
      normalizeMasterCommand("DELETE SELLER @nairobi_kicks"),
      "DELETE_SELLER nairobi_kicks"
    );
    assert.equal(
      normalizeMasterCommand("DELETE RIDER 254712345678 CONFIRM"),
      "DELETE_RIDER 254712345678 CONFIRM"
    );
  });
});
