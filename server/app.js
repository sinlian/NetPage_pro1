/* DuoStage backend skeleton — app factory & API routes
   POST /api/auth/magic-link   { email }            -> request a sign-in link
   POST /api/auth/consume      { token }            -> exchange link for a session token
   GET  /api/auth/me                                -> current session user (Bearer)
   POST /api/auth/logout                            -> revoke session (Bearer)
   POST /api/auth/google                            -> 501 until OAuth client exists
   GET  /api/dev/inbox                              -> dev-only magic link listing
   GET  /api/health                                 -> liveness
   everything else -> static site from webRoot */
"use strict";
const config = require("./config");
const { createDb } = require("./db");
const { createDevInboxMailer } = require("./mail");
const { createDevPayAdapter } = require("./pay");
const credits = require("./credits");
const jobs = require("./jobs");
const { createMagicToken, issueSession, verifySession, revokeSession, bearerToken } = require("./auth");
const { sendJson, readJsonBody, readRawBody, serveStatic } = require("./http");

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function createApp(cfg = config, db = createDb(cfg.dataFile), mailer = createDevInboxMailer(db), pay = createDevPayAdapter()) {
  /* shared session lookup for bearer-protected routes */
  function sessionUser(req) {
    const session = verifySession(db, cfg, bearerToken(req));
    if (!session) return null;
    return db.get("users", session.userId) ? { session, user: db.get("users", session.userId) } : null;
  }

  /* idempotent payment confirmation (stands in for the gateway webhook) */
  function confirmOrder(orderId, outcome) {
    const order = db.get("orders", orderId);
    if (!order) return { httpStatus: 404, ok: false, error: "unknown-order" };
    if (order.status !== "pending") {
      /* already settled: idempotent no-op */
      return { ok: true, status: order.status, already: true };
    }
    if (outcome === "success") {
      order.status = "paid";
      order.paidAt = Date.now();
      db.set("orders", order.id, order);
      credits.grant(db, order.userId, order.credits, "order", order.id);
      return { ok: true, status: "paid" };
    }
    order.status = "cancelled";
    db.set("orders", order.id, order);
    return { ok: true, status: "cancelled" };
  }

  async function handleApi(req, res, pathname) {
    /* --- health --- */
    if (pathname === "/api/health" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, mode: "skeleton", mailer: mailer.name, pay: pay.name });
    }

    /* --- pricing config (single source of truth for the calculator) --- */
    if (pathname === "/api/pricing" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, packs: cfg.packs, creditTable: cfg.creditTable });
    }

    /* --- credit balance & ledger (bearer) --- */
    if (pathname === "/api/credits" && req.method === "GET") {
      const su = sessionUser(req);
      if (!su) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      return sendJson(res, 200, Object.assign({ ok: true }, credits.summary(db, su.user.id)));
    }

    /* --- create checkout (bearer) --- */
    if (pathname === "/api/checkout" && req.method === "POST") {
      const su = sessionUser(req);
      if (!su) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: "bad-json" }); }
      const pack = cfg.packs[body.pack];
      if (!pack) return sendJson(res, 400, { ok: false, error: "unknown-pack" });
      const id = "o_" + createMagicToken().slice(0, 16);
      const order = { id, userId: su.user.id, pack: body.pack, usd: pack.usd, credits: pack.credits, status: "pending", created: Date.now() };
      db.set("orders", id, order);
      const origin = (req.headers.origin || "").replace(/\/$/, "") || `http://${cfg.host}:${cfg.port}`;
      const co = await pay.createCheckout(order, origin);
      return sendJson(res, 200, { ok: true, orderId: id, checkoutUrl: co.checkoutUrl });
    }

    /* --- payment confirmation (dev stand-in for the gateway webhook) --- */
    if (pathname === "/api/pay/confirm" && req.method === "POST") {
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: "bad-json" }); }
      const outcome = body.outcome === "cancel" ? "cancel" : "success";
      const r = confirmOrder(String(body.orderId || ""), outcome);
      const httpStatus = r.httpStatus || 200;
      delete r.httpStatus;
      return sendJson(res, httpStatus, r);
    }

    /* --- uploads: presign + direct put (dev stand-in for S3 presigned URLs) --- */
    if (pathname === "/api/uploads/presign" && req.method === "POST") {
      const su = sessionUser(req);
      if (!su) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: "bad-json" }); }
      const ALLOWED = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      if (!ALLOWED[body.mime]) return sendJson(res, 400, { ok: false, error: "bad-type" });
      const size = Number(body.size);
      if (!(size > 0) || size > cfg.maxUploadBytes) return sendJson(res, 400, { ok: false, error: "bad-size" });
      const id = "u_" + createMagicToken().slice(0, 16);
      db.set("uploads", id, { id, userId: su.user.id, slot: Number(body.slot) === 2 ? 2 : 1, mime: body.mime, size, ext: ALLOWED[body.mime], status: "pending", created: Date.now() });
      return sendJson(res, 200, { ok: true, uploadId: id, putUrl: "/api/uploads/put/" + id, maxBytes: cfg.maxUploadBytes });
    }
    const putMatch = pathname.match(/^\/api\/uploads\/put\/([A-Za-z0-9_-]+)$/);
    if (putMatch && req.method === "PUT") {
      const rec = db.get("uploads", putMatch[1]);
      if (!rec || rec.status !== "pending") return sendJson(res, 404, { ok: false, error: "unknown-upload" });
      let buf;
      try { buf = await readRawBody(req, cfg.maxUploadBytes); }
      catch (e) { return sendJson(res, 413, { ok: false, error: "too-large" }); }
      if (buf.length === 0) return sendJson(res, 400, { ok: false, error: "empty-body" });
      const fs = require("fs");
      const path = require("path");
      try {
        fs.mkdirSync(cfg.uploadsDir, { recursive: true });
        fs.writeFileSync(path.join(cfg.uploadsDir, rec.id + "." + rec.ext), buf);
      } catch (e) { return sendJson(res, 500, { ok: false, error: "write-failed" }); }
      rec.status = "ready";
      rec.stored = buf.length;
      db.set("uploads", rec.id, rec);
      return sendJson(res, 200, { ok: true, key: rec.id });
    }

    /* --- jobs: create + list (bearer) --- */
    if (pathname === "/api/jobs" && req.method === "POST") {
      const su = sessionUser(req);
      if (!su) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: "bad-json" }); }
      const r = jobs.createJob(db, cfg, su.user, body);
      if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error });
      return sendJson(res, 200, { ok: true, jobId: r.job.id, status: r.job.status, cost: r.job.cost });
    }
    if (pathname === "/api/jobs" && req.method === "GET") {
      const su = sessionUser(req);
      if (!su) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      return sendJson(res, 200, { ok: true, jobs: jobs.listJobs(db, su.user.id) });
    }

    /* --- dev-only job control (stands in for vendor callbacks) --- */
    if (pathname === "/api/dev/jobs/finish" && req.method === "POST") {
      if (!cfg.devEndpoints) return sendJson(res, 404, { ok: false, error: "not-found" });
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: "bad-json" }); }
      const outcome = ["success", "failed", "rejected"].includes(body.outcome) ? body.outcome : null;
      if (!outcome) return sendJson(res, 400, { ok: false, error: "bad-outcome" });
      const r = jobs.finishJob(db, cfg, body.jobId, outcome);
      const httpStatus = r.status || 200;
      delete r.status;
      return sendJson(res, httpStatus, r);
    }
    if (pathname === "/api/dev/jobs" && req.method === "GET") {
      if (!cfg.devEndpoints) return sendJson(res, 404, { ok: false, error: "not-found" });
      const all = db.all("jobs").sort((a, b) => b.created - a.created).map((j) => {
        const u = db.get("users", j.userId);
        return { id: j.id, email: u ? u.email : "?", model: j.model, status: j.status, cost: j.cost, created: j.created };
      });
      return sendJson(res, 200, { ok: true, jobs: all });
    }

    /* --- request magic link --- */
    if (pathname === "/api/auth/magic-link" && req.method === "POST") {
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: "bad-json" }); }
      const email = String(body.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return sendJson(res, 400, { ok: false, error: "bad-email" });
      const id = createMagicToken();
      db.set("magic_links", id, { id, email, created: Date.now(), expires: Date.now() + cfg.linkTtlMs, used: false });
      const origin = (req.headers.origin || "").replace(/\/$/, "");
      const url = (origin || `http://${cfg.host}:${cfg.port}`) + "/login.html?token=" + id;
      await mailer.sendMagicLink(email, url);
      /* token is NOT returned to the caller; delivery happens via the mailer */
      return sendJson(res, 200, { ok: true });
    }

    /* --- consume magic link --- */
    if (pathname === "/api/auth/consume" && req.method === "POST") {
      let body;
      try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: "bad-json" }); }
      const link = db.get("magic_links", String(body.token || ""));
      if (!link || link.used) return sendJson(res, 400, { ok: false, error: "invalid" });
      if (Date.now() > link.expires) return sendJson(res, 400, { ok: false, error: "expired" });
      link.used = true;
      db.set("magic_links", link.id, link);
      let user = db.find("users", (u) => u.email === link.email);
      if (!user) {
        user = { id: "u_" + createMagicToken().slice(0, 16), email: link.email, method: "email", created: Date.now() };
        db.set("users", user.id, user);
      } else {
        user.method = "email";
        db.set("users", user.id, user);
      }
      const token = issueSession(db, cfg, user.id);
      return sendJson(res, 200, {
        ok: true, token,
        user: { email: user.email, method: user.method, since: user.created },
      });
    }

    /* --- google oauth placeholder (client registration pending) --- */
    if (pathname === "/api/auth/google" && req.method === "POST") {
      return sendJson(res, 501, { ok: false, error: "oauth-not-configured" });
    }

    /* --- session-scoped routes --- */
    if (pathname === "/api/auth/me" || pathname === "/api/auth/logout") {
      const session = verifySession(db, cfg, bearerToken(req));
      if (!session) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      if (pathname === "/api/auth/logout") {
        revokeSession(db, bearerToken(req));
        return sendJson(res, 200, { ok: true });
      }
      const user = db.get("users", session.userId);
      if (!user) return sendJson(res, 401, { ok: false, error: "unauthorized" });
      return sendJson(res, 200, { ok: true, user: { email: user.email, method: user.method, since: user.created } });
    }

    /* --- dev-only order lookup (for the simulated checkout page) --- */
    if (pathname === "/api/dev/order" && req.method === "GET") {
      if (!cfg.devEndpoints) return sendJson(res, 404, { ok: false, error: "not-found" });
      const q = new URL(req.url, "http://internal").searchParams.get("id");
      const o = db.get("orders", String(q || ""));
      if (!o) return sendJson(res, 404, { ok: false, error: "unknown-order" });
      return sendJson(res, 200, { ok: true, order: { id: o.id, pack: o.pack, usd: o.usd, credits: o.credits, status: o.status } });
    }

    /* --- dev-only inbox --- */
    if (pathname === "/api/dev/inbox" && req.method === "GET") {
      if (!cfg.devEndpoints) return sendJson(res, 404, { ok: false, error: "not-found" });
      const items = db.all("dev_inbox")
        .sort((a, b) => b.created - a.created)
        .map((m) => {
          const link = db.get("magic_links", (m.url.match(/token=([^&]+)$/) || [])[1]);
          return {
            id: (m.url.match(/token=([^&]+)$/) || [])[1],
            email: m.email, url: m.url, created: m.created,
            used: !!(link && link.used),
            expired: !!(link && Date.now() > link.expires),
          };
        });
      return sendJson(res, 200, { ok: true, items });
    }

    return sendJson(res, 404, { ok: false, error: "not-found" });
  }

  return function app(req, res) {
    const pathname = (req.url || "/").split("?")[0];
    if (pathname.startsWith("/api/")) {
      handleApi(req, res, pathname).catch((e) => {
        console.error("[api] error:", e.message);
        sendJson(res, 500, { ok: false, error: "internal" });
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    serveStatic(res, cfg.webRoot, pathname);
  };
}

module.exports = { createApp };
