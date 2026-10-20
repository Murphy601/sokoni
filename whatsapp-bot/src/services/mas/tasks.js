/**
 * MAS capability task IDs — business code calls these, never raw model slugs.
 * Primary Sokoni systems (Cloudinary, Groq chat, listing-generator, etc.) stay untouched;
 * MAS is shadow / assist / last-resort only.
 */
export const MAS_TASKS = Object.freeze({
  // Division 1 — Security
  JAILBREAK_DETECT: "JAILBREAK_DETECT",
  TOPIC_GUARD: "TOPIC_GUARD",
  CONTENT_SAFETY_TEXT: "CONTENT_SAFETY_TEXT",
  CONTENT_SAFETY_MULTIMODAL: "CONTENT_SAFETY_MULTIMODAL",
  SYNTHETIC_VIDEO_DETECT: "SYNTHETIC_VIDEO_DETECT",

  // Division 2 — Logistics (stubs until fleet telemetry exists)
  FLEET_ROUTE_OPT: "FLEET_ROUTE_OPT",
  ROUTE_PERCEPTION: "ROUTE_PERCEPTION",
  SPATIAL_BEV_MAP: "SPATIAL_BEV_MAP",

  // Division 3 — OCR / catalog digitize
  RECEIPT_OCR: "RECEIPT_OCR",
  DOCUMENT_PARSE: "DOCUMENT_PARSE",
  TABLE_EXTRACT: "TABLE_EXTRACT",
  PAGE_ELEMENTS: "PAGE_ELEMENTS",
  GRAPHIC_ISOLATE: "GRAPHIC_ISOLATE",
  VISUAL_METADATA: "VISUAL_METADATA",

  // Division 4 — Search / RAG
  TEXT_EMBED: "TEXT_EMBED",
  VISUAL_EMBED: "VISUAL_EMBED",
  SEARCH_RERANK: "SEARCH_RERANK",

  // Division 5 — Media (AFTER Cloudinary → HeyGen → Remotion only)
  IMAGE_GENERATE: "IMAGE_GENERATE",
  IMAGE_EDIT_FAST: "IMAGE_EDIT_FAST",
  IMAGE_TEXT_EDIT: "IMAGE_TEXT_EDIT",
  PCB_INSPECT: "PCB_INSPECT",
  VIDEO_SUPER_RES: "VIDEO_SUPER_RES",
  VIDEO_RELIGHT: "VIDEO_RELIGHT",
  PRODUCT_3D: "PRODUCT_3D",
  VIDEO_MOTION_SIM: "VIDEO_MOTION_SIM",
  /** Last-resort clip when Cloudinary + HeyGen + Remotion all failed */
  VIDEO_CLIP_LAST_RESORT: "VIDEO_CLIP_LAST_RESORT",

  // Division 6 — Voice
  STT_MULTILINGUAL: "STT_MULTILINGUAL",
  STT_ENGLISH_FAST: "STT_ENGLISH_FAST",
  AUDIO_DENOISE: "AUDIO_DENOISE",
  TTS_EXPRESSIVE: "TTS_EXPRESSIVE",
  TTS_VOICE_CLONE: "TTS_VOICE_CLONE",
  VOICE_ASSISTANT: "VOICE_ASSISTANT",
  TRANSLATE: "TRANSLATE",
  VIDEO_LIPSYNC: "VIDEO_LIPSYNC",
  VIDEO_SPEAKER_TRACK: "VIDEO_SPEAKER_TRACK",

  // Division 7 — Reasoning / orchestration
  ORCHESTRATOR: "ORCHESTRATOR",
  FAST_CHAT: "FAST_CHAT",
  FAST_TASK: "FAST_TASK",
  CODE_MAINTAINER: "CODE_MAINTAINER",
  REASONING_DISPUTE: "REASONING_DISPUTE",

  // Division 8 — Multimodal vision
  OMNI_UNDERSTAND: "OMNI_UNDERSTAND",
  PHYSICAL_REASON: "PHYSICAL_REASON",
  FAST_VISION: "FAST_VISION",
});

export const MAS_PHASE = Object.freeze({
  1: "shadow_background",
  2: "media_after_primary",
  3: "assistive_messaging",
  4: "transactional_shadow",
});
