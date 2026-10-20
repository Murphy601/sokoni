/**
 * Sokoni Multi-Agent System (MAS) — additive fallback gateway.
 *
 * Primaries that MUST stay unchanged:
 *   - Chat: Groq → OpenRouter (llm-router)
 *   - Listing vision: OpenRouter → NVIDIA → Gemini
 *   - Video clips: Cloudinary Ken Burns → HeyGen HyperFrames → Remotion
 *
 * MAS only shadows, assists after primary failure, or last-resort when flags on.
 */
export { MAS_TASKS, MAS_PHASE } from "./tasks.js";
export { MAS_AGENT_CATALOG, agentsForTask, catalogSummary } from "./agent-catalog.js";
export { executeTask } from "./execute-task.js";
export { masFlags, isTaskLive, canShadow } from "./flags.js";
export { routesForTask, routeMeta } from "./routes.js";
export { circuitSnapshot, resetCircuits } from "./circuit-breaker.js";
export {
  shadowTask,
  shadowInboundText,
  shadowListingImage,
  shadowDisputeVideo,
  shadowLogistics,
} from "./shadow.js";
export { tryMasClipLastResort, tryMasSttAssist, tryMasChatFailover, tryMasModerationGate } from "./assist.js";

import { catalogSummary } from "./agent-catalog.js";
import { masFlags } from "./flags.js";
import { circuitSnapshot } from "./circuit-breaker.js";
import { MAS_TASKS } from "./tasks.js";
import { routeMeta } from "./routes.js";

export function masMeta() {
  const flags = masFlags();
  return {
    phase: "1-4_registered",
    style: "strangler_fig_fallback_gateway",
    primaryUntouched: {
      videoClip: ["cloudinary_ken_burns", "heygen_hyperframes", "remotion"],
      chat: ["groq", "openrouter", "gemini_opt_in"],
      listingVision: ["openrouter", "nvidia_nim", "gemini"],
    },
    flags,
    catalog: catalogSummary(),
    circuits: circuitSnapshot(),
    sampleRoutes: {
      RECEIPT_OCR: routeMeta(MAS_TASKS.RECEIPT_OCR).routes,
      VIDEO_CLIP_LAST_RESORT: routeMeta(MAS_TASKS.VIDEO_CLIP_LAST_RESORT).routes,
      FAST_CHAT: routeMeta(MAS_TASKS.FAST_CHAT).routes,
    },
  };
}
