import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizePin, isInKenya, pinLink, pinReason, PIN_HOW_TO } from "./location-pin.js";

describe("accepting a pin", () => {
  it("reads WhatsApp's own location shapes", () => {
    for (const raw of [
      { latitude: -1.2864, longitude: 36.8172 },
      { lat: -1.2864, lng: 36.8172 },
      { degreesLatitude: -1.2864, degreesLongitude: 36.8172 },
    ]) {
      assert.deepEqual(normalizePin(raw), { lat: -1.2864, lng: 36.8172 });
    }
  });

  it("reads a lat,lng string from a web picker", () => {
    assert.deepEqual(normalizePin("-1.2864, 36.8172"), { lat: -1.2864, lng: 36.8172 });
    assert.deepEqual(normalizePin("-1.2864,36.8172"), { lat: -1.2864, lng: 36.8172 });
  });

  it("rounds to 6dp, which is already finer than a phone can justify", () => {
    assert.deepEqual(normalizePin({ lat: -1.28641234567, lng: 36.81729876543 }), {
      lat: -1.286412,
      lng: 36.817299,
    });
  });
});

describe("rejecting a pin", () => {
  it("refuses 0,0 — the classic missing-fix value", () => {
    assert.equal(normalizePin({ lat: 0, lng: 0 }), null);
  });

  it("refuses lat and lng swapped", () => {
    // Nairobi reversed lands in the Indian Ocean off Somalia.
    assert.equal(normalizePin({ lat: 36.8172, lng: -1.2864 }), null);
  });

  it("refuses pins outside Kenya", () => {
    for (const [lat, lng] of [[51.5, -0.12], [40.7, -74.0], [-33.9, 18.4], [9.0, 38.7]]) {
      assert.equal(normalizePin({ lat, lng }), null, `${lat},${lng}`);
    }
  });

  it("refuses rubbish rather than guessing", () => {
    for (const raw of [null, undefined, "", "somewhere", {}, 42, [], { lat: "x", lng: "y" }, "1,2,3"]) {
      assert.equal(normalizePin(raw), null, JSON.stringify(raw));
    }
  });

  it("accepts the far corners of the country", () => {
    for (const [lat, lng] of [[-4.6, 39.6], [4.6, 34.5], [-1.29, 36.82], [0.5, 41.0]]) {
      assert.ok(isInKenya(lat, lng), `${lat},${lng} should be in Kenya`);
    }
  });
});

describe("what we show people", () => {
  it("builds a maps link ops can open", () => {
    assert.equal(pinLink({ lat: -1.2864, lng: 36.8172 }), "https://maps.google.com/?q=-1.2864,36.8172");
    assert.equal(pinLink(null), "");
  });

  it("says why each role is being asked", () => {
    for (const role of ["seller", "rider", "buyer"]) {
      assert.ok(pinReason(role).length > 20, `no reason given to a ${role}`);
    }
    assert.equal(pinReason("nobody"), "");
  });

  it("tells people which buttons to press", () => {
    assert.match(PIN_HOW_TO, /Attach/i);
    assert.match(PIN_HOW_TO, /Location/i);
  });
});
