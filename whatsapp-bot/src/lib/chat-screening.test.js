/**
 * Chat screening.
 *
 * Half these tests are about what must NOT be blocked. Blocking an honest
 * message is not a smaller mistake than missing a bad one -- it is the same
 * mistake aimed at the people who are using the platform properly, and it is
 * the fastest way to teach them that the only way to finish a sentence is to
 * move the conversation off Sokoni.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  screenMessage,
  resolveDigits,
  normalizeWords,
  foldLookalikes,
  blockedMessageFor,
} from "./chat-screening.js";

const blocked = (t) => screenMessage(t).blocked;
const reason = (t) => screenMessage(t).reason;

describe("phone numbers, however they are written", () => {
  const variants = [
    "0712345678",
    "0 7 1 2 3 4 5 6 7 8",
    "0712 345 678",
    "0712-345-678",
    "0712.345.678",
    "+254712345678",
    "254 712 345 678",
    "0112345678",
    "o712345678",
    "zero seven one two three four five six seven eight",
    "sifuri saba moja mbili tatu nne tano sita saba nane",
    "my line is 0712/345/678",
  ];

  for (const v of variants) {
    it(`catches "${v.slice(0, 34)}"`, () => {
      assert.equal(blocked(v), true, v);
      assert.equal(reason(v), "PHONE_NUMBER");
    });
  }

  it("catches one hidden with zero-width characters", () => {
    assert.equal(blocked("07​12​345​678"), true);
  });

  it("catches one written in Cyrillic lookalikes", () => {
    assert.equal(blocked("о712345678"), true);
  });
});

describe("what must still get through", () => {
  const fine = [
    "Is this still available?",
    "What number size is it? I usually wear 38",
    "I'll pay with M-Pesa through Sokoni escrow",
    "Can you do 1500?",
    "KES 1,200 is my last offer",
    "It's 42 inches chest, 30 waist, length 28",
    "I have 3 in stock, 2 medium and 1 large",
    "Delivery to Thika is 400 right?",
    "Order SKN-1042 arrived, thanks",
    "The phone case fits iPhone 12",
    "My number one pick is the black one",
    "Call it 900 and it's a deal",
    "Meet at the stage tomorrow at 2",
    "Size 10 shoes, price 2500, condition 9 out of 10",
  ];

  for (const t of fine) {
    it(`allows "${t.slice(0, 40)}"`, () => {
      const r = screenMessage(t);
      assert.equal(r.blocked, false, `${t} -> ${r.reason} (${r.matched})`);
    });
  }

  it("allows a long order reference", () => {
    assert.equal(blocked("Ref QKJ89123456 came through"), false);
  });

  it("allows mentioning M-Pesa without a number", () => {
    // This is how the platform works; blocking it teaches people to leave.
    assert.equal(blocked("Pay via M-Pesa and I'll ship today"), false);
  });

  it("allows an empty or blank message", () => {
    for (const t of ["", "   ", null, undefined]) assert.equal(blocked(t), false, String(t));
  });
});

describe("off-platform payment", () => {
  const bad = [
    ["Send to till 832910", "OFF_PLATFORM_PAYMENT"],
    ["use my paybill instead", "OFF_PLATFORM_PAYMENT"],
    ["buy goods number below", "OFF_PLATFORM_PAYMENT"],
    ["just pay me directly", "OFF_PLATFORM_PAYMENT"],
    ["let's do it outside sokoni", "OFF_PLATFORM_PAYMENT"],
    ["cancel on sokoni and I'll send it", "OFF_PLATFORM_PAYMENT"],
    ["send cash on delivery", "OFF_PLATFORM_PAYMENT"],
  ];
  for (const [t, want] of bad) {
    it(`blocks "${t}"`, () => assert.equal(reason(t), want, t));
  }

  it("blocks a payment word sitting next to a long number", () => {
    assert.equal(blocked("mpesa 0798 1122 33"), true);
  });

  it("does not block a payment word next to a short one", () => {
    assert.equal(blocked("mpesa payment of 1500 done"), false);
  });
});

describe("links and contact requests", () => {
  for (const t of ["check wa.me/254712", "https://example.com", "www.mysite.co.ke", "find me on instagram.com/x"]) {
    it(`blocks "${t}"`, () => assert.equal(reason(t), "EXTERNAL_LINK", t));
  }
  for (const t of ["call me", "text me later", "dm me", "whatsapp me"]) {
    it(`blocks "${t}"`, () => assert.equal(reason(t), "CONTACT_DETAILS", t));
  }
  it("does not block ordinary uses of call", () => {
    assert.equal(blocked("I'll call the rider when he arrives"), false);
    assert.equal(blocked("Call it a deal"), false);
  });
});

describe("the normalisers do one job each", () => {
  it("does not turn words into digits when resolving numbers", () => {
    // The obvious global o->0 and one->1 turns "phone" into "ph1" and then
    // screens that for payment words.
    assert.match(resolveDigits("my phone is nice"), /phone/);
    assert.match(resolveDigits("good one"), /good/);
  });

  it("resolves a standalone number word", () => {
    assert.match(resolveDigits("seven"), /7/);
  });

  it("folds lookalikes without touching normal text", () => {
    assert.equal(foldLookalikes("hello"), "hello");
    assert.equal(foldLookalikes("о"), "o");
  });

  it("strips accents for word matching", () => {
    assert.equal(normalizeWords("PÁY  BÍLL"), "pay bill");
  });

  it("folds an accented paybill through to a block", () => {
    assert.equal(blocked("use my páybill"), true);
  });
});

describe("what the sender is told", () => {
  it("explains the escrow consequence rather than just refusing", () => {
    assert.match(blockedMessageFor("PHONE_NUMBER"), /escrow/i);
    assert.match(blockedMessageFor("OFF_PLATFORM_PAYMENT"), /escrow/i);
  });

  it("never quotes the blocked text back", () => {
    for (const r of ["PHONE_NUMBER", "OFF_PLATFORM_PAYMENT", "EXTERNAL_LINK", "CONTACT_DETAILS", null]) {
      assert.ok(blockedMessageFor(r).length > 20);
      assert.doesNotMatch(blockedMessageFor(r), /\d{6,}/);
    }
  });
});

describe("it cannot be made to hang", () => {
  it("handles a long run of separators quickly", () => {
    // A catastrophically backtracking pattern here would be a denial of
    // service on the message path.
    const nasty = "0" + " ".repeat(5000) + "7" + "-".repeat(5000) + "1";
    const started = Date.now();
    screenMessage(nasty);
    assert.ok(Date.now() - started < 1000, "screening took too long");
  });

  it("handles a very long message", () => {
    const started = Date.now();
    screenMessage("lorem ipsum ".repeat(4000));
    assert.ok(Date.now() - started < 1000);
  });
});

describe("nothing the old filter caught gets through", () => {
  // The exact patterns that shipped, each with a string that matched it.
  // Replacing a filter on a live marketplace must only ever widen it.
  const OLD_CATCHES = [
    ["07 digits", "0712345678"],
    ["01 digits", "0112345678"],
    ["+254", "+254712345678"],
    ["bare 254", "254712345678"],
    ["pay outside", "we can pay outside"],
    ["direct till", "use the direct till"],
    ["send cash", "just send cash"],
    ["wa.me", "wa.me/254700"],
    ["whatsapp.com", "chat.whatsapp.com/abc"],
    ["t.me", "t.me/shop"],
    ["instagram", "instagram.com/shop"],
    ["facebook", "facebook.com/shop"],
    ["tiktok", "tiktok.com/@shop"],
    ["call me", "call me"],
    ["text us", "text us"],
    ["dm me", "dm me"],
    ["http", "http://x.co"],
    ["https", "https://x.co"],
    ["www", "www.shop.co.ke"],
    ["till with digits", "till 83291"],
    ["buy goods", "buy goods 12345"],
  ];

  for (const [label, sample] of OLD_CATCHES) {
    it(`still blocks ${label}`, () => {
      assert.equal(blocked(sample), true, `${label}: "${sample}"`);
    });
  }
});
