#!/usr/bin/env node
/** Phase 3 — ffmpeg Ken Burns smoke (skips if ffmpeg missing). */
import { spawnSync } from "node:child_process";
import { makeKenBurnsClip } from "../src/services/media-clip.js";
import { config } from "../src/config.js";

const prevClip = process.env.STUDIO_CLIP_ENABLED;

async function main() {
  const which = spawnSync("sh", ["-c", "command -v ffmpeg"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.log("SKIP: ffmpeg not installed");
    return;
  }

  // Minimal 1×1 PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );

  process.env.STUDIO_CLIP_ENABLED = "false";
  const disabled = await makeKenBurnsClip(png, "image/png");
  if (disabled.ok || disabled.reason !== "clip_disabled") {
    throw new Error(`clip_disabled expected: ${JSON.stringify(disabled)}`);
  }

  process.env.STUDIO_CLIP_ENABLED = "true";
  const saved = { ...config.studio };
  config.studio = { ...saved, clipSeconds: 3, clipSize: "320x320" };
  const clip = await makeKenBurnsClip(png, "image/png");
  if (!clip.ok || !clip.buffer?.length || clip.mimeType !== "video/mp4") {
    throw new Error(`clip failed: ${JSON.stringify({ ok: clip.ok, reason: clip.reason, ms: clip.ms })}`);
  }
  console.log(`OK: media-clip ffmpeg Ken Burns (${clip.ms}ms, ${clip.buffer.length} bytes)`);
  config.studio = saved;
}

main()
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  })
  .finally(() => {
    if (prevClip === undefined) delete process.env.STUDIO_CLIP_ENABLED;
    else process.env.STUDIO_CLIP_ENABLED = prevClip;
  });
