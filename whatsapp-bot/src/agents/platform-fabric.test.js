/**
 * Platform snapshot, bargain nudge, and the gated action names.
 *
 * A payment prompt has to show up in memory without a query, and a close
 * offer is the only bargain that may nudge a seller. Money movement stays on
 * the approval table.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentBus, AGENT_EVENTS } from "./event-bus.js";
import { platformState } from "./platform-state.js";
import { announce } from "./fabric.js";
import { pickEventData } from "./enrich.js";
import { normalizeAgentAction } from "./agent-actions.js";
import {
  bargainNudgeAllowed,
  considerBargain,
  resetNudgeWindowForTests,
  startPlatformAgents,
  stopPlatformAgents,
  stkStillOpen,
} from "./platform-agents.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

beforeEach(() => {
  agentBus.resetForTests();
  platformState.resetForTests();
  stopPlatformAgents();
  resetNudgeWindowForTests();
});

describe("the heap snapshot stays small", () => {
  it("forgets users past the cap", () => {
    for (let i = 1; i <= 450; i += 1) platformState.touchUser(i);
    assert.ok(platformState.getSnapshot().activeUsers <= 400);
  });

  it("records a prompt, then a hold, without keeping a contact number", async () => {
    await announce(AGENT_EVENTS.STK_PROMPTED, {
      orderId: "SKN-9",
      amountKes: 1400,
      checkoutId: "ws_CO_1",
      phone: "254712345678",
    });
    assert.equal(stkStillOpen("SKN-9"), true);
    await announce(AGENT_EVENTS.PAYMENT_LOCKED, {
      orderId: "SKN-9",
      amountKes: 1400,
      escrowStatus: "held",
    });
    assert.equal(stkStillOpen("SKN-9"), false);
    assert.equal(platformState.getEscrow("SKN-9").status, "held");
    assert.equal(platformState.getSnapshot().todayVolumeKes, 1400);
    const seen = pickEventData({ orderId: "SKN-9", phone: "254712345678", amountKes: 1400 });
    assert.equal(seen.phone, undefined);
  });
});

describe("a bargain nudge", () => {
  const closeOffer = {
    data: { sellerUserId: 8, listedPriceKes: 1000, proposedPriceKes: 900 },
    context: { sender: { ratingScore: 4.6, completedOrders: 2, ratingCount: 4 } },
  };

  it("allows a small discount from a buyer with a record", () => {
    assert.equal(bargainNudgeAllowed(closeOffer), true);
  });

  it("refuses a steep discount and a buyer with no record", () => {
    assert.equal(
      bargainNudgeAllowed({
        ...closeOffer,
        data: { ...closeOffer.data, proposedPriceKes: 700 },
      }),
      false
    );
    assert.equal(bargainNudgeAllowed({ ...closeOffer, context: {} }), false);
  });

  it("sends one nudge and leaves numbers out of the text", async () => {
    const sent = [];
    const send = async (sellerId, text) => {
      sent.push({ sellerId, text });
      return true;
    };
    const first = await considerBargain(closeOffer, { send });
    const second = await considerBargain(closeOffer, { send });
    assert.equal(first.nudged, true);
    assert.equal(second.reason, "rate_limited");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].sellerId, 8);
    assert.match(sent[0].text, /KES 900/);
    assert.doesNotMatch(sent[0].text, /254|07\d{8}/);
  });
});

describe("listeners report without paging twice for a wrong code", () => {
  it("keeps a failed delivery code at info", () => {
    const reports = [];
    agentBus.subscribe("Watch", AGENT_EVENTS.SUBAGENT_REPORT, (report) => reports.push(report));
    startPlatformAgents();
    agentBus.publish(AGENT_EVENTS.OTP_ATTEMPT_FAILED, {
      data: { orderId: "SKN-3", attemptCount: 2, riderPhone: "254700000000" },
    });
    assert.equal(reports.length, 1);
    assert.equal(reports[0].severity, "INFO");
    assert.match(reports[0].summary, /SKN-3/);
    assert.doesNotMatch(reports[0].summary, /254700000000/);
  });
});

describe("gated actions", () => {
  it("names only the two money actions an admin can approve", () => {
    assert.equal(normalizeAgentAction("release_escrow"), "RELEASE_ESCROW");
    assert.equal(normalizeAgentAction("PROMPT_STK"), "PROMPT_STK");
    assert.equal(normalizeAgentAction("FREEZE_ACCOUNT"), null);
  });

  it("stores proposals in phase 41 and wires the five pillars", () => {
    const schema = src("../../db/schema-phase41-agent-actions.sql");
    assert.match(schema, /pending_agent_actions/);
    assert.doesNotMatch(schema, /trust_score/);
    const social = src("../db/repositories/social.js");
    const prepaid = src("../services/prepaid-checkout.js");
    const boda = src("../services/boda-fleet.js");
    const disputes = src("../services/disputes.js");
    const accounts = src("../services/account-auth.js");
    const bundles = src("../db/repositories/bundles.js");
    assert.match(social, /BARGAIN_PROPOSED/);
    assert.match(social, /MEDIA_UPLOADED/);
    assert.match(bundles, /BUNDLE_CREATED/);
    assert.match(prepaid, /STK_PROMPTED/);
    assert.match(boda, /RIDER_ASSIGNED/);
    assert.match(boda, /OTP_ATTEMPT_FAILED/);
    assert.match(boda, /OTP_VERIFIED/);
    assert.match(disputes, /DISPUTE_OPENED/);
    assert.match(accounts, /USER_SIGNED_IN/);
  });
});
