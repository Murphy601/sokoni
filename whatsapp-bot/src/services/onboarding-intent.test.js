import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRiderOnboardingIntent, executeTool } from "./ai-tools.js";
import { WHATSAPP_SYSTEM_PROMPT, WEB_SYSTEM_PROMPT } from "./ai-prompts.js";

describe("rider onboarding intent", () => {
  it("catches the phrasing that actually loops today", () => {
    // Verbatim from the WhatsApp thread that deflected to our own number.
    assert.equal(
      isRiderOnboardingIntent(
        "Hi I would like to apply to become a sokoni rider, please let me know what I need to do next"
      ),
      true
    );
  });

  for (const t of [
    "how do i become a rider",
    "I want to join the rider program",
    "can i apply to be a boda rider",
    "rider application",
    "how can i register as a courier",
    "I'm interested in becoming a delivery partner",
    "nataka kuwa rider",
    "I want to deliver for sokoni",
    "sign up as a boda boda",
  ]) {
    it(`treats as rider signup: "${t}"`, () => {
      assert.equal(isRiderOnboardingIntent(t), true);
    });
  }

  for (const t of [
    "ACCEPT SKN-1042",
    "PICKUP SKN-1042 4821",
    "CONFIRM SKN-1042 7391",
    "where is my rider",
    "has the rider left yet",
    "do you have sneakers size 42",
    "track SKN-1002",
  ]) {
    it(`does not treat as rider signup: "${t}"`, () => {
      assert.equal(isRiderOnboardingIntent(t), false);
    });
  }
});

describe("get_rider_onboarding tool", () => {
  it("returns the real apply URL, not a support number", async () => {
    const r = await executeTool("get_rider_onboarding", {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.applyUrl, "https://sokonimall.com/boda/apply.html");
    assert.ok(r.steps.length >= 4);
    const blob = JSON.stringify(r);
    assert.doesNotMatch(blob, /wa\.me/i, "must not hand out a wa.me link");
    assert.doesNotMatch(blob, /254\s?117\s?422\s?428/, "must not hand out the bot's own number");
  });

  it("names the documents an applicant has to bring", async () => {
    const blob = JSON.stringify(await executeTool("get_rider_onboarding", {}, {}));
    for (const need of [/national id/i, /licence/i, /stage/i, /plate/i]) {
      assert.match(blob, need);
    }
  });

  it("states the live operating zones", async () => {
    const r = await executeTool("get_rider_onboarding", {}, {});
    assert.deepEqual(r.zones, ["NAIROBI", "THIKA"]);
  });
});

describe("seller onboarding tool", () => {
  it("points at the Seller Hub", async () => {
    const r = await executeTool("get_seller_onboarding", {}, {});
    assert.equal(r.ok, true);
    assert.match(r.sellerHub, /suppliers\/list\.html$/);
    const blob = JSON.stringify(r);
    assert.doesNotMatch(blob, /wa\.me/i);
    assert.doesNotMatch(blob, /254\s?117\s?422\s?428/);
  });
});

describe("prompt guards against the support loop", () => {
  for (const [name, prompt] of [
    ["whatsapp", WHATSAPP_SYSTEM_PROMPT],
    ["web", WEB_SYSTEM_PROMPT],
  ]) {
    it(`${name} prompt forbids looping back to this number`, () => {
      assert.match(prompt, /NEVER LOOP THE USER BACK TO THIS NUMBER/);
      assert.match(prompt, /wa\.me\/254117422428/, "names the exact link to refuse");
    });

    it(`${name} prompt routes signups to the forms`, () => {
      assert.match(prompt, /boda\/apply\.html/);
      assert.match(prompt, /suppliers\/list\.html/);
    });
  }
});
