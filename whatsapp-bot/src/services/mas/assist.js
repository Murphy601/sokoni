/**
 * Phase 2–3 assist helpers — only after primary systems fail / when flags on.
 * Cloudinary → HeyGen → Remotion remain the clip stack; MAS is last resort only.
 */
import { executeTask } from "./execute-task.js";
import { masFlags } from "./flags.js";
import { MAS_TASKS } from "./tasks.js";

/**
 * Phase 2: call ONLY after Cloudinary Ken Burns AND HeyGen AND Remotion all failed.
 * Returns null unless MAS_ENABLE_MEDIA_FALLBACK=true and a non-stub route succeeds
 * with a videoUrl (most NIM video models are stubbed until keys/endpoints exist).
 */
export async function tryMasClipLastResort(imageUrls = [], meta = {}) {
  const flags = masFlags();
  if (!flags.enabled || !flags.mediaFallback) return null;
  const list = (Array.isArray(imageUrls) ? imageUrls : []).filter((u) => /^https?:\/\//i.test(String(u)));
  if (!list.length) return null;

  console.log(
    "[mas-assist] VIDEO_CLIP_LAST_RESORT after Cloudinary→HeyGen→Remotion exhausted",
    meta.reason || ""
  );
  const result = await executeTask(
    MAS_TASKS.VIDEO_CLIP_LAST_RESORT,
    {
      text: `Generate or recover a short product listing clip URL from stills (last resort only). Images: ${list.slice(0, 3).join(", ")}`,
      imageUrl: list[0],
      imageUrls: list,
      ...meta,
    },
    { mode: "assist", timeoutMs: Math.max(flags.timeoutMs, 8000) }
  );

  const url = result.videoUrl || result.url || null;
  if (result.ok && url) {
    return { videoUrl: url, videoKind: "mas_last_resort", mas: result };
  }
  // Soft enhance shadows (do not block)
  void executeTask(MAS_TASKS.VIDEO_SUPER_RES, { imageUrls: list }, { mode: "shadow" }).catch(() => {});
  void executeTask(MAS_TASKS.VIDEO_RELIGHT, { imageUrls: list }, { mode: "shadow" }).catch(() => {});
  return null;
}

/**
 * Phase 3: STT assist when primary Whisper/OpenRouter transcription failed.
 */
export async function tryMasSttAssist({ audioBuffer, mimeType, filename } = {}) {
  const flags = masFlags();
  if (!flags.enabled || !flags.voiceAssist || !audioBuffer?.length) return null;
  for (const task of [MAS_TASKS.STT_ENGLISH_FAST, MAS_TASKS.STT_MULTILINGUAL]) {
    const result = await executeTask(
      task,
      { audioBuffer, mimeType, filename },
      { mode: "assist", timeoutMs: Math.max(flags.timeoutMs, 20_000) }
    );
    if (result.ok && result.text) {
      console.log(`[mas-assist] STT via ${result.provider}/${result.model}`);
      return { text: result.text, mas: result };
    }
  }
  return null;
}

/**
 * Phase 3: chat failover only when primary llm-router chain is empty/failed.
 */
export async function tryMasChatFailover(messages = []) {
  const flags = masFlags();
  if (!flags.enabled || !flags.chatFailover) return null;
  const text = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n")
    .slice(-4000);
  const result = await executeTask(
    MAS_TASKS.FAST_CHAT,
    { text, systemHint: "You are Sokoni WhatsApp shop assistant. Brief KES answers. Primary chat providers failed." },
    { mode: "assist", timeoutMs: Math.max(flags.timeoutMs, 12_000) }
  );
  if (result.ok && result.content) return { content: result.content, mas: result };
  return null;
}

/**
 * Phase 3: optional live moderation gate (off by default → use shadowInboundText).
 * Returns { blocked, reason } when moderationLive is on.
 */
export async function tryMasModerationGate(text) {
  const flags = masFlags();
  if (!flags.enabled || !flags.moderationLive) return { blocked: false, skipped: true };
  const jail = await executeTask(MAS_TASKS.JAILBREAK_DETECT, { text }, { mode: "live", timeoutMs: 800 });
  if (jail.blocked) return { blocked: true, reason: "jailbreak", mas: jail };
  const safe = await executeTask(MAS_TASKS.CONTENT_SAFETY_TEXT, { text }, { mode: "live", timeoutMs: 800 });
  if (safe.blocked) return { blocked: true, reason: "unsafe", mas: safe };
  return { blocked: false, mas: { jail, safe } };
}
