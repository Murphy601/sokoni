/**
 * Listeners for the platform fabric.
 *
 * Level 1 is a rate-limited seller nudge and an admin report. Level 2 money
 * movement is not started from here. A proposal has to be approved on the
 * admin route, which calls the existing payout and checkout functions.
 */

import { agentBus, AGENT_EVENTS, SEVERITY } from "./event-bus.js";
import { reportToMainAgent } from "./main-agent.js";
import { platformState } from "./platform-state.js";
import { reclaimHeap } from "./heap-guard.js";
import { isDbEnabled, query } from "../db/pool.js";

const NUDGE_WINDOW_MS = 30 * 60 * 1000;
const recentNudges = new Map();
let stops = [];
const stkTimers = new Map();

/** A close offer from a buyer who already has a record on Sokoni. */
export function bargainNudgeAllowed(event) {
  const listed = Number(event?.data?.listedPriceKes);
  const proposed = Number(event?.data?.proposedPriceKes);
  if (!(listed > 0) || !(proposed > 0) || proposed > listed) return false;
  if ((listed - proposed) / listed > 0.15) return false;
  const buyer = event?.context?.sender;
  if (!buyer) return false;
  const rating = Number(buyer.ratingScore);
  const orders = Number(buyer.completedOrders) || 0;
  const ratings = Number(buyer.ratingCount) || 0;
  if (!(rating >= 4)) return false;
  if (orders < 1 && ratings < 3) return false;
  return true;
}

export function stkStillOpen(orderId) {
  const row = platformState.getEscrow(orderId);
  return Boolean(row && row.status === "prompted");
}

function rememberNudge(sellerId, now) {
  const last = recentNudges.get(sellerId);
  if (last != null && now - last < NUDGE_WINDOW_MS) return false;
  recentNudges.set(sellerId, now);
  if (recentNudges.size > 200) {
    for (const [id, ts] of recentNudges) {
      if (now - ts > NUDGE_WINDOW_MS) recentNudges.delete(id);
    }
  }
  return true;
}

async function defaultNudge(sellerId, text) {
  if (!isDbEnabled()) return false;
  const { rows } = await query(`SELECT phone FROM users WHERE id = $1`, [sellerId]);
  const phone = rows[0]?.phone;
  if (!phone) return false;
  const { sendText } = await import("../services/whatsapp.js");
  // Three seconds. A stalled WhatsApp session must not sit on this process.
  await sendText(phone, text, { timeoutMs: 3000 });
  return true;
}

/**
 * @param {object} opts
 * @param {(sellerId: number, text: string) => Promise<boolean>} [opts.send]
 * @param {() => number} [opts.now]
 */
export async function considerBargain(event, { send = defaultNudge, now = () => Date.now() } = {}) {
  if (!bargainNudgeAllowed(event)) return { nudged: false, reason: "not_eligible" };
  const sellerId = event.data.sellerUserId || event.data.receiverUserId;
  if (!sellerId) return { nudged: false, reason: "no_seller" };
  if (!rememberNudge(sellerId, now())) return { nudged: false, reason: "rate_limited" };
  const listed = Math.round(Number(event.data.listedPriceKes));
  const proposed = Math.round(Number(event.data.proposedPriceKes));
  const text =
    `A buyer offered KES ${proposed.toLocaleString("en-KE")} on your item ` +
    `(listed KES ${listed.toLocaleString("en-KE")}). Open Sokoni to accept or decline.`;
  try {
    const sent = await send(sellerId, text);
    return { nudged: Boolean(sent), reason: sent ? undefined : "not_delivered" };
  } catch (err) {
    console.warn("[sales-agent] nudge skipped:", err?.message || err);
    return { nudged: false, reason: "not_delivered" };
  }
}

function armStkWatch(orderId) {
  if (!orderId || stkTimers.has(orderId) || stkTimers.size >= 40) return;
  const timer = setTimeout(() => {
    stkTimers.delete(orderId);
    if (!stkStillOpen(orderId)) return;
    reportToMainAgent({
      type: "ESCROW",
      severity: SEVERITY.INFO,
      summary: `M-Pesa prompt for ${orderId} has not confirmed after 60 seconds.`,
      data: { orderId },
    });
  }, 60_000);
  timer.unref?.();
  stkTimers.set(orderId, timer);
}

export function startPlatformAgents() {
  if (stops.length) return;
  stops = [
    agentBus.subscribe("SalesAgent", AGENT_EVENTS.BARGAIN_PROPOSED, (event) => {
      void considerBargain(event);
    }),
    agentBus.subscribe("EscrowAgent", AGENT_EVENTS.STK_PROMPTED, (event) => {
      armStkWatch(event?.data?.orderId);
    }),
    agentBus.subscribe("TrustGuardAgent", AGENT_EVENTS.OTP_ATTEMPT_FAILED, (event) => {
      const attempts = Number(event?.data?.attemptCount) || 0;
      const orderId = event?.data?.orderId || "an order";
      reportToMainAgent({
        type: "LOGISTICS",
        severity: SEVERITY.INFO,
        summary: `Delivery code failed ${attempts} time(s) on ${orderId}.`,
        data: { orderId: event?.data?.orderId || null, attemptCount: attempts },
      });
    }),
    agentBus.subscribe("SecurityGuardAgent", AGENT_EVENTS.VM_MEMORY_SPIKE, (event) => {
      const mb = event?.data?.heapUsedMb ?? "high";
      void reclaimHeap()
        .catch((err) => console.warn("[heap] reclaim skipped:", err?.message || err))
        .finally(() => {
          reportToMainAgent({
            type: "CAPACITY",
            severity: SEVERITY.HIGH,
            summary: `Bot heap is ${mb}MB. Expired media was cleared. Hold new uploads until it drops.`,
            data: { heapUsedMb: event?.data?.heapUsedMb ?? null },
          });
        });
    }),
  ];
}

export function stopPlatformAgents() {
  for (const stop of stops) stop();
  stops = [];
  for (const timer of stkTimers.values()) clearTimeout(timer);
  stkTimers.clear();
  recentNudges.clear();
}

export function resetNudgeWindowForTests() {
  recentNudges.clear();
}
