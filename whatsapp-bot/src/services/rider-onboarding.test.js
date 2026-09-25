import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSellerApplyCommand } from "./seller-onboarding.js";
import {
  RIDER_STEPS,
  RIDER_STEP_COUNT,
  stepNumber,
  promptFor,
  summaryText,
  normalizeTownChoice,
  normalizePlate,
  isRiderApplyCommand,
} from "./rider-onboarding.js";

describe("RIDER APPLY entry command", () => {
  for (const t of [
    "RIDER APPLY",
    "rider apply",
    "  Rider Apply  ",
    "boda apply",
    "apply rider",
    // The single words applicants actually send. "ride" is the label on the
    // site's Buy/Sell/Ride toggle and used to fall straight through to the AI.
    "ride",
    "RIDE",
    "rider",
    "boda",
    "bodaboda",
    "boda boda",
    "rider signup",
    "rider sign up",
    "apply as a rider",
    "become a rider",
    "start riding",
    "ride for sokoni",
    "deliver for sokoni",
  ]) {
    it(`starts the flow: "${t}"`, () => assert.equal(isRiderApplyCommand(t), true));
  }

  for (const t of [
    // Free text stays with the AI, which points at the flow.
    "how do i become a rider",
    "rider apply online please tell me more",
    // Must not swallow the fleet commands a working rider sends.
    "ACCEPT SKN-1042",
    "DECLINE SKN-1042",
    "AVAILABLE",
    "OFFLINE",
    "SET ZONE THIKA",
    "CONFIRM SKN-1042 7391",
    // Buyers asking after their delivery.
    "where is my rider",
    "has the rider left yet",
    "",
  ]) {
    it(`does not start the flow: "${t}"`, () => assert.equal(isRiderApplyCommand(t), false));
  }

  it("matches the seller trigger's breadth on the bare role word", () => {
    // The asymmetry that broke this: "sell" worked, "ride" did not.
    assert.equal(isRiderApplyCommand("ride"), isSellerApplyCommand("sell"));
  });
});

describe("town choice", () => {
  it("accepts numbers and names", () => {
    assert.equal(normalizeTownChoice("1"), "NAIROBI");
    assert.equal(normalizeTownChoice("2"), "THIKA");
    assert.equal(normalizeTownChoice("Nairobi"), "NAIROBI");
    assert.equal(normalizeTownChoice("  thika "), "THIKA");
  });

  it("rejects zones that are not live", () => {
    for (const t of ["Mombasa", "3", "Kisumu", ""]) {
      assert.equal(normalizeTownChoice(t), null, t);
    }
  });
});

describe("plate normalisation", () => {
  it("uppercases and collapses spacing", () => {
    assert.equal(normalizePlate("  kmgb   123x "), "KMGB 123X");
  });
  it("caps length to the column width", () => {
    assert.ok(normalizePlate("x".repeat(80)).length <= 32);
  });
});

describe("every step has a prompt", () => {
  const steps = Object.values(RIDER_STEPS);

  it("covers all declared steps", () => {
    assert.equal(steps.length, RIDER_STEP_COUNT);
  });

  for (const step of steps) {
    it(`prompts for "${step}"`, () => {
      const out = promptFor(step, { phone: "254700000001", extraIndex: 0 });
      assert.ok(typeof out === "string" && out.trim().length > 10, `empty prompt for ${step}`);
    });
  }

  it("numbers steps 1..N in order", () => {
    assert.equal(stepNumber(RIDER_STEPS.PHONE), 1);
    assert.equal(stepNumber(RIDER_STEPS.CONFIRM), RIDER_STEP_COUNT);
  });

  it("asks for every field the web form requires", () => {
    const all = Object.values(RIDER_STEPS)
      .map((s) => promptFor(s, { phone: "254700000001", extraIndex: 0 }))
      .join("\n")
      .toLowerCase();
    for (const need of [
      "full name",
      "national id",
      "nairobi",
      "thika",
      "stage",
      "plate",
      "licence",
      "guarantor",
    ]) {
      assert.ok(all.includes(need), `flow never asks for: ${need}`);
    }
  });

  it("marks the three required documents as required", () => {
    for (const step of [RIDER_STEPS.DOC_ID_FRONT, RIDER_STEPS.DOC_LICENCE, RIDER_STEPS.DOC_STAGE_LETTER]) {
      assert.match(promptFor(step, {}), /required/i, step);
    }
  });

  it("marks optional documents as skippable", () => {
    assert.match(promptFor(RIDER_STEPS.DOC_ID_BACK, {}), /skip/i);
  });
});

describe("confirmation summary", () => {
  const full = {
    fullName: "Peter Kamau",
    phone: "254700000001",
    nationalId: "12345678",
    operatingTown: "NAIROBI",
    stageLocation: "Kenyatta Market stage",
    motorbikePlate: "KMGB 123X",
    guarantorName: "John Mwangi",
    nationalIdFrontUrl: "https://bot.sokonimall.com/assets/boda-docs/idDocument-wa-1.jpg",
    licenseUrl: "https://bot.sokonimall.com/assets/boda-docs/dlDocument-wa-1.jpg",
    stageLetterUrl: "https://bot.sokonimall.com/assets/boda-docs/stageLetter-wa-1.jpg",
  };

  it("shows every captured value back before submitting", () => {
    const out = summaryText(full);
    for (const v of ["Peter Kamau", "254700000001", "12345678", "NAIROBI", "KMGB 123X", "John Mwangi"]) {
      assert.ok(out.includes(v), `summary missing ${v}`);
    }
  });

  it("ticks supplied documents and flags missing required ones", () => {
    assert.match(summaryText(full), /ID front ✅/);
    assert.match(summaryText({ ...full, licenseUrl: "" }), /Licence ❌/);
  });

  it("offers submit, restart and cancel", () => {
    const out = summaryText(full);
    for (const word of ["submit", "restart", "cancel"]) {
      assert.match(out, new RegExp(word, "i"));
    }
  });

  it("renders with an empty draft rather than throwing", () => {
    assert.ok(summaryText({}).includes("—"));
  });
});
