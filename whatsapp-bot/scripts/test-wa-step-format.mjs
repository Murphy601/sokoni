/**
 * WhatsApp step formatting — no walls of text with inline 1️⃣2️⃣3️⃣.
 */
import assert from "node:assert/strict";
import { normalizeBotMessageSpacing } from "../src/services/whatsapp.js";
import { enforceReplyBrevity } from "../src/services/ai-agent.js";
import { SOKONI_MASTER_RULES } from "../src/services/ai-prompts.js";

const mashed =
  "Everything is handled through our prepaid escrow system. 1️⃣ You browse or chat, then pay via M-Pesa STK – the amount is held in Sokoni escrow. 2️⃣ For local orders, Sokoni pins a rider; the seller gives a 4-digit Pickup OTP, the rider replies PICKUP SKN-#### ####. 3️⃣ At delivery the rider asks for a 4-digit Delivery OTP; you reply CONFIRM SKN-#### #### to finish the sale. 4️⃣ Funds stay briefly in hold (~15 min) before the seller and rider are paid.";

const spaced = normalizeBotMessageSpacing(mashed);
assert.match(spaced, /\n\n1️⃣ /);
assert.match(spaced, /\n\n2️⃣ /);
assert.match(spaced, /\n\n3️⃣ /);
assert.match(spaced, /\n\n4️⃣ /);
assert.ok(!/system\. 1️⃣/.test(spaced), "no inline keycap after period");

const brief = enforceReplyBrevity(mashed, "whatsapp", { allowLonger: true });
assert.ok(brief);
assert.match(brief, /\n\n1️⃣ /);
assert.match(brief, /escrow/i);

assert.match(SOKONI_MASTER_RULES, /NO WALLS OF TEXT/i);
assert.match(SOKONI_MASTER_RULES, /OWN line/i);

console.log("ok: WhatsApp step line-breaks");
console.log("--- sample ---\n" + brief);
