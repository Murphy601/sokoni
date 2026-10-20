/**
 * The last step of rider registration.
 *
 * `normalizePin` was used in three places in boda-fleet.js and imported in
 * none. Every applicant filled in fourteen steps, replied *submit*, and got
 * "Couldn't reach Sokoni ops just now" -- because a ReferenceError only fires
 * when its line runs, and that line ran only on the final step.
 *
 * Nothing caught it: the module imports fine, the unit tests never reached
 * that path, and `npm run lint` had no config so it errored out silently.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as bodaFleet from "./boda-fleet.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const FLEET = src("./boda-fleet.js");
const RIDER = src("./rider-onboarding.js");

describe("the submit path has what it needs", () => {
  it("imports normalizePin where it uses it", () => {
    assert.match(FLEET, /import \{ normalizePin \} from "\.\.\/lib\/location-pin\.js"/);
  });

  it("leaves nothing else in this file undeclared", () => {
    // Everything called at module scope or inside the submit path has to come
    // from an import, a local declaration, or a runtime global.
    const imported = new Set();
    for (const m of FLEET.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
      for (const name of m[1].split(",")) {
        imported.add(name.trim().split(/\s+as\s+/).pop().trim());
      }
    }
    for (const m of FLEET.matchAll(/import\s+(\w+)\s+from/g)) imported.add(m[1]);

    const declared = new Set();
    for (const m of FLEET.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)) {
      declared.add(m[1]);
    }
    for (const m of FLEET.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)/g)) {
      declared.add(m[1]);
    }

    // Helpers the submit path calls by name. Each one has to resolve.
    const used = ["normalizePin", "normalizeRiderPhone", "normalizeBodaZone", "mapRider", "query"];
    for (const name of used) {
      assert.ok(
        imported.has(name) || declared.has(name),
        `${name} is called but neither imported nor declared`
      );
    }
  });

  it("still exports what the WhatsApp flow imports from it", () => {
    // rider-onboarding pulls this in dynamically, so a rename would only show
    // up at submit time.
    assert.match(RIDER, /const \{ registerRiderApplication \} = await import\("\.\/boda-fleet\.js"\)/);
    assert.equal(typeof bodaFleet.registerRiderApplication, "function");
    assert.equal(typeof bodaFleet.upsertRiderProfile, "function");
  });
});

describe("a pin is optional, never fatal", () => {
  it("treats a missing pin as no pin", async () => {
    const { normalizePin } = await import("../lib/location-pin.js");
    for (const input of [null, undefined, {}, { lat: null, lng: null }]) {
      assert.equal(normalizePin(input), null, JSON.stringify(input));
    }
  });

  it("keeps a real Kenyan pin", async () => {
    const { normalizePin } = await import("../lib/location-pin.js");
    const pin = normalizePin({ lat: -1.286389, lng: 36.817223 });
    assert.ok(pin);
    assert.equal(pin.lat, -1.286389);
  });
});
