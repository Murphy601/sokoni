/**
 * MAS feature flags — all live assists off by default so primaries stay in charge.
 */
import { config } from "../../config.js";
import { MAS_TASKS } from "./tasks.js";

function truthy(v) {
  return v === true || /^(1|true|yes|on)$/i.test(String(v ?? "").trim());
}

export function masFlags() {
  const m = config.mas || {};
  return {
    enabled: m.enabled !== false,
    shadow: m.shadow !== false,
    mediaFallback: truthy(m.mediaFallback),
    voiceAssist: truthy(m.voiceAssist),
    moderationLive: truthy(m.moderationLive),
    chatFailover: truthy(m.chatFailover),
    transactionalShadow: truthy(m.transactionalShadow),
    timeoutMs: Number(m.timeoutMs) || 2000,
  };
}

/** Per-task live assist (beyond shadow). Env: MAS_LIVE_<TASK>=true */
export function isTaskLive(task) {
  const flags = masFlags();
  if (!flags.enabled) return false;
  const envKey = `MAS_LIVE_${String(task).toUpperCase()}`;
  if (truthy(process.env[envKey])) return true;

  if (
    task === MAS_TASKS.VIDEO_CLIP_LAST_RESORT ||
    task === MAS_TASKS.VIDEO_SUPER_RES ||
    task === MAS_TASKS.VIDEO_RELIGHT
  ) {
    return flags.mediaFallback;
  }
  if (
    task === MAS_TASKS.STT_MULTILINGUAL ||
    task === MAS_TASKS.STT_ENGLISH_FAST ||
    task === MAS_TASKS.TRANSLATE ||
    task === MAS_TASKS.AUDIO_DENOISE
  ) {
    return flags.voiceAssist;
  }
  if (
    task === MAS_TASKS.JAILBREAK_DETECT ||
    task === MAS_TASKS.TOPIC_GUARD ||
    task === MAS_TASKS.CONTENT_SAFETY_TEXT ||
    task === MAS_TASKS.CONTENT_SAFETY_MULTIMODAL ||
    task === MAS_TASKS.SYNTHETIC_VIDEO_DETECT
  ) {
    return flags.moderationLive;
  }
  if (task === MAS_TASKS.FAST_CHAT) return flags.chatFailover;
  // Phase 4 transactional advisors never go live-write
  return false;
}

export function canShadow(task) {
  const flags = masFlags();
  if (!flags.enabled || !flags.shadow) return false;
  const high = [
    MAS_TASKS.FLEET_ROUTE_OPT,
    MAS_TASKS.ROUTE_PERCEPTION,
    MAS_TASKS.SPATIAL_BEV_MAP,
    MAS_TASKS.REASONING_DISPUTE,
    MAS_TASKS.PHYSICAL_REASON,
    MAS_TASKS.ORCHESTRATOR,
    MAS_TASKS.CODE_MAINTAINER,
  ];
  if (high.includes(task)) return Boolean(flags.transactionalShadow);
  return true;
}
