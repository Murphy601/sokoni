/**
 * The agent the admin actually hears from.
 *
 * Sub-agents report upward; this decides what is worth waking someone for and
 * what can wait for the next digest. It holds a small rolling buffer in
 * memory and nothing else, so a busy day costs the same as a quiet one.
 *
 * The part that matters is the rate limit. A monitoring layer that can page
 * you three hundred times in an hour is one you will mute, and a muted alert
 * channel is worse than none -- the first real fraud alert lands in a thread
 * you stopped reading. Suppressed alerts are counted and surface in the
 * digest, so nothing is lost, only delayed.
 */

import { agentBus, AGENT_EVENTS, SEVERITY, normalizeReport } from "./event-bus.js";

/** How many recent reports to keep. Bounded so memory cannot grow. */
export const BUFFER_LIMIT = 100;
/** Identical alerts inside this window collapse into one. */
export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
/** Most instant alerts in an hour, whatever happens. */
export const MAX_ALERTS_PER_HOUR = 12;
const HOUR_MS = 60 * 60 * 1000;

export class MainSokoniAgent {
  /**
   * @param {object} opts
   * @param {(text: string) => Promise<unknown>} [opts.notify] how an alert reaches the admin
   * @param {() => number} [opts.now] injectable clock, for tests
   */
  constructor({ notify = null, now = () => Date.now() } = {}) {
    this.now = now;
    this.notify = notify;
    /** @type {Array<object>} newest last */
    this.buffer = [];
    /** @type {Map<string, number>} dedupe key -> last sent at */
    this.recentAlerts = new Map();
    /** @type {number[]} timestamps of alerts actually sent */
    this.alertTimes = [];
    this.suppressed = 0;
    this.unsubscribe = null;
  }

  /** Start listening. Safe to call once; a second call is a no-op. */
  start() {
    if (this.unsubscribe) return this;
    this.unsubscribe = agentBus.subscribe("MainSokoniAgent", AGENT_EVENTS.SUBAGENT_REPORT, (raw) =>
      this.handleReport(raw)
    );
    return this;
  }

  stop() {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
  }

  /**
   * Record a report and decide whether it interrupts anyone.
   * @returns {Promise<{buffered:boolean, alerted:boolean, reason?:string}>}
   */
  async handleReport(raw) {
    const report = normalizeReport(raw);
    if (!report) return { buffered: false, alerted: false, reason: "malformed" };

    this.buffer.push(report);
    if (this.buffer.length > BUFFER_LIMIT) {
      this.buffer.splice(0, this.buffer.length - BUFFER_LIMIT);
    }

    if (report.severity === SEVERITY.INFO) {
      return { buffered: true, alerted: false, reason: "info" };
    }

    const gate = this.#mayAlert(report);
    if (!gate.ok) {
      this.suppressed += 1;
      return { buffered: true, alerted: false, reason: gate.reason };
    }

    const sent = await this.#send(report);
    return { buffered: true, alerted: sent, reason: sent ? undefined : "notify_failed" };
  }

  /** Dedupe on what the alert says, not on when it arrived. */
  #dedupeKey(report) {
    return `${report.type}|${report.summary}`;
  }

  #mayAlert(report) {
    const t = this.now();
    const key = this.#dedupeKey(report);

    const last = this.recentAlerts.get(key);
    if (last != null && t - last < DEDUPE_WINDOW_MS) {
      return { ok: false, reason: "duplicate" };
    }

    this.alertTimes = this.alertTimes.filter((ts) => t - ts < HOUR_MS);
    if (this.alertTimes.length >= MAX_ALERTS_PER_HOUR) {
      // CRITICAL still gets through -- a cap that hides a fraud alert is the
      // wrong trade. It is deduped, so a loop still cannot spam.
      if (report.severity !== SEVERITY.CRITICAL) {
        return { ok: false, reason: "rate_limited" };
      }
    }
    return { ok: true };
  }

  async #send(report) {
    const t = this.now();
    this.recentAlerts.set(this.#dedupeKey(report), t);
    this.alertTimes.push(t);
    // Keep the dedupe map from growing for a long-lived process.
    if (this.recentAlerts.size > 200) {
      for (const [k, ts] of this.recentAlerts) {
        if (t - ts > DEDUPE_WINDOW_MS) this.recentAlerts.delete(k);
      }
    }

    const icon = report.severity === SEVERITY.CRITICAL ? "🚨" : "⚠️";
    const text = `${icon} *Sokoni agent alert*\n\n${report.summary}`;
    try {
      if (this.notify) await this.notify(text);
      else await this.#defaultNotify(text);
      return true;
    } catch (err) {
      console.warn("[main-agent] alert not delivered:", err?.message || err);
      return false;
    }
  }

  async #defaultNotify(text) {
    const { notifyAdminEvent } = await import("../services/communication-hub.js");
    await notifyAdminEvent("DISPUTE_OR_HELP", { orderId: null, details: text });
  }

  /** Counts by severity and type over the buffer. */
  stats() {
    const bySeverity = { INFO: 0, HIGH: 0, CRITICAL: 0 };
    const byType = {};
    for (const r of this.buffer) {
      bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
      byType[r.type] = (byType[r.type] || 0) + 1;
    }
    return { total: this.buffer.length, bySeverity, byType, suppressed: this.suppressed };
  }

  /**
   * The periodic digest.
   *
   * Says what happened and, when alerts were held back, says that too -- a
   * quiet digest that hides forty suppressed warnings is a lie.
   */
  composeDigest() {
    const s = this.stats();
    const failures = agentBus.failureReport();
    const failureCount = Object.values(failures).reduce((a, b) => a + b, 0);

    const lines = [`📊 *Sokoni digest*`, ""];
    if (!s.total) {
      lines.push("Nothing reported since the last digest.");
    } else {
      lines.push(`• Events: ${s.total}`);
      if (s.bySeverity.CRITICAL) lines.push(`• Critical: ${s.bySeverity.CRITICAL}`);
      if (s.bySeverity.HIGH) lines.push(`• Needs attention: ${s.bySeverity.HIGH}`);
      const top = Object.entries(s.byType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([type, n]) => `${type} ${n}`)
        .join(", ");
      if (top) lines.push(`• Most of it: ${top}`);
    }
    if (s.suppressed) {
      lines.push(`• Held back to avoid flooding you: ${s.suppressed}`);
    }
    lines.push("", failureCount ? `⚠️ Agent handler failures: ${failureCount}` : "🟢 Agents healthy");
    return lines.join("\n");
  }

  /** Nothing happened and nothing broke. */
  isQuiet() {
    const failures = Object.values(agentBus.failureReport()).reduce((a, b) => a + b, 0);
    return this.buffer.length === 0 && this.suppressed === 0 && failures === 0;
  }

  /**
   * Send the digest and start a fresh window.
   *
   * A quiet period sends nothing by default. "Nothing reported" every six
   * hours forever is how a channel stops being read, and the alerts share
   * that channel.
   */
  async sendDigest({ skipIfQuiet = true } = {}) {
    if (skipIfQuiet && this.isQuiet()) return false;
    const text = this.composeDigest();
    try {
      if (this.notify) await this.notify(text);
      else await this.#defaultNotify(text);
    } catch (err) {
      console.warn("[main-agent] digest not delivered:", err?.message || err);
      return false;
    }
    this.buffer = [];
    this.suppressed = 0;
    return true;
  }
}

/** The instance the server starts. */
export const mainAgent = new MainSokoniAgent();

/** Convenience for sub-agents: report upward without importing the bus shape. */
export function reportToMainAgent({ type, severity = SEVERITY.INFO, summary, data = {} }) {
  agentBus.publish(AGENT_EVENTS.SUBAGENT_REPORT, { type, severity, summary, data });
}
