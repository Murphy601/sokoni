/**
 * Default capability → provider routes (env MAS_ROUTE_<TASK> overrides).
 * Format: provider:model,provider:model
 * Providers: nvidia | openrouter | groq | heuristic | stub
 *
 * Heuristic = cheap local rules (no API) for shadow safety checks.
 * Stub = explicit degrade (never crashes caller).
 */
import { MAS_TASKS } from "./tasks.js";
import { agentsForTask } from "./agent-catalog.js";

const DEFAULT_ROUTES = {
  [MAS_TASKS.JAILBREAK_DETECT]: ["heuristic:jailbreak-rules", "stub:moderation"],
  [MAS_TASKS.TOPIC_GUARD]: ["heuristic:topic-rules", "stub:moderation"],
  [MAS_TASKS.CONTENT_SAFETY_TEXT]: ["heuristic:safety-rules", "stub:moderation"],
  [MAS_TASKS.CONTENT_SAFETY_MULTIMODAL]: ["nvidia:llama-3.2-11b-vision-instruct", "stub:moderation"],
  [MAS_TASKS.SYNTHETIC_VIDEO_DETECT]: ["stub:synthetic-video"],

  [MAS_TASKS.FLEET_ROUTE_OPT]: ["stub:cuopt"],
  [MAS_TASKS.ROUTE_PERCEPTION]: ["stub:streampetr"],
  [MAS_TASKS.SPATIAL_BEV_MAP]: ["stub:bevformer"],

  [MAS_TASKS.RECEIPT_OCR]: [
    "nvidia:meta/llama-3.2-11b-vision-instruct",
    "openrouter:google/gemma-4-31b-it:free",
    "stub:ocr",
  ],
  [MAS_TASKS.DOCUMENT_PARSE]: [
    "nvidia:meta/llama-3.2-11b-vision-instruct",
    "stub:ocr",
  ],
  [MAS_TASKS.TABLE_EXTRACT]: ["nvidia:meta/llama-3.2-11b-vision-instruct", "stub:ocr"],
  [MAS_TASKS.PAGE_ELEMENTS]: ["nvidia:meta/llama-3.2-11b-vision-instruct", "stub:ocr"],
  [MAS_TASKS.GRAPHIC_ISOLATE]: ["stub:graphic"],
  [MAS_TASKS.VISUAL_METADATA]: [
    "nvidia:meta/llama-3.2-11b-vision-instruct",
    "openrouter:google/gemma-4-31b-it:free",
    "stub:ocr",
  ],

  [MAS_TASKS.TEXT_EMBED]: ["openrouter:openai/text-embedding-3-small", "stub:embed"],
  [MAS_TASKS.VISUAL_EMBED]: ["stub:visual-embed"],
  [MAS_TASKS.SEARCH_RERANK]: ["stub:rerank"],

  [MAS_TASKS.IMAGE_GENERATE]: ["stub:flux"],
  [MAS_TASKS.IMAGE_EDIT_FAST]: ["stub:flux-edit"],
  [MAS_TASKS.IMAGE_TEXT_EDIT]: ["stub:qwen-image"],
  [MAS_TASKS.PCB_INSPECT]: ["nvidia:meta/llama-3.2-11b-vision-instruct", "stub:pcb"],
  [MAS_TASKS.VIDEO_SUPER_RES]: ["stub:vsr"],
  [MAS_TASKS.VIDEO_RELIGHT]: ["stub:relight"],
  [MAS_TASKS.PRODUCT_3D]: ["stub:trellis"],
  [MAS_TASKS.VIDEO_MOTION_SIM]: ["stub:cosmos-transfer"],
  [MAS_TASKS.VIDEO_CLIP_LAST_RESORT]: ["stub:clip-last-resort"],

  [MAS_TASKS.STT_MULTILINGUAL]: ["openrouter:openai/whisper-large-v3-turbo", "stub:stt"],
  [MAS_TASKS.STT_ENGLISH_FAST]: ["groq:whisper-large-v3", "openrouter:openai/whisper-large-v3-turbo", "stub:stt"],
  [MAS_TASKS.AUDIO_DENOISE]: ["stub:denoise"],
  [MAS_TASKS.TTS_EXPRESSIVE]: ["stub:tts"],
  [MAS_TASKS.TTS_VOICE_CLONE]: ["stub:tts-clone"],
  [MAS_TASKS.VOICE_ASSISTANT]: ["stub:voicechat"],
  [MAS_TASKS.TRANSLATE]: ["groq:openai/gpt-oss-20b", "openrouter:google/gemma-4-31b-it:free", "stub:translate"],
  [MAS_TASKS.VIDEO_LIPSYNC]: ["stub:lipsync"],
  [MAS_TASKS.VIDEO_SPEAKER_TRACK]: ["stub:speaker-track"],

  [MAS_TASKS.ORCHESTRATOR]: ["stub:orchestrator"],
  [MAS_TASKS.FAST_CHAT]: ["nvidia:meta/llama-3.1-8b-instruct", "groq:openai/gpt-oss-20b", "stub:chat"],
  [MAS_TASKS.FAST_TASK]: ["groq:openai/gpt-oss-20b", "stub:task"],
  [MAS_TASKS.CODE_MAINTAINER]: ["stub:code"],
  [MAS_TASKS.REASONING_DISPUTE]: ["groq:openai/gpt-oss-120b", "stub:dispute"],

  [MAS_TASKS.OMNI_UNDERSTAND]: [
    "nvidia:meta/llama-3.2-11b-vision-instruct",
    "openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "stub:omni",
  ],
  [MAS_TASKS.PHYSICAL_REASON]: ["stub:cosmos-reason"],
  [MAS_TASKS.FAST_VISION]: [
    "nvidia:meta/llama-3.2-11b-vision-instruct",
    "nvidia:microsoft/phi-3.5-vision-instruct",
    "stub:vision",
  ],
};

function parseRoute(s) {
  const raw = String(s || "").trim();
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx < 0) return { provider: raw, model: "" };
  return { provider: raw.slice(0, idx).trim().toLowerCase(), model: raw.slice(idx + 1).trim() };
}

export function routesForTask(task) {
  const envKey = `MAS_ROUTE_${String(task).toUpperCase()}`;
  const fromEnv = String(process.env[envKey] || "").trim();
  const list = fromEnv
    ? fromEnv.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ROUTES[task] || ["stub:default"];
  return list.map(parseRoute).filter(Boolean);
}

export function routeMeta(task) {
  return {
    task,
    agents: agentsForTask(task).map((a) => a.id),
    routes: routesForTask(task),
  };
}

export { DEFAULT_ROUTES };
