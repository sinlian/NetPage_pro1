/* DuoStage backend skeleton — job state machine
   pending -> (dev finish / sweep) -> succeeded | failed
   Credit hooks: reserve on create; settle consume on success; settle return
   on failure or moderation rejection. Zombie jobs (pending/running older
   than cfg.jobTimeoutMs) are failed + refunded by sweepJobs().
   Production: replace the dev finish path with vendor adapters
   (MiniMax H3 reference generation first, then Kling 3.0 Omni / Seedance 2.5)
   behind submit(job)/poll(job) and call finishJob() from their callbacks. */
"use strict";
const crypto = require("crypto");
const credits = require("./credits");

const VALID_ASPECTS = ["9:16", "16:9", "1:1"];
const VALID_DURATIONS = [5, 10, 15];

function costFor(cfg, model, quality, duration) {
  const m = cfg.creditTable && cfg.creditTable[model];
  if (!m) return null;
  const q = m[quality === "2k" ? "2k" : "768"];
  if (!q) return null;
  const c = q[duration];
  return typeof c === "number" ? c : null;
}

function activeJobs(db, userId) {
  return db.all("jobs").filter((j) => j.userId === userId && (j.status === "pending" || j.status === "running"));
}

function createJob(db, cfg, user, params) {
  if (!params || !cfg.creditTable[params.model]) return { ok: false, error: "bad-model", status: 400 };
  const duration = Number(params.duration);
  if (!VALID_DURATIONS.includes(duration)) return { ok: false, error: "bad-duration", status: 400 };
  const quality = params.quality === "2k" ? "2k" : params.quality === "768" ? "768" : null;
  if (!quality) return { ok: false, error: "bad-quality", status: 400 };
  if (!VALID_ASPECTS.includes(params.aspect)) return { ok: false, error: "bad-aspect", status: 400 };
  const keys = [params.photo1, params.photo2];
  for (let i = 0; i < keys.length; i++) {
    const up = db.get("uploads", String(keys[i] || ""));
    if (!up || up.userId !== user.id || up.status !== "ready") return { ok: false, error: "bad-photo", status: 400 };
  }
  const cost = costFor(cfg, params.model, quality, duration);
  if (cost == null) return { ok: false, error: "bad-config", status: 400 };
  if (activeJobs(db, user.id).length >= cfg.maxActiveJobs) return { ok: false, error: "too-many-active", status: 429 };
  const id = "j_" + crypto.randomBytes(10).toString("hex");
  const r = credits.reserve(db, user.id, cost, id);
  if (!r.ok) return { ok: false, error: "insufficient", status: 402 };
  const job = {
    id, userId: user.id, model: params.model, duration_s: duration, quality, aspect: params.aspect,
    photo1: keys[0], photo2: keys[1], cost, status: "pending", vendor: "dev",
    error_code: null, render: null, created: Date.now(), finished: null,
  };
  db.set("jobs", id, job);
  return { ok: true, job };
}

/* outcome: success | failed | rejected (moderation) */
function finishJob(db, cfg, jobId, outcome) {
  const job = db.get("jobs", String(jobId || ""));
  if (!job) return { ok: false, error: "unknown-job", status: 404 };
  if (job.status !== "pending" && job.status !== "running") return { ok: false, error: "already-settled", status: 400 };
  job.finished = Date.now();
  if (outcome === "success") {
    job.status = "succeeded";
    credits.settle(db, job.userId, job.id, "consume");
    const rid = "r_" + crypto.randomBytes(8).toString("hex");
    db.set("renders", rid, {
      id: rid, job_id: job.id, userId: job.userId,
      output_url: "/assets/sample-output.svg", thumb_url: "/assets/sample-output.svg",
      created: Date.now(), expires: Date.now() + cfg.renderTtlMs,
    });
    job.render = rid;
  } else {
    job.status = "failed";
    job.error_code = outcome === "rejected" ? "moderation" : "vendor-failed";
    credits.settle(db, job.userId, job.id, "return");
  }
  db.set("jobs", job.id, job);
  return { ok: true, job };
}

function sweepJobs(db, cfg, nowMs) {
  const now = nowMs || Date.now();
  let swept = 0;
  db.all("jobs").forEach((j) => {
    if ((j.status === "pending" || j.status === "running") && now - j.created > cfg.jobTimeoutMs) {
      finishJob(db, cfg, j.id, "failed");
      swept++;
    }
  });
  return swept;
}

function listJobs(db, userId) {
  return db.all("jobs")
    .filter((j) => j.userId === userId)
    .sort((a, b) => b.created - a.created)
    .map((j) => {
      const render = j.render ? db.get("renders", j.render) : null;
      return {
        id: j.id, model: j.model, duration_s: j.duration_s, quality: j.quality, aspect: j.aspect,
        cost: j.cost, status: j.status, error_code: j.error_code, created: j.created, finished: j.finished,
        render: render ? { output_url: render.output_url, thumb_url: render.thumb_url, expires: render.expires } : null,
      };
    });
}

module.exports = { createJob, finishJob, sweepJobs, listJobs, costFor, activeJobs };
