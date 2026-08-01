#!/usr/bin/env node
/**
 * Phase 0 — Opt-in media studio benchmark (ffmpeg always; rembg only if REMBG_URL set).
 *
 * Safe: does NOT import whatsapp-bot services, does NOT start the bot,
 * does NOT change Photoroom / listing-studio production paths.
 *
 * Usage (repo root):
 *   node scripts/benchmark-media-studio.mjs
 *   REMBG_URL=http://127.0.0.1:7000/api/remove node scripts/benchmark-media-studio.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const REMBG_URL = (process.env.REMBG_URL || "").trim();
const WORK = mkdtempSync(path.join(tmpdir(), "sokoni-media-bench-"));

function which(bin) {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(cmd, args, {
      stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "ignore",
      ...opts.spawn,
    });
    let stderr = "";
    if (opts.capture) child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      resolve({ ok: false, ms: performance.now() - t0, error: err.message, stderr });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        ms: performance.now() - t0,
        code,
        stderr: stderr.slice(-800),
      });
    });
  });
}

async function makeTestPng(outPath) {
  // Synthetic product-like frame (no extra deps): green canvas + red “item”
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x287850:s=1080x1080",
    "-f",
    "lavfi",
    "-i",
    "color=c=0xc82828:s=480x680",
    "-filter_complex",
    "[0][1]overlay=(W-w)/2:(H-h)/2",
    "-frames:v",
    "1",
    outPath,
  ];
  return run(FFMPEG, args, { capture: true });
}

async function benchFfmpegClip(pngPath, mp4Path) {
  const args = [
    "-y",
    "-loop",
    "1",
    "-i",
    pngPath,
    "-vf",
    "zoompan=z='min(zoom+0.0015,1.15)':d=125:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1080",
    "-c:v",
    "libx264",
    "-t",
    "5",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4Path,
  ];
  return run(FFMPEG, args, { capture: true });
}

async function benchRembgHttp(pngPath) {
  if (!REMBG_URL) {
    return {
      skipped: true,
      reason: "REMBG_URL unset — Phase 1 sidecar not required for Phase 0",
    };
  }
  const buf = readFileSync(pngPath);
  const t0 = performance.now();
  try {
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "image/png" }), "bench.png");
    // Some rembg servers expect "image" or raw body — try common field names.
    const res = await fetch(REMBG_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const ms = performance.now() - t0;
    const ct = res.headers.get("content-type") || "";
    const ab = await res.arrayBuffer();
    return {
      skipped: false,
      ok: res.ok && ab.byteLength > 0,
      ms,
      status: res.status,
      contentType: ct,
      bytesOut: ab.byteLength,
    };
  } catch (err) {
    return {
      skipped: false,
      ok: false,
      ms: performance.now() - t0,
      error: err.message,
    };
  }
}

function hostSummary() {
  const mem = spawnSync("free", ["-m"], { encoding: "utf8" });
  const cpus = spawnSync("nproc", [], { encoding: "utf8" });
  return {
    ffmpeg: which(FFMPEG) || "(not found)",
    ffprobe: which(FFPROBE) || "(not found)",
    docker: which("docker") || "(not found)",
    nproc: (cpus.stdout || "").trim() || "?",
    free_m: (mem.stdout || "").split("\n").slice(0, 2).join(" | "),
  };
}

async function main() {
  console.log("Sokoni media studio benchmark (Phase 0 — opt-in, non-production)\n");
  const host = hostSummary();
  console.log("Host:");
  for (const [k, v] of Object.entries(host)) console.log(`  ${k}: ${v}`);
  console.log(`  workdir: ${WORK}`);
  console.log("");

  if (!which(FFMPEG)) {
    console.error("FAIL: ffmpeg not on PATH. Install ffmpeg before Phase 3.");
    process.exit(2);
  }

  const png = path.join(WORK, "bench-product.png");
  const mp4 = path.join(WORK, "bench-product.mp4");

  const gen = await makeTestPng(png);
  if (!gen.ok || !existsSync(png)) {
    console.error("FAIL: could not generate test PNG via ffmpeg", gen.error || gen.stderr);
    process.exit(1);
  }
  console.log(`test_png_bytes=${readFileSync(png).length} gen_ms=${gen.ms.toFixed(0)}`);

  const clip = await benchFfmpegClip(png, mp4);
  if (!clip.ok || !existsSync(mp4)) {
    console.error("FAIL: ffmpeg Ken Burns clip", clip.error || clip.stderr);
    process.exit(1);
  }
  const mp4Bytes = readFileSync(mp4).length;
  console.log(`ffmpeg_kenburns_ms=${clip.ms.toFixed(0)} mp4_bytes=${mp4Bytes} duration_target_s=5`);

  const rembg = await benchRembgHttp(png);
  if (rembg.skipped) {
    console.log(`rembg: SKIPPED (${rembg.reason})`);
  } else if (rembg.ok) {
    console.log(
      `rembg_http_ms=${rembg.ms.toFixed(0)} status=${rembg.status} out_bytes=${rembg.bytesOut} type=${rembg.contentType}`
    );
  } else {
    console.log(
      `rembg_http: FAIL ms=${rembg.ms?.toFixed?.(0) || "?"} ${rembg.error || `status=${rembg.status}`}`
    );
    console.log("  (Phase 0 OK to fail rembg — record this on the bot VM after Phase 1)");
  }

  // Keep artifacts only if BENCH_KEEP=1
  if (process.env.BENCH_KEEP === "1") {
    console.log(`\nKept workdir (BENCH_KEEP=1): ${WORK}`);
  } else {
    rmSync(WORK, { recursive: true, force: true });
  }

  console.log("\nPhase 0 checklist:");
  console.log("  [x] cover-only scope (document in docs/MEDIA_STUDIO_PLAN.md)");
  console.log("  [x] keep original vs cleaned seller toggle");
  console.log("  [x] async/worker required before multi-seller rembg (Phase 2)");
  console.log("  [ ] paste bot-VM ffmpeg + rembg numbers into MEDIA_STUDIO_PLAN.md after Phase 1");
  console.log("\nDone — production listing-studio untouched.");
}

main().catch((err) => {
  console.error(err);
  try {
    rmSync(WORK, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
