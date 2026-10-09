/* DuoStage Workers — job state machine (async over the KV repository)
   pending -> (dev finish / cron sweep / vendor callback) -> succeeded | failed
   Credit hooks: reserve on create; settle consume on success; settle return
   on failure or moderation rejection. Zombie jobs (pending/running older
   than cfg.jobTimeoutMs) are failed + refunded by sweepJobs(), invoked from
   the Cron Trigger (workers/wrangler.toml [triggers]).
   Production: replace the dev finish path with vendor adapters
   (MiniMax H3 reference generation first — official /v2/video_generation
   supports prompt + reference video/images; then Kling 3.0 Omni via
   kling.ai/dev or resellers; Seedance 2.5 via BytePlus ModelArk or Replicate)
   behind submit(job)/poll(job) and call finishJob() from their callbacks. */

import * as credits from "./credits.js";

const VALID_ASPECTS = ["9:16", "16:9", "1:1"];
const VALID_DURATIONS = [5, 10, 15];

function hex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function costFor(cfg, model, quality, duration) {
  const m = cfg.creditTable && cfg.creditTable[model];
  if (!m) return null;
  const q = m[quality === "2k" ? "2k" : "768"];
  if (!q) return null;
  const c = q[duration];
  return typeof c === "number" ? c : null;
}

async function activeJobs(db, userId) {
  const rows = await db.all("jobs");
  return rows.filter((j) => j.userId === userId && (j.status === "pending" || j.status === "running"));
}

export async function createJob(db, cfg, user, params) {
  if (!params || !cfg.creditTable[params.model]) return { ok: false, error: "bad-model", status: 400 };
  const duration = Number(params.duration);
  if (!VALID_DURATIONS.includes(duration)) return { ok: false, error: "bad-duration", status: 400 };
  const quality = params.quality === "2k" ? "2k" : params.quality === "768" ? "768" : null;
  if (!quality) return { ok: false, error: "bad-quality", status: 400 };
  if (!VALID_ASPECTS.includes(params.aspect)) return { ok: false, error: "bad-aspect", status: 400 };
  const keys = [params.photo1, params.photo2];
  for (const k of keys) {
    const up = await db.get("uploads", String(k || ""));
    if (!up || up.userId !== user.id || up.status !== "ready") return { ok: false, error: "bad-photo", status: 400 };
  }
  const cost = costFor(cfg, params.model, quality, duration);
  if (cost == null) return { ok: false, error: "bad-config", status: 400 };
  if ((await activeJobs(db, user.id)).length >= cfg.maxActiveJobs) return { ok: false, error: "too-many-active", status: 429 };
  const id = "j_" + hex(crypto.getRandomValues(new Uint8Array(10)));
  const r = await credits.reserve(db, user.id, cost, id);
  if (!r.ok) return { ok: false, error: "insufficient", status: 402 };
  const job = {
    id, userId: user.id, model: params.model, duration_s: duration, quality, aspect: params.aspect,
    photo1: keys[0], photo2: keys[1], cost, status: "pending", vendor: "dev",
    error_code: null, render: null, created: Date.now(), finished: null,
  };
  await db.set("jobs", id, job);
  return { ok: true, job };
}

/* outcome: success | failed | rejected (moderation) */
export async function finishJob(db, cfg, jobId, outcome) {
  const job = await db.get("jobs", String(jobId || ""));
  if (!job) return { ok: false, error: "unknown-job", status: 404 };
  if (job.status !== "pending" && job.status !== "running") return { ok: false, error: "already-settled", status: 400 };
  job.finished = Date.now();
  if (outcome === "success") {
    job.status = "succeeded";
    await credits.settle(db, job.userId, job.id, "consume");
    const rid = "r_" + hex(crypto.getRandomValues(new Uint8Array(8)));
    await db.set("renders", rid, {
      id: rid, job_id: job.id, userId: job.userId,
      output_url: "/assets/sample-output.svg", thumb_url: "/assets/sample-output.svg",
      created: Date.now(), expires: Date.now() + cfg.renderTtlMs,
    });
    job.render = rid;
  } else {
    job.status = "failed";
    job.error_code = outcome === "rejected" ? "moderation" : "vendor-failed";
    await credits.settle(db, job.userId, job.id, "return");
  }
  await db.set("jobs", job.id, job);
  return { ok: true, job };
}

export async function sweepJobs(db, cfg, nowMs) {
  const now = nowMs || Date.now();
  const rows = await db.all("jobs");
  let swept = 0;
  for (const j of rows) {
    if ((j.status === "pending" || j.status === "running") && now - j.created > cfg.jobTimeoutMs) {
      await finishJob(db, cfg, j.id, "failed");
      swept++;
    }
  }
  return swept;
}

export async function listJobs(db, userId) {
  const rows = await db.all("jobs");
  return rows
    .filter((j) => j.userId === userId)
    .sort((a, b) => b.created - a.created)
    .map((j) => ({
      id: j.id, model: j.model, duration_s: j.duration_s, quality: j.quality, aspect: j.aspect,
      cost: j.cost, status: j.status, error_code: j.error_code, created: j.created, finished: j.finished,
      render: j.render || null,
    }));
}

/* enrich list entries with render urls (separate lookup keeps listJobs cheap) */
export async function listJobsWithRenders(db, userId) {
  const jobs = await listJobs(db, userId);
  for (const j of jobs) {
    if (j.render) {
      const r = await db.get("renders", j.render);
      j.render = r ? { output_url: r.output_url, thumb_url: r.thumb_url, expires: r.expires } : null;
    }
  }
  return jobs;
}

export { activeJobs };
