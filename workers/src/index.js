/* DuoStage — Cloudflare Workers entry
   fetch:  /api/* route table (same contract as the legacy Node mirror),
           everything else -> Static Assets binding (the site in ./public)
   scheduled: zombie-job sweep (Cron Trigger, wrangler.toml [triggers])
   Bindings: DS_KV (repository), DS_R2 (upload bytes), ASSETS (static site)
   Secrets:  DS_SECRET (session HMAC) via `wrangler secret put DS_SECRET` */

import { loadConfig } from "./config.js";
import { createKvDb } from "./db.js";
import { putObject } from "./r2.js";
import * as auth from "./auth.js";
import * as credits from "./credits.js";
import * as jobs from "./jobs.js";
import { createDevInboxMailer, createDevPayAdapter } from "./adapters.js";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function readJsonBody(request, limitBytes = 64 * 1024) {
  const buf = await request.arrayBuffer();
  if (buf.byteLength > limitBytes) throw new Error("body-too-large");
  if (buf.byteLength === 0) return {};
  return JSON.parse(new TextDecoder().decode(buf));
}

export async function handleApi(request, env, cfg, db, url, pathname) {
  const mailer = createDevInboxMailer(db);
  const pay = createDevPayAdapter();

  async function sessionUser() {
    const session = await auth.verifySession(db, cfg, auth.bearerToken(request));
    if (!session) return null;
    const user = await db.get("users", session.userId);
    return user ? { session, user } : null;
  }

  /* idempotent payment confirmation (stands in for the gateway webhook) */
  async function confirmOrder(orderId, outcome) {
    const order = await db.get("orders", orderId);
    if (!order) return { httpStatus: 404, ok: false, error: "unknown-order" };
    if (order.status !== "pending") return { ok: true, status: order.status, already: true };
    if (outcome === "success") {
      order.status = "paid";
      order.paidAt = Date.now();
      await db.set("orders", order.id, order);
      await credits.grant(db, order.userId, order.credits, "order", order.id);
      return { ok: true, status: "paid" };
    }
    order.status = "cancelled";
    await db.set("orders", order.id, order);
    return { ok: true, status: "cancelled" };
  }

  /* --- health --- */
  if (pathname === "/api/health" && request.method === "GET") {
    return json(200, { ok: true, mode: "workers", mailer: mailer.name, pay: pay.name });
  }

  /* --- pricing config (single source of truth for the calculator) --- */
  if (pathname === "/api/pricing" && request.method === "GET") {
    return json(200, { ok: true, packs: cfg.packs, creditTable: cfg.creditTable });
  }

  /* --- credit balance & ledger (bearer) --- */
  if (pathname === "/api/credits" && request.method === "GET") {
    const su = await sessionUser();
    if (!su) return json(401, { ok: false, error: "unauthorized" });
    return json(200, Object.assign({ ok: true }, await credits.summary(db, su.user.id)));
  }

  /* --- create checkout (bearer) --- */
  if (pathname === "/api/checkout" && request.method === "POST") {
    const su = await sessionUser();
    if (!su) return json(401, { ok: false, error: "unauthorized" });
    let body;
    try { body = await readJsonBody(request); } catch (e) { return json(400, { ok: false, error: "bad-json" }); }
    const pack = cfg.packs[body.pack];
    if (!pack) return json(400, { ok: false, error: "unknown-pack" });
    const id = "o_" + auth.createMagicToken().slice(0, 16);
    const order = { id, userId: su.user.id, pack: body.pack, usd: pack.usd, credits: pack.credits, status: "pending", created: Date.now() };
    await db.set("orders", id, order);
    const origin = new URL(request.url).origin;
    const co = await pay.createCheckout(order, origin);
    return json(200, { ok: true, orderId: id, checkoutUrl: co.checkoutUrl });
  }

  /* --- payment confirmation (dev stand-in for the gateway webhook) --- */
  if (pathname === "/api/pay/confirm" && request.method === "POST") {
    let body;
    try { body = await readJsonBody(request); } catch (e) { return json(400, { ok: false, error: "bad-json" }); }
    const outcome = body.outcome === "cancel" ? "cancel" : "success";
    const r = await confirmOrder(String(body.orderId || ""), outcome);
    const httpStatus = r.httpStatus || 200;
    delete r.httpStatus;
    return json(httpStatus, r);
  }

  /* --- uploads: presign + direct put (dev stand-in for R2 presigned URLs) --- */
  if (pathname === "/api/uploads/presign" && request.method === "POST") {
    const su = await sessionUser();
    if (!su) return json(401, { ok: false, error: "unauthorized" });
    let body;
    try { body = await readJsonBody(request); } catch (e) { return json(400, { ok: false, error: "bad-json" }); }
    const ALLOWED = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    if (!ALLOWED[body.mime]) return json(400, { ok: false, error: "bad-type" });
    const size = Number(body.size);
    if (!(size > 0) || size > cfg.maxUploadBytes) return json(400, { ok: false, error: "bad-size" });
    const id = "u_" + auth.createMagicToken().slice(0, 16);
    await db.set("uploads", id, { id, userId: su.user.id, slot: Number(body.slot) === 2 ? 2 : 1, mime: body.mime, size, ext: ALLOWED[body.mime], status: "pending", created: Date.now() });
    return json(200, { ok: true, uploadId: id, putUrl: "/api/uploads/put/" + id, maxBytes: cfg.maxUploadBytes });
  }
  const putMatch = pathname.match(/^\/api\/uploads\/put\/([A-Za-z0-9_-]+)$/);
  if (putMatch && request.method === "PUT") {
    const rec = await db.get("uploads", putMatch[1]);
    if (!rec || rec.status !== "pending") return json(404, { ok: false, error: "unknown-upload" });
    const buf = await request.arrayBuffer();
    if (buf.byteLength > cfg.maxUploadBytes) return json(413, { ok: false, error: "too-large" });
    if (buf.byteLength === 0) return json(400, { ok: false, error: "empty-body" });
    try {
      await putObject(env.DS_R2, rec.id + "." + rec.ext, buf, rec.mime);
    } catch (e) {
      return json(500, { ok: false, error: "write-failed" });
    }
    rec.status = "ready";
    rec.stored = buf.byteLength;
    await db.set("uploads", rec.id, rec);
    return json(200, { ok: true, key: rec.id });
  }

  /* --- jobs: create + list (bearer) --- */
  if (pathname === "/api/jobs" && request.method === "POST") {
    const su = await sessionUser();
    if (!su) return json(401, { ok: false, error: "unauthorized" });
    let body;
    try { body = await readJsonBody(request); } catch (e) { return json(400, { ok: false, error: "bad-json" }); }
    const r = await jobs.createJob(db, cfg, su.user, body);
    if (!r.ok) return json(r.status, { ok: false, error: r.error });
    return json(200, { ok: true, jobId: r.job.id, status: r.job.status, cost: r.job.cost });
  }
  if (pathname === "/api/jobs" && request.method === "GET") {
    const su = await sessionUser();
    if (!su) return json(401, { ok: false, error: "unauthorized" });
    return json(200, { ok: true, jobs: await jobs.listJobsWithRenders(db, su.user.id) });
  }

  /* --- dev-only job control (stands in for vendor callbacks) --- */
  if (pathname === "/api/dev/jobs/finish" && request.method === "POST") {
    if (!cfg.devEndpoints) return json(404, { ok: false, error: "not-found" });
    let body;
    try { body = await readJsonBody(request); } catch (e) { return json(400, { ok: false, error: "bad-json" }); }
    const outcome = ["success", "failed", "rejected"].includes(body.outcome) ? body.outcome : null;
    if (!outcome) return json(400, { ok: false, error: "bad-outcome" });
    const r = await jobs.finishJob(db, cfg, body.jobId, outcome);
    const httpStatus = r.status || 200;
    delete r.status;
    return json(httpStatus, r);
  }
  if (pathname === "/api/dev/jobs" && request.method === "GET") {
    if (!cfg.devEndpoints) return json(404, { ok: false, error: "not-found" });
    const all = (await db.all("jobs")).sort((a, b) => b.created - a.created);
    const out = [];
    for (const j of all) {
      const u = await db.get("users", j.userId);
      out.push({ id: j.id, email: u ? u.email : "?", model: j.model, status: j.status, cost: j.cost, created: j.created });
    }
    return json(200, { ok: true, jobs: out });
  }

  /* --- request magic link --- */
  if (pathname === "/api/auth/magic-link" && request.method === "POST") {
    let body;
    try { body = await readJsonBody(request); } catch (e) { return json(400, { ok: false, error: "bad-json" }); }
    const email = String(body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json(400, { ok: false, error: "bad-email" });
    const id = auth.createMagicToken();
    await db.set("magic_links", id, { id, email, created: Date.now(), expires: Date.now() + cfg.linkTtlMs, used: false });
    const origin = new URL(request.url).origin;
    const linkUrl = origin + "/login.html?token=" + id;
    await mailer.sendMagicLink(email, linkUrl);
    /* token is NOT returned to the caller; delivery happens via the mailer */
    return json(200, { ok: true });
  }

  /* --- consume magic link --- */
  if (pathname === "/api/auth/consume" && request.method === "POST") {
    let body;
    try { body = await readJsonBody(request); } catch (e) { return json(400, { ok: false, error: "bad-json" }); }
    const link = await db.get("magic_links", String(body.token || ""));
    if (!link || link.used) return json(400, { ok: false, error: "invalid" });
    if (Date.now() > link.expires) return json(400, { ok: false, error: "expired" });
    link.used = true;
    await db.set("magic_links", link.id, link);
    let user = await db.find("users", (u) => u.email === link.email);
    if (!user) {
      user = { id: "u_" + auth.createMagicToken().slice(0, 16), email: link.email, method: "email", created: Date.now() };
      await db.set("users", user.id, user);
    } else {
      user.method = "email";
      await db.set("users", user.id, user);
    }
    const token = await auth.issueSession(db, cfg, user.id);
    return json(200, { ok: true, token, user: { email: user.email, method: user.method, since: user.created } });
  }

  /* --- google oauth placeholder (client registration pending) --- */
  if (pathname === "/api/auth/google" && request.method === "POST") {
    return json(501, { ok: false, error: "oauth-not-configured" });
  }

  /* --- session-scoped routes --- */
  if (pathname === "/api/auth/me" || pathname === "/api/auth/logout") {
    const session = await auth.verifySession(db, cfg, auth.bearerToken(request));
    if (!session) return json(401, { ok: false, error: "unauthorized" });
    if (pathname === "/api/auth/logout") {
      await auth.revokeSession(db, auth.bearerToken(request));
      return json(200, { ok: true });
    }
    const user = await db.get("users", session.userId);
    if (!user) return json(401, { ok: false, error: "unauthorized" });
    return json(200, { ok: true, user: { email: user.email, method: user.method, since: user.created } });
  }

  /* --- dev-only order lookup (for the simulated checkout page) --- */
  if (pathname === "/api/dev/order" && request.method === "GET") {
    if (!cfg.devEndpoints) return json(404, { ok: false, error: "not-found" });
    const o = await db.get("orders", String(url.searchParams.get("id") || ""));
    if (!o) return json(404, { ok: false, error: "unknown-order" });
    return json(200, { ok: true, order: { id: o.id, pack: o.pack, usd: o.usd, credits: o.credits, status: o.status } });
  }

  /* --- dev-only inbox --- */
  if (pathname === "/api/dev/inbox" && request.method === "GET") {
    if (!cfg.devEndpoints) return json(404, { ok: false, error: "not-found" });
    const rows = (await db.all("dev_inbox")).sort((a, b) => b.created - a.created);
    const items = [];
    for (const m of rows) {
      const tok = (m.url.match(/token=([^&]+)$/) || [])[1];
      const link = tok ? await db.get("magic_links", tok) : null;
      items.push({
        id: tok, email: m.email, url: m.url, created: m.created,
        used: !!(link && link.used),
        expired: !!(link && Date.now() > link.expires),
      });
    }
    return json(200, { ok: true, items });
  }

  return json(404, { ok: false, error: "not-found" });
}

export default {
  async fetch(request, env, ctx) {
    const cfg = loadConfig(env);
    const db = createKvDb(env.DS_KV);
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, cfg, db, url, pathname);
      } catch (e) {
        console.error("[api] error:", e.message);
        return json(500, { ok: false, error: "internal" });
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("not found", { status: 404 });
  },

  /* Cron Trigger: fail + refund zombie jobs past cfg.jobTimeoutMs */
  async scheduled(event, env, ctx) {
    const cfg = loadConfig(env);
    const db = createKvDb(env.DS_KV);
    const swept = await jobs.sweepJobs(db, cfg);
    if (swept) console.log("[duostage] swept zombie jobs:", swept);
  },
};
