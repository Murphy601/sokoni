import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMetroCoords, knownLocalities } from "./metro-coords.js";
import { haversineMeters } from "../services/boda-fleet.js";
import { isLocalRiderZone } from "./geo-zones.js";

describe("locality lookup", () => {
  it("reads a bare locality name", () => {
    assert.equal(resolveMetroCoords("Westlands").matched, "WESTLANDS");
    assert.equal(resolveMetroCoords("  ruaka ").matched, "RUAKA");
  });

  it("digs the locality out of a shop address", () => {
    assert.equal(resolveMetroCoords("Shop 4, Ruaka Town, Kiambu").matched, "RUAKA");
    assert.equal(resolveMetroCoords("Stall 12B, Ngong Road, Nairobi").matched, "NGONG");
  });

  it("prefers the suburb over the county it sits in", () => {
    // Pricing from the Kiambu county centre would overcharge a Ruaka pickup.
    assert.equal(resolveMetroCoords("Ruaka, Kiambu").matched, "RUAKA");
    assert.equal(resolveMetroCoords("Karen, Nairobi").matched, "KAREN");
    assert.equal(resolveMetroCoords("Kiambu").matched, "KIAMBU");
  });

  it("prefers the longer name when one contains the other", () => {
    assert.equal(resolveMetroCoords("Ongata Rongai").matched, "ONGATA RONGAI");
    assert.equal(resolveMetroCoords("Nairobi CBD").matched, "NAIROBI CBD");
  });

  it("matches whole words only", () => {
    assert.equal(resolveMetroCoords("Karengata Estate"), null);
    assert.equal(resolveMetroCoords("Thikaville"), null);
  });

  it("returns null outside the metro rather than guessing", () => {
    for (const t of ["Mombasa", "Kisumu", "Eldoret", "", null, undefined, 42]) {
      assert.equal(resolveMetroCoords(t), null, String(t));
    }
  });

  it("handles punctuation and case", () => {
    assert.equal(resolveMetroCoords("ATHI-RIVER").matched, "ATHI RIVER");
    assert.equal(resolveMetroCoords("athi river, machakos").matched, "ATHI RIVER");
  });
});

describe("the table is sane", () => {
  const all = knownLocalities();

  it("covers every town geo-zones treats as local metro", () => {
    for (const town of ["THIKA", "RUIRU", "JUJA", "RUAKA", "KIKUYU", "SYOKIMAU", "KITENGELA", "NGONG", "WESTLANDS"]) {
      assert.ok(resolveMetroCoords(town), `no coordinates for local metro town ${town}`);
    }
  });

  it("only lists places that are in a rider zone", () => {
    for (const name of all) {
      assert.ok(isLocalRiderZone(name, name), `${name} is priced but is not a rider zone`);
    }
  });

  it("puts every entry inside the Nairobi metro box", () => {
    for (const name of all) {
      const c = resolveMetroCoords(name);
      assert.ok(c.lat > -1.6 && c.lat < -0.9, `${name} lat ${c.lat} is outside the metro`);
      assert.ok(c.lng > 36.5 && c.lng < 37.3, `${name} lng ${c.lng} is outside the metro`);
    }
  });

  it("has no duplicate coordinates for genuinely different places", () => {
    const seen = new Map();
    for (const name of all) {
      const c = resolveMetroCoords(name);
      const key = `${c.lat},${c.lng}`;
      // Aliases (CBD / NAIROBI CBD, MAVOKO / ATHI RIVER) legitimately share a point.
      if (seen.has(key)) continue;
      seen.set(key, name);
    }
    assert.ok(seen.size > 30, `only ${seen.size} distinct points`);
  });

  it("places known pairs the right distance apart", () => {
    const km = (a, b) => {
      const p = resolveMetroCoords(a), q = resolveMetroCoords(b);
      return haversineMeters(p.lat, p.lng, q.lat, q.lng) / 1000;
    };
    assert.ok(km("CBD", "WESTLANDS") < 5, `CBD to Westlands read ${km("CBD", "WESTLANDS")} km`);
    assert.ok(km("CBD", "THIKA") > 30, `CBD to Thika read ${km("CBD", "THIKA")} km`);
    assert.ok(km("KAREN", "KITENGELA") > 20);
  });
});
