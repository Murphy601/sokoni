import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractMpesaDisplayName,
  namesLikelyMatch,
  normalizePersonName,
} from "./mpesa-name-match.js";

describe("mpesa-name-match", () => {
  it("extracts name after phone dash", () => {
    assert.equal(
      extractMpesaDisplayName("254712345678 - JOHN KAMAU"),
      "JOHN KAMAU"
    );
  });

  it("matches overlapping names", () => {
    const r = namesLikelyMatch("John Kamau Mwangi", "JOHN KAMAU");
    assert.equal(r.match, true);
  });

  it("flags clear mismatch", () => {
    const r = namesLikelyMatch("John Kamau", "MARY WANJIKU");
    assert.equal(r.match, false);
    assert.equal(normalizePersonName("Mr. John  Kamau"), "JOHN KAMAU");
  });
});
