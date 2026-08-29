/**
 * How-it-works deterministic card + wall-of-text spacing.
 */
import assert from "node:assert/strict";
import { isHowItWorksIntent } from "../src/services/ai-tools.js";
import { howItWorksMessage } from "../src/services/trust-copy.js";
import { normalizeBotMessageSpacing } from "../src/services/whatsapp.js";

assert.equal(isHowItWorksIntent("How does everything work"), true);
assert.equal(isHowItWorksIntent("How is everything handled"), true);
assert.equal(isHowItWorksIntent("how does sokoni work?"), true);
assert.equal(isHowItWorksIntent("I want sneakers"), false);

const card = howItWorksMessage("whatsapp");
assert.match(card, /\n\n1️⃣ /);
assert.match(card, /\n\n2️⃣ /);
assert.match(card, /escrow/i);
assert.match(card, /CONFIRM SKN/);

const wall =
  "Yes, that's how it works. All payments are prepaid via M-Pesa STK, held in escrow until you confirm delivery. The seller and rider handle the pickup and delivery steps with the OTPs. You can track the order anytime with your SKN-####.";
const spaced = normalizeBotMessageSpacing(wall);
assert.ok(spaced.includes("\n\n"), `expected paragraph breaks, got: ${spaced}`);
assert.ok(spaced.split("\n\n").length >= 3);

console.log("ok: how-it-works card + prose spacing");
