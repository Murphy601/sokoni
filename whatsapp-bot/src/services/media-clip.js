/**
 * Phase 3 — ffmpeg Ken Burns clip from a still (cover PNG/JPEG).
 * Never throws to callers in a way that should fail publish — returns { ok:false }.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "../config.js";

function ffmpegBin() {
  return process.env.FFMPEG_PATH || config.studio?.ffmpegPath || "ffmpeg";
}

function isClipEnabled() {
  if (process.env.STUDIO_CLIP_ENABLED != null && process.env.STUDIO_CLIP_ENABLED !== "") {
    return String(process.env.STUDIO_CLIP_ENABLED).toLowerCase() === "true";
  }
  return Boolean(config.studio?.clipEnabled);
}

/**
 * @param {Buffer} imageBuffer
 * @param {string} [mimeType]
 * @returns {Promise<{ ok: boolean, buffer?: Buffer, mimeType?: string, reason?: string, ms?: number }>}
 */
export async function makeKenBurnsClip(imageBuffer, mimeType = "image/png") {
  if (!isClipEnabled()) {
    return { ok: false, reason: "clip_disabled" };
  }
  if (!imageBuffer?.length) {
    return { ok: false, reason: "missing_image" };
  }

  const work = mkdtempSync(path.join(tmpdir(), "sokoni-clip-"));
  const ext = /png/i.test(mimeType) ? "png" : "jpg";
  const input = path.join(work, `in.${ext}`);
  const output = path.join(work, "out.mp4");
  writeFileSync(input, imageBuffer);

  const seconds = Math.max(3, Math.min(8, Number(config.studio.clipSeconds) || 5));
  // 25fps * seconds ≈ zoompan duration frames
  const frames = Math.round(25 * seconds);
  const size = config.studio.clipSize || "1080x1080";
  const args = [
    "-y",
    "-loop",
    "1",
    "-i",
    input,
    "-vf",
    `zoompan=z='min(zoom+0.0015,1.15)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${size}:fps=25`,
    "-c:v",
    "libx264",
    "-t",
    String(seconds),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ];

  const t0 = Date.now();
  const timeoutMs = Number(config.studio.clipTimeoutMs) || 45_000;

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegBin(), args, { stdio: "ignore" });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("ffmpeg_timeout"));
      }, timeoutMs);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg_exit_${code}`));
      });
    });

    if (!existsSync(output)) return { ok: false, reason: "empty_result", ms: Date.now() - t0 };
    const buffer = readFileSync(output);
    if (!buffer.length) return { ok: false, reason: "empty_result", ms: Date.now() - t0 };
    return { ok: true, buffer, mimeType: "video/mp4", ms: Date.now() - t0 };
  } catch (err) {
    console.warn("[media-clip] ffmpeg failed:", err.message);
    return { ok: false, reason: "ffmpeg_failed", ms: Date.now() - t0 };
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
