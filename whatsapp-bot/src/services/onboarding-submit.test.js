import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSubmitWord } from "../lib/confirm-words.js";
import { missingRequired } from "./rider-onboarding.js";

const RIDER = readFileSync(new URL("./rider-onboarding.js", import.meta.url), "utf8");
const SELLER = readFileSync(new URL("./seller-onboarding.js", import.meta.url), "utf8");

describe("confirm vocabulary", () => {
  for (const t of ["submit", "SUBMIT", " confirm ", "Confirm", "send", "yes", "ndio", "sawa", "ok", "okay"]) {
    it(`accepts "${t}"`, () => assert.equal(isSubmitWord(t), true));
  }
  for (const t of ["restart", "cancel", "menu", "submit my form", "no", ""]) {
    it(`rejects "${t}"`, () => assert.equal(isSubmitWord(t), false));
  }
  it("is the same word list for both flows", () => {
    // The bug: rider matched only /submit/, seller only /confirm/, so the
    // other word silently reprinted the summary.
    assert.ok(RIDER.includes("isSubmitWord(t)") && SELLER.includes("isSubmitWord(t)"));
    assert.doesNotMatch(RIDER, /\^\s\*submit\s\*\$/, "rider still has its own narrow matcher");
    assert.doesNotMatch(SELLER, /\^\s\*confirm\s\*\$/, "seller still has its own narrow matcher");
  });
});

describe("rider preflight", () => {
  const complete = {
    phone: "254700000001", fullName: "Peter Kamau", nationalId: "12345678",
    operatingTown: "NAIROBI", stageLocation: "Kenyatta Market stage",
    motorbikePlate: "KMGB 123X",
    nationalIdFrontUrl: "https://bot.sokonimall.com/assets/boda-docs/a.jpg",
    licenseUrl: "https://bot.sokonimall.com/assets/boda-docs/b.jpg",
    stageLetterUrl: "https://bot.sokonimall.com/assets/boda-docs/c.jpg",
  };

  it("passes a complete application", () => assert.deepEqual(missingRequired(complete), []));
  it("names an empty draft's gaps in the applicant's own words", () => {
    const out = missingRequired({});
    assert.ok(out.includes("National ID photo") && out.includes("stage chairman letter"));
  });
  it("catches a single missing document", () => {
    assert.deepEqual(missingRequired({ ...complete, licenseUrl: "" }), ["licence photo"]);
  });
  it("treats whitespace as missing", () => {
    assert.deepEqual(missingRequired({ ...complete, motorbikePlate: "   " }), ["number plate"]);
  });
});

describe("submit can no longer fail silently", () => {
  it("rider wraps registerRiderApplication in try/catch", () => {
    const branch = RIDER.slice(RIDER.indexOf("case RIDER_STEPS.CONFIRM: {"));
    const call = branch.indexOf("registerRiderApplication({");
    const tryAt = branch.indexOf("try {");
    assert.ok(tryAt !== -1 && tryAt < call, "register call is not inside a try");
    assert.match(branch.slice(0, call + 600), /catch \(err\)/);
  });

  it("rider keeps the draft when submit throws, so 14 steps are not lost", () => {
    const branch = RIDER.slice(RIDER.indexOf("case RIDER_STEPS.CONFIRM: {"));
    const cat = branch.indexOf("catch (err)");
    const afterCatch = branch.slice(cat, branch.indexOf("if (result?.error)"));
    assert.doesNotMatch(afterCatch, /clearFlow/, "draft is cleared on failure");
  });

  it("seller wraps onboardSeller in try/catch", () => {
    const branch = SELLER.slice(SELLER.indexOf("case SELLER_STEPS.CONFIRM: {"));
    const call = branch.indexOf("onboardSeller({");
    const tryAt = branch.indexOf("try {");
    assert.ok(tryAt !== -1 && tryAt < call, "onboardSeller is not inside a try");
  });

  it("both log the real reason for the VM logs", () => {
    assert.match(RIDER, /\[rider-onboarding\] submit threw/);
    assert.match(SELLER, /\[seller-onboarding\] submit threw/);
  });
});
