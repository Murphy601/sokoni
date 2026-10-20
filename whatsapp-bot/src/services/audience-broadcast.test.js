import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatAudienceMessage,
  normalizeAudience,
  AUDIENCE_PREFIXES,
} from "./audience-broadcast.js";
import { isOverrideCommand, normalizeMasterCommand } from "./admin-override.js";
import { looksLikeAdminProbe } from "./boss-intercept.js";

describe("audience broadcast formatting", () => {
  it("normalizes audience aliases", () => {
    assert.equal(normalizeAudience("SELLERS"), "sellers");
    assert.equal(normalizeAudience("seller"), "sellers");
    assert.equal(normalizeAudience("RIDERS"), "riders");
    assert.equal(normalizeAudience("BUYERS"), "buyers");
    assert.equal(normalizeAudience("customers"), "buyers");
    assert.equal(normalizeAudience("ops"), null);
  });

  it("applies fixed prefixes from the ops table", () => {
    assert.equal(
      formatAudienceMessage(
        "sellers",
        "System maintenance at 2 AM tonight. Finish order dispatches."
      ),
      "🛍️ Notice to Sellers: System maintenance at 2 AM tonight. Finish order dispatches."
    );
    assert.equal(
      formatAudienceMessage(
        "riders",
        "Rush hour bonus active! Earn +KES 100 per delivery in Westlands."
      ),
      "🛵 Rider Bonus: Rush hour bonus active! Earn +KES 100 per delivery in Westlands."
    );
    assert.equal(
      formatAudienceMessage("buyers", "Flash sale active! Use code SOKONI50 for KES 50 cashback."),
      "🛒 Sokoni Deal: Flash sale active! Use code SOKONI50 for KES 50 cashback."
    );
  });

  it("does not double-prefix", () => {
    const once = formatAudienceMessage("sellers", "Hello");
    assert.equal(formatAudienceMessage("sellers", once), once);
    assert.ok(once.startsWith(AUDIENCE_PREFIXES.sellers));
  });
});

describe("audience broadcast commands", () => {
  it("detects BROADCAST audience verbs", () => {
    assert.equal(isOverrideCommand("BROADCAST SELLERS: hello"), true);
    assert.equal(isOverrideCommand("BROADCAST RIDERS: bonus"), true);
    assert.equal(isOverrideCommand("BROADCAST BUYERS: deal"), true);
    assert.equal(looksLikeAdminProbe("BROADCAST SELLERS: hello"), true);
  });

  it("normalizes BROADCAST commands", () => {
    assert.equal(
      normalizeMasterCommand(
        "BROADCAST SELLERS: System maintenance at 2 AM tonight. Finish order dispatches."
      ),
      "BROADCAST_SELLERS System maintenance at 2 AM tonight. Finish order dispatches."
    );
    assert.equal(
      normalizeMasterCommand(
        "BROADCAST RIDERS: Rush hour bonus active! Earn +KES 100 per delivery in Westlands."
      ),
      "BROADCAST_RIDERS Rush hour bonus active! Earn +KES 100 per delivery in Westlands."
    );
    assert.equal(
      normalizeMasterCommand(
        "BROADCAST BUYERS: Flash sale active! Use code SOKONI50 for KES 50 cashback."
      ),
      "BROADCAST_BUYERS Flash sale active! Use code SOKONI50 for KES 50 cashback."
    );
  });
});
