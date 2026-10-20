import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadKnowledgeDocs } from "./agent-specialists.js";
import { WHATSAPP_SYSTEM_PROMPT, WEB_SYSTEM_PROMPT, SOKONI_MVP_LOGISTICS_FACTS } from "./ai-prompts.js";
import { executeTool } from "./ai-tools.js";
import {
  BASE_FEE_KES,
  PER_KM_KES,
  MAX_FEE_KES,
  INCLUDED_KM,
} from "../lib/rider-distance-fee.js";
import { RIDER_B2C_MIN_FLOOR_KES, RIDER_B2C_DAILY_CAP_KES } from "../lib/rider-b2c-guards.js";

const doc = (name) => readFileSync(new URL(`../../knowledge/${name}`, import.meta.url), "utf8");

describe("the new docs actually load", () => {
  // The loader is an allowlist, not a glob: a doc that is not registered is
  // invisible to the agent no matter what it says.
  const ids = loadKnowledgeDocs({ specialist: "general" }).map((d) => d.id);

  for (const name of ["delivery-pricing.md", "rider-earnings.md", "location-pins.md"]) {
    it(`${name} is registered and non-empty`, () => {
      assert.ok(ids.includes(name), `${name} is not in KNOWLEDGE_FILES`);
      assert.ok(doc(name).trim().length > 200);
    });
  }

  it("reaches the lanes that need it", () => {
    const seller = loadKnowledgeDocs({ specialist: "seller" }).map((d) => d.id);
    const logistics = loadKnowledgeDocs({ specialist: "logistics" }).map((d) => d.id);
    const buyer = loadKnowledgeDocs({ specialist: "buyer" }).map((d) => d.id);
    assert.ok(seller.includes("delivery-pricing.md"));
    assert.ok(logistics.includes("rider-earnings.md"));
    assert.ok(buyer.includes("delivery-pricing.md"));
  });
});

describe("the docs match the code, not a memory of it", () => {
  const pricing = doc("delivery-pricing.md");

  it("quotes the live tariff numbers", () => {
    for (const n of [BASE_FEE_KES, PER_KM_KES, MAX_FEE_KES]) {
      assert.ok(
        pricing.includes(n.toLocaleString("en-US")) || pricing.includes(String(n)),
        `delivery-pricing.md does not mention ${n} — the tariff changed and the doc did not`
      );
    }
    assert.ok(pricing.includes(`${INCLUDED_KM} road km`) || pricing.includes(`first ${INCLUDED_KM}`));
  });

  it("quotes the live payout guardrails", () => {
    const earnings = doc("rider-earnings.md");
    assert.ok(earnings.includes(String(RIDER_B2C_MIN_FLOOR_KES)));
    assert.ok(earnings.includes(RIDER_B2C_DAILY_CAP_KES.toLocaleString("en-US")));
  });

  it("carries no stale price anywhere in the knowledge base", () => {
    // 350 was the old floor and 1,200 the old cap. Either still being quoted
    // means a doc was missed.
    for (const name of ["delivery-pricing.md", "shipping-sop.md", "location-pins.md"]) {
      assert.doesNotMatch(doc(name), /KES 350\b/, `${name} still quotes the old KES 350 floor`);
      assert.doesNotMatch(doc(name), /KES 1,200\b/, `${name} still quotes the old KES 1,200 cap`);
    }
  });
});

describe("the shipping tool stopped telling sellers they set local prices", () => {
  it("scopes seller rates to upcountry", async () => {
    const r = await executeTool("get_shipping_rates", {}, {});
    assert.match(r.scope, /upcountry/i);
    assert.equal(r.localRiderPricing.setBy, "Sokoni");
  });

  it("reads the tariff from the source, so it cannot drift", async () => {
    const r = await executeTool("get_shipping_rates", {}, {});
    assert.equal(r.localRiderPricing.baseKes, BASE_FEE_KES);
    assert.equal(r.localRiderPricing.perKmKes, PER_KM_KES);
    assert.equal(r.localRiderPricing.maxKes, MAX_FEE_KES);
  });

  it("no longer offers the old flat examples", async () => {
    const blob = JSON.stringify(await executeTool("get_shipping_rates", {}, {}));
    assert.doesNotMatch(blob, /Nairobi \/ local = KES 300/);
    assert.doesNotMatch(blob, /Upcountry Kenya = KES 500/);
  });

  it("tells the agent not to compute a fee", async () => {
    const r = await executeTool("get_shipping_rates", {}, {});
    assert.match(r.localRiderPricing.neverQuote, /never/i);
  });
});

describe("the prompts carry the rules that stop bad answers", () => {
  for (const [name, prompt] of [["whatsapp", WHATSAPP_SYSTEM_PROMPT], ["web", WEB_SYSTEM_PROMPT]]) {
    it(`${name}: refuses to invent a delivery fee`, () => {
      assert.match(prompt, /NEVER WORK OUT A DELIVERY FEE/);
      assert.match(prompt, /UPCOUNTRY orders only/i);
    });

    it(`${name}: knows riders are paid automatically`, () => {
      assert.match(prompt, /RIDERS DO NOT WITHDRAW/);
    });

    it(`${name}: can explain how to send a pin`, () => {
      assert.match(prompt, /A PIN IS A COORDINATE/);
      assert.match(prompt, /Send your current location/i);
    });
  }

  it("the logistics facts explain the two-proof CONFIRM", () => {
    assert.match(SOKONI_MVP_LOGISTICS_FACTS, /200m/);
    assert.match(SOKONI_MVP_LOGISTICS_FACTS, /Drop-off GPS is not on file/);
  });

  it("the logistics facts offer the chat rider application first", () => {
    assert.match(SOKONI_MVP_LOGISTICS_FACTS, /\*ride\*/);
  });
});
