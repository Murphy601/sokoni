/**
 * Phase 2/5 — In-process media job queue (cleanup + clips).
 * Keeps rembg/ffmpeg off the WhatsApp webhook path; limits concurrency so the bot VM stays responsive.
 */
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

/** @typedef {"queued"|"running"|"done"|"failed"} JobStatus */

/**
 * @typedef {object} MediaJob
 * @property {string} id
 * @property {"cleanup"|"clip"} type
 * @property {JobStatus} status
 * @property {number} createdAt
 * @property {number} [startedAt]
 * @property {number} [finishedAt]
 * @property {any} [result]
 * @property {string} [error]
 * @property {() => Promise<any>} run
 */

/** @type {Map<string, MediaJob>} */
const jobs = new Map();
/** @type {MediaJob[]} */
const queue = [];
let active = 0;

function concurrency() {
  return Math.max(1, Math.min(3, Number(config.studio?.concurrency) || 1));
}

function jobTtlMs() {
  return Number(config.studio?.jobTtlMs) || 15 * 60_000;
}

function maxJobs() {
  return Number(config.studio?.maxJobs) || 40;
}

function prune() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status === "queued" || job.status === "running") continue;
    if (now - (job.finishedAt || job.createdAt) > jobTtlMs()) jobs.delete(id);
  }
  while (jobs.size > maxJobs()) {
    const oldest = [...jobs.values()]
      .filter((j) => j.status === "done" || j.status === "failed")
      .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0))[0];
    if (!oldest) break;
    jobs.delete(oldest.id);
  }
}

function pump() {
  while (active < concurrency() && queue.length) {
    const job = queue.shift();
    if (!job) break;
    active += 1;
    job.status = "running";
    job.startedAt = Date.now();
    Promise.resolve()
      .then(() => job.run())
      .then((result) => {
        job.result = result;
        job.status = "done";
        job.finishedAt = Date.now();
      })
      .catch((err) => {
        job.error = err?.message || String(err);
        job.status = "failed";
        job.finishedAt = Date.now();
        console.warn(`[media-jobs] ${job.type} ${job.id} failed:`, job.error);
      })
      .finally(() => {
        active -= 1;
        prune();
        pump();
      });
  }
}

/**
 * @param {"cleanup"|"clip"} type
 * @param {() => Promise<any>} run
 */
export function enqueueMediaJob(type, run) {
  prune();
  const id = randomUUID();
  /** @type {MediaJob} */
  const job = {
    id,
    type,
    status: "queued",
    createdAt: Date.now(),
    run,
  };
  jobs.set(id, job);
  queue.push(job);
  pump();
  return job;
}

export function getMediaJob(id) {
  prune();
  return jobs.get(id) || null;
}

export function mediaJobsSnapshot() {
  prune();
  return {
    active,
    queued: queue.length,
    concurrency: concurrency(),
    tracked: jobs.size,
  };
}

/**
 * Wait until job finishes or timeout. Does not block the event loop (polls).
 * @param {MediaJob} job
 * @param {number} [timeoutMs]
 */
export async function awaitMediaJob(job, timeoutMs) {
  const limit = Number(timeoutMs) || Number(config.studio?.jobWaitMs) || 55_000;
  const started = Date.now();
  while (Date.now() - started < limit) {
    if (job.status === "done") return { ok: true, job };
    if (job.status === "failed") return { ok: false, job, error: job.error || "job_failed" };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: false, job, error: "job_timeout" };
}

/** Test helper — clear queue state */
export function _resetMediaJobsForTests() {
  queue.length = 0;
  jobs.clear();
  active = 0;
}
