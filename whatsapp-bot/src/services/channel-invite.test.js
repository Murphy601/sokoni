import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_INVITE_URL,
  channelInviteBody,
  sendChannelInvite,
  shouldSendChannelInvite,
} from "./channel-invite.js";

describe("channel invite engine", () => {
  it("builds copy with the official Channel link and no till leak", () => {
    const body = channelInviteBody({ reason: "lead" });
    assert.match(body, /whatsapp\.com\/channel\/0029VbE5SoTGJP8FzgHwmU2Q/);
    assert.equal(CHANNEL_INVITE_URL, "https://whatsapp.com/channel/0029VbE5SoTGJP8FzgHwmU2Q");
    assert.equal(/\b(till|paybill)\b/i.test(body), false);
  });

  it("dry-runs a personalized invite and then cools down that reason", async () => {
    const phone = `254700${String(Date.now()).slice(-6)}`;
    const now = Date.parse("2026-10-11T08:00:00+03:00");
    const first = await sendChannelInvite(
      { phone_number: phone, context: "To catch the next shoe drop, join here:", reason: "tool" },
      { dryRun: true, now }
    );
    assert.equal(first.ok, true);
    assert.equal(first.dryRun, true);
    assert.match(first.text, /shoe drop/);
    assert.match(first.text, /0029VbE5SoTGJP8FzgHwmU2Q/);

    assert.equal(shouldSendChannelInvite(phone, "tool", now + 60_000), false);
    const again = await sendChannelInvite(
      { phone_number: phone, context: "Again:", reason: "tool" },
      { dryRun: true, now: now + 60_000 }
    );
    assert.equal(again.skipped, true);

    const later = await sendChannelInvite(
      { phone_number: phone, context: "Tomorrow:", reason: "tool" },
      { dryRun: true, now: now + 25 * 60 * 60 * 1000, force: true }
    );
    assert.equal(later.ok, true);
    assert.ok(!later.skipped);
  });
});
