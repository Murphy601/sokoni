import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(path.join(__dirname, "app.js"), "utf-8");
const HERO = readFileSync(path.join(__dirname, "hero-engine.js"), "utf-8");

describe("storefront never resurrects peers from static JSON", () => {
  it("app.js returns [] when API ok but empty", () => {
    assert.match(APP, /never resurrect deleted peer shops/);
    assert.match(APP, /if \(apiOk\) \{\s*\n\s*return \[\];/);
  });

  it("hero uses API list even when empty", () => {
    assert.match(HERO, /Empty API list is authoritative/);
    assert.doesNotMatch(HERO, /if \(list\.length\) return list;/);
  });
});
