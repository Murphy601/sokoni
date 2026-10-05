/**
 * Approval can happen only once, and only inside two hours.
 * A delivery inspection proposes a release. It does not pay anyone.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalActionOrderId, explainUnresolved } from "./agent-actions.js";
import { inspectionDue, INSPECTION_WINDOW_MS } from "./inspection-window.js";
import { reclaimHeap } from "./heap-guard.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("an approval claim", () => {
  it("treats a pending row past its expiry as expired", () => {
    const row = { status: "PENDING", expires_at: new Date(Date.now() - 1000).toISOString() };
    assert.equal(explainUnresolved(row).error, "expired");
  });

  it("treats a second click as already resolved", () => {
    const row = { status: "APPROVED", expires_at: new Date(Date.now() + 60_000).toISOString() };
    assert.equal(explainUnresolved(row).error, "already_resolved");
  });

  it("locks the row before it runs the payout", () => {
    const body = src("./agent-actions.js");
    const fn = body.slice(body.indexOf("export async function resolveAgentAction"));
    const claim = fn.indexOf("status = 'PENDING' AND expires_at > NOW()");
    const run = fn.indexOf("execute(row)");
    assert.ok(claim !== -1 && run !== -1 && claim < run);
  });
});

describe("the two-hour inspection", () => {
  const started = 1_000_000;
  const order = { id: "SKN-9", inspectionStartedAt: started };

  it("waits out the window", () => {
    assert.equal(inspectionDue(order, started + INSPECTION_WINDOW_MS - 1), false);
    assert.equal(inspectionDue(order, started + INSPECTION_WINDOW_MS), true);
  });

  it("ignores an order that was never stamped", () => {
    assert.equal(inspectionDue({ id: "SKN-1", deliveredAt: started }, started + INSPECTION_WINDOW_MS), false);
  });

  it("stops for a dispute, a payout, or a released escrow", () => {
    const later = started + INSPECTION_WINDOW_MS;
    assert.equal(inspectionDue({ ...order, disputeHold: true }, later), false);
    assert.equal(inspectionDue({ ...order, isPaidOut: true }, later), false);
    assert.equal(inspectionDue({ ...order, escrowStatus: "released" }, later), false);
  });

  it("asks for approval and does not call the payout itself", () => {
    const watcher = src("./inspection-window.js");
    assert.match(watcher, /proposeAgentAction/);
    assert.match(watcher, /strict: true/);
    assert.match(watcher, /proposal aborted/);
    assert.doesNotMatch(watcher, /releaseEscrowPayout/);
    assert.equal(canonicalActionOrderId("skn1002"), "SKN-1002");
    assert.equal(canonicalActionOrderId("SKN-1002"), "SKN-1002");
    const otp = src("../services/boda-fleet.js");
    assert.match(otp, /inspectionStartedAt/);
    assert.match(otp, /DELIVERY_INSPECTION_STARTED/);
  });
});

describe("a payout that might be in dispute", () => {
  it("locks the dispute row inside the payout and aborts when the lookup fails", () => {
    const payout = src("../services/seller-onboard.js");
    const fn = payout.slice(payout.indexOf("export async function releaseEscrowPayout"));
    const lock = fn.indexOf("await lockDisputeBeforePayout");
    const credit = fn.indexOf("creditSellerWalletAfterDelivery(");
    assert.ok(lock !== -1 && credit !== -1 && lock < credit);
    assert.match(fn, /dispute_lookup_failed/);
    assert.match(fn, /dispute_open/);
    assert.match(src("../services/disputes.js"), /FOR UPDATE/);

    const hub = src("../services/communication-hub.js");
    const auto = hub.slice(hub.indexOf("if (age >= releaseMs && !order.autoReleasedAt)"));
    assert.match(auto, /strict: true/);
    assert.match(auto, /auto-release aborted/);
    assert.doesNotMatch(auto, /catch[\s\S]{0,120}openDispute = false/);

    const upcountry = src("../services/upcountry-shipments.js");
    const loop = upcountry.slice(upcountry.indexOf("for (const order of candidates)"));
    assert.match(loop, /strict: true/);
    assert.match(loop, /auto-release aborted/);
    assert.doesNotMatch(loop, /catch[\s\S]{0,120}openDispute = false/);

    const courier = src("../services/escrow-automation.js");
    const delivered = courier.slice(courier.indexOf("export async function onOrderDelivered"));
    assert.match(delivered, /strict: true/);
    assert.match(delivered, /payout aborted/);
    assert.doesNotMatch(delivered.slice(0, delivered.indexOf("creditSellerWalletAfterDelivery")), /dispute check skipped/);
  });
});

describe("a slow WhatsApp send and a hot heap", () => {
  it("gives the sales nudge three seconds", () => {
    assert.match(src("./platform-agents.js"), /timeoutMs: 3000/);
    assert.match(src("../services/whatsapp.js"), /timeoutMs = 30000/);
  });

  it("collects garbage when the runtime allows it, and still finishes when it does not", async () => {
    let collected = 0;
    const result = await reclaimHeap({
      gc: () => {
        collected += 1;
      },
      purgeVoice: async () => ({ deleted: 2 }),
      purgePhotos: async () => ({ deleted: 1 }),
    });
    assert.equal(collected, 1);
    assert.equal(result.gc, true);
    assert.equal(result.voice, 2);
    const quiet = await reclaimHeap({
      gc: null,
      purgeVoice: async () => ({ deleted: 0 }),
      purgePhotos: async () => ({ deleted: 0 }),
    });
    assert.equal(quiet.gc, false);
  });

  it("starts node with the garbage-collector hook", () => {
    const deploy = src("../../../scripts/deploy-bot.sh");
    assert.match(deploy, /--expose-gc/);
  });
});
