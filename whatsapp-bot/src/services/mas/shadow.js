/**
 * Shadow / dark-launch helpers — fire-and-forget; never block or mutate primary flows.
 */
import { executeTask } from "./execute-task.js";
import { canShadow, masFlags } from "./flags.js";
import { MAS_TASKS } from "./tasks.js";

function logShadow(task, result) {
  const bit =
    result.ok
      ? `ok via ${result.provider}/${result.model}`
      : result.skipped
        ? `skipped:${result.reason}`
        : `degraded:${result.message || "fail"}`;
  console.log(`[mas-shadow] ${task} ${bit}`);
}

/** Non-blocking shadow execution */
export function shadowTask(task, payload = {}) {
  if (!canShadow(task)) return;
  setImmediate(() => {
    executeTask(task, payload, { mode: "shadow" })
      .then((r) => logShadow(task, r))
      .catch((err) => console.warn(`[mas-shadow] ${task} error:`, err.message));
  });
}

/** Phase 1: inbound text security shadows */
export function shadowInboundText(text, meta = {}) {
  if (!masFlags().enabled) return;
  const payload = { text, ...meta };
  shadowTask(MAS_TASKS.JAILBREAK_DETECT, payload);
  shadowTask(MAS_TASKS.TOPIC_GUARD, payload);
  shadowTask(MAS_TASKS.CONTENT_SAFETY_TEXT, payload);
}

/** Phase 1: listing / catalog image shadows */
export function shadowListingImage(imageUrl, meta = {}) {
  if (!imageUrl || !masFlags().enabled) return;
  shadowTask(MAS_TASKS.CONTENT_SAFETY_MULTIMODAL, { imageUrl, text: meta.caption || "product listing" });
  shadowTask(MAS_TASKS.VISUAL_METADATA, { imageUrl, text: "Extract brand, model, visible text as JSON." });
  shadowTask(MAS_TASKS.FAST_VISION, {
    imageUrl,
    text: "Classify product category and condition briefly.",
  });
}

/** Phase 1: dispute / evidence video shadow */
export function shadowDisputeVideo(videoUrl, meta = {}) {
  if (!videoUrl || !masFlags().enabled) return;
  shadowTask(MAS_TASKS.SYNTHETIC_VIDEO_DETECT, { url: videoUrl, ...meta });
  if (masFlags().transactionalShadow) {
    shadowTask(MAS_TASKS.PHYSICAL_REASON, {
      text: `Dispute evidence review (shadow only). Order ${meta.orderId || "?"}. Do not decide payout.`,
      url: videoUrl,
    });
    shadowTask(MAS_TASKS.REASONING_DISPUTE, {
      text: `Shadow dispute advisor only. Never release escrow. Context: ${JSON.stringify(meta).slice(0, 1500)}`,
    });
  }
}

/** Phase 4 logistics stubs — shadow only */
export function shadowLogistics(payload = {}) {
  if (!masFlags().transactionalShadow) return;
  shadowTask(MAS_TASKS.FLEET_ROUTE_OPT, payload);
}
