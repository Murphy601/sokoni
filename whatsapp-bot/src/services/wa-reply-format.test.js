import test from "node:test";
import assert from "node:assert/strict";
import { formatWhatsAppText, normalizeBotMessageSpacing } from "./whatsapp.js";
import { enforceReplyBrevity } from "./ai-agent.js";

test("formatWhatsAppText converts literal \\n into real breaks", () => {
  const raw = "Yes, Boss.\\n\\nWhen a dispute is stale, funds unlock by policy.";
  const out = formatWhatsAppText(raw);
  assert.equal(out.includes("\\n"), false);
  assert.match(out, /Yes, Boss\.\n\nWhen/);
});

test("normalizeBotMessageSpacing breaks mashed Boss wall of text", () => {
  const wall =
    "Yes, Boss. Closing stale disputes prevents funds from sitting forever. The system auto-resolves using fallback rules when a party goes silent. You can still FORCE RELEASE SKN-#### anytime.";
  const out = normalizeBotMessageSpacing(wall);
  assert.match(out, /^Yes, Boss\.\n\n/i);
  assert.ok(out.includes("\n\n"), "expected paragraph breaks");
  assert.ok((out.match(/\n\n/g) || []).length >= 2);
});

test("enforceReplyBrevity preserves existing paragraphs for allowLonger", () => {
  const structured =
    "Yes, Boss.\n\nWhen a dispute becomes *stale*, a party stopped responding in time.\n\nTo avoid locking escrow forever:\n\n• Default payout to the party that completed their last step.\n\n• Override anytime with *FORCE RELEASE SKN-####*.";
  const out = enforceReplyBrevity(structured, "whatsapp", { allowLonger: true });
  assert.ok(out);
  assert.match(out, /Yes, Boss\.\n\n/i);
  assert.ok(out.includes("•"), "bullets preserved");
  assert.ok((out.match(/\n\n/g) || []).length >= 2);
});

test("enforceReplyBrevity does not flatten multi-sentence Boss answer into one line", () => {
  const mashed =
    "Yes, Boss. Closing stale disputes prevents funds sitting forever. Auto-resolve uses fallback rules when someone goes silent. Override with FORCE RELEASE SKN-4402.";
  const out = enforceReplyBrevity(mashed, "whatsapp", { allowLonger: true });
  assert.ok(out);
  assert.ok(out.includes("\n\n"), `expected breaks, got: ${JSON.stringify(out)}`);
  assert.equal(out.includes("\n") ? out.split("\n").length > 1 : false, true);
});
