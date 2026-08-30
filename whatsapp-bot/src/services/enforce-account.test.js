import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOverrideCommand,
  normalizeMasterCommand,
} from "./admin-override.js";
import { looksLikeAdminProbe } from "./boss-intercept.js";

describe("admin enforce cascade commands", () => {
  it("detects PAUSE / UNPAUSE / SUSPEND / UNBAN seller & rider verbs", () => {
    assert.equal(isOverrideCommand("PAUSE SELLER @nairobi_kicks"), true);
    assert.equal(isOverrideCommand("UNPAUSE SELLER @nairobi_kicks"), true);
    assert.equal(isOverrideCommand("SUSPEND SELLER @nairobi_kicks policy"), true);
    assert.equal(isOverrideCommand("UNBAN SELLER @nairobi_kicks"), true);
    assert.equal(isOverrideCommand("PAUSE RIDER +254712345678"), true);
    assert.equal(isOverrideCommand("UNPAUSE RIDER 254712345678"), true);
    assert.equal(isOverrideCommand("SUSPEND RIDER +254712345678"), true);
    assert.equal(isOverrideCommand("UNBAN RIDER +254712345678"), true);
  });

  it("normalizes seller enforce verbs", () => {
    assert.equal(normalizeMasterCommand("PAUSE SELLER @nairobi_kicks"), "PAUSE_SELLER nairobi_kicks");
    assert.equal(normalizeMasterCommand("UNPAUSE SELLER @nairobi_kicks"), "UNPAUSE_SELLER nairobi_kicks");
    assert.equal(normalizeMasterCommand("UNBAN SELLER @nairobi_kicks"), "UNBAN_SELLER nairobi_kicks");
    assert.equal(
      normalizeMasterCommand("SUSPEND SELLER @nairobi_kicks fraud"),
      "SUSPEND_SELLER nairobi_kicks fraud"
    );
    assert.equal(
      normalizeMasterCommand("SUSPEND SHOP @nairobi_kicks fraud"),
      "SUSPEND_SHOP nairobi_kicks fraud"
    );
  });

  it("normalizes rider enforce verbs", () => {
    assert.equal(normalizeMasterCommand("PAUSE RIDER +254712345678"), "PAUSE_RIDER +254712345678");
    assert.equal(normalizeMasterCommand("UNPAUSE RIDER 254712345678"), "UNPAUSE_RIDER 254712345678");
    assert.equal(normalizeMasterCommand("SUSPEND RIDER +2547"), "SUSPEND_RIDER +2547");
    assert.equal(normalizeMasterCommand("!pause-rider +254712345678"), "PAUSE_RIDER +254712345678");
    assert.equal(normalizeMasterCommand("!suspend-seller @shop_x"), "SUSPEND_SELLER @shop_x");
  });

  it("blocks public probes for new enforce verbs", () => {
    assert.equal(looksLikeAdminProbe("PAUSE SELLER @x"), true);
    assert.equal(looksLikeAdminProbe("SUSPEND RIDER +2547"), true);
    assert.equal(looksLikeAdminProbe("UNPAUSE RIDER +2547"), true);
  });
});
