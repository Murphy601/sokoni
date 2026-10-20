/**
 * In-process event bus the sub-agents talk over.
 *
 * Plain Node EventEmitter, one shared instance, no broker and no extra
 * process. The cost of a published event is a function call per listener, so
 * this stays inside the 450MB pm2 cap that rules out anything heavier.
 *
 * The subtlety is that EventEmitter is hostile by default for this job:
 *
 *  - listeners run synchronously, so one that throws throws out of whatever
 *    called publish -- an agent with a bug would take down the webhook that
 *    emitted the event
 *  - an async listener that rejects becomes an unhandled rejection
 *  - emitting "error" with no listener attached kills the process outright
 *
 * A monitoring layer that can stop a sale is worse than no monitoring layer,
 * so every handler is wrapped at subscribe time and failures are counted
 * rather than propagated.
 */

import { EventEmitter } from "node:events";

/** Events the bus knows about. Anything else is a typo. */
export const AGENT_EVENTS = Object.freeze({
  /** A sub-agent reporting upward to the main agent. */
  SUBAGENT_REPORT: "SUBAGENT_REPORT",
  /** Escrow funded and held. */
  PAYMENT_LOCKED: "PAYMENT_LOCKED",
  /** An order is approaching its dispatch deadline. */
  ESCROW_TIMEOUT_WARNING: "ESCROW_TIMEOUT_WARNING",
  /** Chat control blocked something. */
  FLAGGED_MESSAGE: "FLAGGED_MESSAGE",
  /** A person-authored chat message was stored. */
  CHAT_MESSAGE_CREATED: "CHAT_MESSAGE_CREATED",
  /** A photo, video, or voice note was stored. */
  MEDIA_UPLOADED: "MEDIA_UPLOADED",
  /** Someone signed in. */
  USER_SIGNED_IN: "USER_SIGNED_IN",
  /** A buyer proposed a price. */
  BARGAIN_PROPOSED: "BARGAIN_PROPOSED",
  /** A buyer proposed a multi-item price. */
  BUNDLE_CREATED: "BUNDLE_CREATED",
  /** An M-Pesa prompt was sent. */
  STK_PROMPTED: "STK_PROMPTED",
  /** A buyer opened a dispute. */
  DISPUTE_OPENED: "DISPUTE_OPENED",
  /** Sokoni pinned a rider on an order. */
  RIDER_ASSIGNED: "RIDER_ASSIGNED",
  /** A delivery code did not match. */
  OTP_ATTEMPT_FAILED: "OTP_ATTEMPT_FAILED",
  /** A delivery code matched. */
  OTP_VERIFIED: "OTP_VERIFIED",
  /** The buyer's two-hour inspection of a delivered item has started. */
  DELIVERY_INSPECTION_STARTED: "DELIVERY_INSPECTION_STARTED",
  /** The bot heap crossed the comfort line. */
  VM_MEMORY_SPIKE: "VM_MEMORY_SPIKE",
  /** A rider dispatch changed state. */
  DISPATCH_UPDATE: "DISPATCH_UPDATE",
});

/** Severities, lowest first. The main agent routes on these. */
export const SEVERITY = Object.freeze({
  INFO: "INFO",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

const SEVERITY_RANK = { INFO: 0, HIGH: 1, CRITICAL: 2 };

/** True when `a` is at least as severe as `b`. */
export function atLeastSevere(a, b) {
  return (SEVERITY_RANK[a] ?? -1) >= (SEVERITY_RANK[b] ?? 99);
}

class SokoniEventBus extends EventEmitter {
  constructor() {
    super();
    // One listener per agent per event, and there will be a dozen agents.
    // The default of 10 would start printing leak warnings that are not leaks.
    this.setMaxListeners(64);
    // Without a listener here, emit("error") terminates the process.
    super.on("error", (err) => {
      console.warn("[agent-bus] error event:", err?.message || err);
    });
    /** @type {Map<string, number>} handler failures, by "agent:event" */
    this.failures = new Map();
  }

  /**
   * Subscribe an agent to an event.
   *
   * The handler is wrapped so neither a synchronous throw nor a rejected
   * promise can escape into the caller that published the event.
   *
   * @param {string} agentName who is listening, used in logs
   * @param {string} event one of AGENT_EVENTS
   * @param {(payload: unknown) => unknown} handler
   */
  subscribe(agentName, event, handler) {
    if (typeof handler !== "function") {
      throw new TypeError(`${agentName} subscribed to ${event} without a handler`);
    }
    const key = `${agentName}:${event}`;
    const safe = (payload) => {
      try {
        const out = handler(payload);
        if (out && typeof out.then === "function") {
          out.catch((err) => this.#recordFailure(key, err));
        }
      } catch (err) {
        this.#recordFailure(key, err);
      }
    };
    safe.agentName = agentName;
    this.on(event, safe);
    return () => this.off(event, safe);
  }

  /**
   * Publish an event. Never throws, never returns a promise.
   *
   * Callers are on the hot path -- a webhook, an M-Pesa callback -- so this
   * has to be fire-and-forget in the strictest sense.
   */
  publish(event, payload) {
    try {
      this.emit(event, payload);
    } catch (err) {
      // Only reachable if a listener was attached with raw .on() rather than
      // subscribe(). Swallow it anyway; the emitter is not the place to die.
      this.#recordFailure(`unknown:${event}`, err);
    }
  }

  #recordFailure(key, err) {
    this.failures.set(key, (this.failures.get(key) || 0) + 1);
    console.warn(`[agent-bus] ${key} handler failed:`, err?.message || err);
  }

  /** Failure counts, for the health digest. */
  failureReport() {
    return Object.fromEntries(this.failures);
  }

  /** Test helper: drop every listener and counter. */
  resetForTests() {
    this.removeAllListeners();
    super.on("error", (err) => {
      console.warn("[agent-bus] error event:", err?.message || err);
    });
    this.failures.clear();
  }
}

export const agentBus = new SokoniEventBus();

/**
 * Shape a sub-agent report, dropping anything malformed.
 *
 * Reports come from agent code, not from users, but a bad one must not be
 * able to poison the buffer or break the digest that reads it later.
 *
 * @returns {{type:string, severity:string, summary:string, data:object, at:number}|null}
 */
export function normalizeReport(raw) {
  if (!raw || typeof raw !== "object") return null;
  const summary = String(raw.summary || "").trim().slice(0, 400);
  if (!summary) return null;
  const severity = SEVERITY[raw.severity] || SEVERITY.INFO;
  return {
    type: String(raw.type || "UNKNOWN").slice(0, 60),
    severity,
    summary,
    data: raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : {},
    at: Number.isFinite(raw.at) ? raw.at : Date.now(),
  };
}
