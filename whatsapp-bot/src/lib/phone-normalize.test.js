import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeKenyaPhone,
  phonesMatchKenya,
  isBossPhone,
  checkIfBoss,
  expandKenyaPhoneAliases,
  nationalTail9,
  BOSS_HARDWIRE_TAILS,
  extractBossPhoneFromPayload,
} from "./phone-normalize.js";

describe("Kenya phone normalize / Boss match", () => {
  it("hardwires founder last-9 757764009", () => {
    assert.ok(BOSS_HARDWIRE_TAILS.includes("757764009"));
  });

  it("normalizes 07… and +254… to 254…", () => {
    assert.equal(normalizeKenyaPhone("0757764009"), "254757764009");
    assert.equal(normalizeKenyaPhone("+254757764009"), "254757764009");
    assert.equal(normalizeKenyaPhone("254757764009"), "254757764009");
    assert.equal(normalizeKenyaPhone("757764009"), "254757764009");
  });

  it("checkIfBoss uses endsWith last-9 even with empty config", () => {
    assert.equal(checkIfBoss("254757764009", []), true);
    assert.equal(checkIfBoss("0757764009", []), true);
    assert.equal(checkIfBoss("+254 757 764 009", []), true);
    assert.equal(checkIfBoss("254711000000", []), false);
  });

  it("matches international vs national forms", () => {
    assert.equal(phonesMatchKenya("254757764009", "0757764009"), true);
    assert.equal(phonesMatchKenya("+254 757 764 009", "0757764009"), true);
    assert.equal(phonesMatchKenya("254757764009", "254711111111"), false);
  });

  it("isBossPhone accepts alias list via last-9", () => {
    const bosses = ["254757764009", "0757764009", "+254757764009"];
    assert.equal(isBossPhone("254757764009", bosses), true);
    assert.equal(isBossPhone("0757764009", bosses), true);
    assert.equal(isBossPhone("+254757764009", bosses), true);
    assert.equal(isBossPhone("254711000000", bosses), false);
  });

  it("expandKenyaPhoneAliases includes national + intl", () => {
    const aliases = expandKenyaPhoneAliases("0757764009");
    assert.ok(aliases.includes("254757764009"));
    assert.ok(aliases.some((a) => String(a).includes("0757764009") || a === "0757764009"));
    assert.equal(nationalTail9("254757764009"), "757764009");
  });

  it("extractBossPhoneFromPayload finds hardwired digits in nested WAHA body", () => {
    const phone = extractBossPhoneFromPayload({
      from: "999@lid",
      _data: { senderPn: "254757764009@c.us" },
    });
    assert.equal(phone, "254757764009");
  });
});
