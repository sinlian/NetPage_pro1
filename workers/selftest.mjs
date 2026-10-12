/* DuoStage Workers — selftest (pure Node, no wrangler needed)
   Runs the real fetch/scheduled handlers against in-memory KV/R2/Assets
   shims. Mirrors the legacy Node mirror's 62 assertions on the Workers code.
   Usage: node workers/selftest.mjs */

import worker from "./src/index.js";
import { createMemoryKv } from "./src/db.js";
import { createMemoryBucket } from "./src/r2.js";
import { loadConfig } from "./src/config.js";

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; } else { failures.push(name); console.error("FAIL:", name); }
}

const env = {
  DS_KV: createMemoryKv(),
  DS_R2: createMemoryBucket(),
  DS_SECRET: "test-secret",
  DS_DEV_ENDPOINTS: "on",
  ASSETS: {
    async fetch(request) {
      const u = new URL(request.url);
      if (u.pathname === "/" || u.pathname === "/index.html") {
        return new Response("<html>DuoStage</html>", { headers: { "content-type": "text/html" } });
      }
      if (u.pathname === "/assets/sample-output.svg") {
        return new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } });
      }
      return new Response("not found", { status: 404 });
    },
  },
};
const cfg = loadConfig(env);
const BASE = "http://worker.internal";

async function api(path, opts = {}) {
  const res = await worker.fetch(new Request(BASE + path, opts), env, {});
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}
const jpost = (path, obj, headers = {}) =>
  api(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(obj) });

/* ---- health & pricing ---- */
{
  const h = await api("/api/health");
  check("health ok", h.status === 200 && h.body.ok === true && h.body.mode === "workers");
  const p = await api("/api/pricing");
  check("pricing packs", p.status === 200 && p.body.packs.single.credits === 240);
  check("pricing creditTable", p.body.creditTable.aurora["768"][15] === 240);
}

/* ---- auth: magic link flow ---- */
let token = null;
{
  const bad = await jpost("/api/auth/magic-link", { email: "nope" });
  check("magic-link bad-email", bad.status === 400 && bad.body.error === "bad-email");
  const ok = await jpost("/api/auth/magic-link", { email: "Ada@Example.com " });
  check("magic-link ok", ok.status === 200 && ok.body.ok === true && ok.body.token === undefined);
  const inbox = await api("/api/dev/inbox");
  check("dev inbox lists link", inbox.status === 200 && inbox.body.items.length === 1 && inbox.body.items[0].email === "ada@example.com");
  const linkId = inbox.body.items[0].id;
  const consume = await jpost("/api/auth/consume", { token: linkId });
  check("consume ok", consume.status === 200 && consume.body.ok && consume.body.token && consume.body.user.email === "ada@example.com");
  token = consume.body.token;
  const reuse = await jpost("/api/auth/consume", { token: linkId });
  check("consume single-use", reuse.status === 400 && reuse.body.error === "invalid");
  const me = await api("/api/auth/me", { headers: { authorization: "Bearer " + token } });
  check("me ok", me.status === 200 && me.body.user.email === "ada@example.com");
  const noauth = await api("/api/auth/me");
  check("me unauthorized", noauth.status === 401);
  const goog = await api("/api/auth/google");
  check("google 501", goog.status === 501);
}
const B = { authorization: "Bearer " + token };

/* ---- credits: empty then checkout/pay/grant ---- */
{
  const c0 = await api("/api/credits", { headers: B });
  check("credits empty", c0.status === 200 && c0.body.balance === 0 && c0.body.reserved === 0);
  const badpack = await jpost("/api/checkout", { pack: "nope" }, B);
  check("checkout unknown-pack", badpack.status === 400 && badpack.body.error === "unknown-pack");
  const co = await jpost("/api/checkout", { pack: "single" }, B);
  check("checkout ok", co.status === 200 && co.body.orderId && co.body.checkoutUrl.includes("checkout-dev.html"));
  const devOrder = await api("/api/dev/order?id=" + co.body.orderId);
  check("dev order pending", devOrder.status === 200 && devOrder.body.order.status === "pending");
  const confirm = await jpost("/api/pay/confirm", { orderId: co.body.orderId, outcome: "success" });
  check("pay confirm success", confirm.status === 200 && confirm.body.status === "paid");
  const again = await jpost("/api/pay/confirm", { orderId: co.body.orderId, outcome: "success" });
  check("pay confirm idempotent", again.status === 200 && again.body.already === true);
  const c1 = await api("/api/credits", { headers: B });
  check("credits granted 240", c1.body.balance === 240 && c1.body.ledger[0].reason === "grant");
  const unknown = await jpost("/api/pay/confirm", { orderId: "o_nope", outcome: "success" });
  check("pay unknown-order 404", unknown.status === 404);
  const cancel = await jpost("/api/pay/confirm", { orderId: co.body.orderId, outcome: "cancel" });
  check("pay cancel after paid idempotent", cancel.status === 200 && cancel.body.already === true);
}

/* ---- uploads: presign + put ---- */
let photo1 = null, photo2 = null;
{
  const badtype = await jpost("/api/uploads/presign", { mime: "image/gif", size: 100, slot: 1 }, B);
  check("presign bad-type", badtype.status === 400 && badtype.body.error === "bad-type");
  const badsize = await jpost("/api/uploads/presign", { mime: "image/png", size: cfg.maxUploadBytes + 1, slot: 1 }, B);
  check("presign bad-size", badsize.status === 400 && badsize.body.error === "bad-size");
  const p1 = await jpost("/api/uploads/presign", { mime: "image/png", size: 8, slot: 1 }, B);
  check("presign ok", p1.status === 200 && p1.body.uploadId && p1.body.putUrl.startsWith("/api/uploads/put/"));
  photo1 = p1.body.uploadId;
  const put = await api(p1.body.putUrl, { method: "PUT", body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) });
  check("put ok", put.status === 200 && put.body.key === photo1);
  check("r2 stored", env.DS_R2._size() === 1);
  const putAgain = await api(p1.body.putUrl, { method: "PUT", body: new Uint8Array([9]) });
  check("put single-use", putAgain.status === 404);
  const empty = await jpost("/api/uploads/presign", { mime: "image/png", size: 8, slot: 2 }, B);
  photo2 = empty.body.uploadId;
  const putEmpty = await api(empty.body.putUrl, { method: "PUT", body: new Uint8Array(0) });
  check("put empty-body", putEmpty.status === 400 && putEmpty.body.error === "empty-body");
  const put2 = await api(empty.body.putUrl, { method: "PUT", body: new Uint8Array([9, 9]) });
  check("put2 ok", put2.status === 200);
  const big = await jpost("/api/uploads/presign", { mime: "image/png", size: 8, slot: 1 }, B);
  const putBig = await api(big.body.putUrl, { method: "PUT", body: new Uint8Array(cfg.maxUploadBytes + 1) });
  check("put too-large 413", putBig.status === 413);
}

/* ---- jobs: validation, reserve, settle, refund ---- */
{
  const badmodel = await jpost("/api/jobs", { model: "nope", duration: 5, quality: "768", aspect: "9:16", photo1, photo2 }, B);
  check("job bad-model", badmodel.status === 400 && badmodel.body.error === "bad-model");
  const baddur = await jpost("/api/jobs", { model: "aurora", duration: 7, quality: "768", aspect: "9:16", photo1, photo2 }, B);
  check("job bad-duration", baddur.status === 400);
  const badq = await jpost("/api/jobs", { model: "aurora", duration: 5, quality: "4k", aspect: "9:16", photo1, photo2 }, B);
  check("job bad-quality", badq.status === 400);
  const bada = await jpost("/api/jobs", { model: "aurora", duration: 5, quality: "768", aspect: "4:3", photo1, photo2 }, B);
  check("job bad-aspect", bada.status === 400);
  const badp = await jpost("/api/jobs", { model: "aurora", duration: 5, quality: "768", aspect: "9:16", photo1: "u_nope", photo2 }, B);
  check("job bad-photo", badp.status === 400);
  const j1 = await jpost("/api/jobs", { model: "aurora", duration: 15, quality: "768", aspect: "9:16", photo1, photo2 }, B);
  check("job create ok", j1.status === 200 && j1.body.jobId && j1.body.status === "pending" && j1.body.cost === 240);
  const c2 = await api("/api/credits", { headers: B });
  check("reserve holds 240", c2.body.balance === 0 && c2.body.reserved === 240);
  const list = await api("/api/jobs", { headers: B });
  check("job list", list.status === 200 && list.body.jobs.length === 1 && list.body.jobs[0].status === "pending");
  /* concurrency cap: 3 active -> 4th 429 (needs more credits) */
  const co2 = await jpost("/api/checkout", { pack: "studio" }, B);
  await jpost("/api/pay/confirm", { orderId: co2.body.orderId, outcome: "success" });
  const j2 = await jpost("/api/jobs", { model: "flow", duration: 5, quality: "768", aspect: "16:9", photo1, photo2 }, B);
  const j3 = await jpost("/api/jobs", { model: "omni", duration: 5, quality: "2k", aspect: "1:1", photo1, photo2 }, B);
  check("jobs 2,3 ok", j2.status === 200 && j3.status === 200);
  const j4 = await jpost("/api/jobs", { model: "flow", duration: 5, quality: "768", aspect: "9:16", photo1, photo2 }, B);
  check("4th active 429", j4.status === 429 && j4.body.error === "too-many-active");
  /* insufficient: settle one then try over balance */
  const fin = await jpost("/api/dev/jobs/finish", { jobId: j1.body.jobId, outcome: "success" });
  check("finish success", fin.status === 200 && fin.body.job.status === "succeeded");
  const c3 = await api("/api/credits", { headers: B });
  check("consume settles hold", c3.body.reserved === j2.body.cost + j3.body.cost && c3.body.balance === 3360 - c3.body.reserved);
  const list2 = await api("/api/jobs", { headers: B });
  check("render url on success", list2.body.jobs.find((j) => j.id === j1.body.jobId).render.output_url === "/assets/sample-output.svg");
  const finAgain = await jpost("/api/dev/jobs/finish", { jobId: j1.body.jobId, outcome: "failed" });
  check("finish already-settled", finAgain.status === 400);
  const finBad = await jpost("/api/dev/jobs/finish", { jobId: "j_nope", outcome: "success" });
  check("finish unknown-job 404", finBad.status === 404);
  const finOut = await jpost("/api/dev/jobs/finish", { jobId: j2.body.jobId, outcome: "nope" });
  check("finish bad-outcome", finOut.status === 400);
  /* rejection refunds */
  const rej = await jpost("/api/dev/jobs/finish", { jobId: j2.body.jobId, outcome: "rejected" });
  check("rejection fails+refunds", rej.status === 200 && rej.body.job.status === "failed" && rej.body.job.error_code === "moderation");
  const c4 = await api("/api/credits", { headers: B });
  check("refund returns credits", c4.body.balance === 3360 - j3.body.cost && c4.body.reserved === j3.body.cost);
  const devJobs = await api("/api/dev/jobs");
  check("dev jobs list", devJobs.status === 200 && devJobs.body.jobs.length === 3 && devJobs.body.jobs[0].email === "ada@example.com");
}

/* ---- cron sweep: zombie fail + refund ---- */
{
  const list = await api("/api/jobs", { headers: B });
  const zombieId = list.body.jobs.find((j) => j.status === "pending").id;
  /* age the job past the timeout directly in the KV shim */
  const rec = await env.DS_KV.get("t:jobs:" + zombieId, "json");
  rec.created = Date.now() - cfg.jobTimeoutMs - 1000;
  await env.DS_KV.put("t:jobs:" + zombieId, JSON.stringify(rec));
  await worker.scheduled({ scheduledTime: Date.now() }, env, {});
  const after = await api("/api/jobs", { headers: B });
  const z = after.body.jobs.find((j) => j.id === zombieId);
  check("cron sweeps zombie", z.status === "failed" && z.error_code === "vendor-failed");
  const c5 = await api("/api/credits", { headers: B });
  check("sweep refunds", c5.body.balance === 3360 && c5.body.reserved === 0);
}

/* ---- logout revokes ---- */
{
  const out = await api("/api/auth/logout", { method: "POST", headers: B });
  check("logout ok", out.status === 200);
  const me = await api("/api/auth/me", { headers: B });
  check("me after logout 401", me.status === 401);
}

/* ---- static assets fallback ---- */
{
  const idx = await worker.fetch(new Request(BASE + "/"), env, {});
  const txt = await idx.text();
  check("static index via ASSETS", idx.status === 200 && txt.includes("DuoStage"));
  const nf = await worker.fetch(new Request(BASE + "/nope.html"), env, {});
  check("static 404", nf.status === 404);
  const post = await worker.fetch(new Request(BASE + "/index.html", { method: "POST" }), env, {});
  check("static 405 on POST", post.status === 405);
}

/* ---- 404 api ---- */
{
  const nf = await api("/api/nope");
  check("api 404", nf.status === 404);
}

/* ---- Phase 4: library, signed downloads, deletion, render expiry ---- */
{
  /* re-login (session was revoked above) */
  await jpost("/api/auth/magic-link", { email: "lib@example.com" });
  const inbox = await api("/api/dev/inbox");
  const link = inbox.body.items.find((i) => i.email === "lib@example.com");
  const cons = await jpost("/api/auth/consume", { token: link.id });
  const LB = { authorization: "Bearer " + cons.body.token };
  /* create uploads */
  const ps = await jpost("/api/uploads/presign", { mime: "image/png", size: 4, slot: 1 }, LB);
  await api(ps.body.putUrl, { method: "PUT", body: new Uint8Array([1, 2, 3, 4]) });
  const ps2 = await jpost("/api/uploads/presign", { mime: "image/png", size: 4, slot: 2 }, LB);
  await api(ps2.body.putUrl, { method: "PUT", body: new Uint8Array([4, 3, 2, 1]) });
  /* grant credits via a paid order */
  const co3 = await jpost("/api/checkout", { pack: "single" }, LB);
  await jpost("/api/pay/confirm", { orderId: co3.body.orderId, outcome: "success" });
  const jb = await jpost("/api/jobs", { model: "aurora", duration: 5, quality: "768", aspect: "9:16", photo1: ps.body.uploadId, photo2: ps2.body.uploadId }, LB);
  check("lib job created", jb.status === 200);
  const fin = await jpost("/api/dev/jobs/finish", { jobId: jb.body.jobId, outcome: "success" });
  check("lib job finished", fin.status === 200 && fin.body.job.render);
  const rid = fin.body.job.render;

  /* library list with signed download url */
  const lib = await api("/api/renders", { headers: LB });
  check("renders list", lib.status === 200 && lib.body.renders.length === 1 && lib.body.renders[0].render.download_url.startsWith("/api/downloads/" + rid));
  const dlUrl = lib.body.renders[0].render.download_url;

  /* signed download: valid sig redirects; bad sig 403; expired 403 */
  const dl = await worker.fetch(new Request(BASE + dlUrl), env, {});
  check("signed download redirects", dl.status === 302);
  const dlBad = await worker.fetch(new Request(BASE + "/api/downloads/" + rid + "?exp=9999999999999&sig=nope"), env, {});
  check("bad sig 403", dlBad.status === 403);
  const dlExp = await worker.fetch(new Request(BASE + "/api/downloads/" + rid + "?exp=1&sig=" + dlUrl.split("sig=")[1]), env, {});
  check("expired sig 403", dlExp.status === 403);

  /* render expiry sweep purges */
  const rec = await env.DS_KV.get("t:renders:" + rid, "json");
  rec.expires = Date.now() - 1000;
  await env.DS_KV.put("t:renders:" + rid, JSON.stringify(rec));
  await worker.scheduled({ scheduledTime: Date.now() }, env, {});
  const gone = await env.DS_KV.get("t:renders:" + rid, "json");
  check("expired render purged", gone === null);
  const jobAfter = await env.DS_KV.get("t:jobs:" + jb.body.jobId, "json");
  check("job render unlinked after purge", jobAfter.render === null);

  /* deletion: create another render then delete via API (top up credits first) */
  const co4 = await jpost("/api/checkout", { pack: "single" }, LB);
  await jpost("/api/pay/confirm", { orderId: co4.body.orderId, outcome: "success" });
  const jb2 = await jpost("/api/jobs", { model: "flow", duration: 5, quality: "768", aspect: "1:1", photo1: ps.body.uploadId, photo2: ps2.body.uploadId }, LB);
  check("lib job2 created", jb2.status === 200);
  const fin2 = await jpost("/api/dev/jobs/finish", { jobId: jb2.body.jobId, outcome: "success" });
  const rid2 = fin2.body.job.render;
  const del = await api("/api/renders/" + rid2, { method: "DELETE", headers: LB });
  check("render delete ok", del.status === 200);
  check("render gone", (await env.DS_KV.get("t:renders:" + rid2, "json")) === null);
  const delOther = await api("/api/renders/" + rid2, { method: "DELETE", headers: LB });
  check("render delete twice 404", delOther.status === 404);

  /* deletion-request: uploads scope removes upload rows + r2 objects */
  const dr = await jpost("/api/deletion-request", { scope: "uploads" }, LB);
  check("deletion-request uploads", dr.status === 200 && dr.body.removed === 2);
  check("uploads rows gone", (await env.DS_KV.get("t:uploads:" + ps.body.uploadId, "json")) === null);
  check("r2 objects of requester gone", (await env.DS_R2.get(ps.body.uploadId + ".png")) === null && (await env.DS_R2.get(ps2.body.uploadId + ".png")) === null);
  check("other users' r2 objects untouched", env.DS_R2._size() === 2);
  const drBad = await jpost("/api/deletion-request", { scope: "nope" }, LB);
  check("deletion-request bad scope", drBad.status === 400);
  /* account scope wipes user */
  const drAcc = await jpost("/api/deletion-request", { scope: "account" }, LB);
  check("deletion-request account", drAcc.status === 200);
  const meGone = await api("/api/auth/me", { headers: LB });
  check("session dead after account deletion", meGone.status === 401);
}

/* ---- Phase 5: Google OAuth flow against a local stub IdP ---- */
{
  const http = await import("node:http");
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const kpBad = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, false, ["sign"]);
  const pubJwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  pubJwk.kid = "test-kid-1";
  pubJwk.alg = "RS256";
  pubJwk.use = "sig";

  const b64u = (bytes) => { let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const b64uStr = (s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function makeIdToken(key, claims) {
    const h = b64uStr(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-kid-1" }));
    const c = b64uStr(JSON.stringify(claims));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(h + "." + c));
    return h + "." + c + "." + b64u(new Uint8Array(sig));
  }
  const goodClaims = { iss: "https://accounts.google.com", aud: "test-client", exp: Math.floor(Date.now() / 1000) + 600, email: "Goo.Gle@example.com", sub: "g-sub-1" };

  const stub = http.createServer((req, res) => {
    const u = new URL(req.url, "http://stub");
    if (u.pathname === "/certs") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [pubJwk] })); return; }
    if (u.pathname === "/token") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        const form = new URLSearchParams(raw);
        const idToken = form.get("code") === "bad-sig"
          ? await makeIdToken(kpBad.privateKey, goodClaims)
          : await makeIdToken(kp.privateKey, goodClaims);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: "at", id_token: idToken }));
      });
      return;
    }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  const stubBase = "http://127.0.0.1:" + stub.address().port;

  /* not configured -> 501 */
  let g = await api("/api/auth/google");
  check("google 501 when unconfigured", g.status === 501);

  /* configure via env (loadConfig reads per request) */
  env.GOOGLE_CLIENT_ID = "test-client";
  env.GOOGLE_CLIENT_SECRET = "test-secret";
  env.GOOGLE_AUTH_URL = stubBase + "/auth";
  env.GOOGLE_TOKEN_URL = stubBase + "/token";
  env.GOOGLE_JWKS_URL = stubBase + "/certs";

  g = await worker.fetch(new Request(BASE + "/api/auth/google?redirect=/creations.html"), env, {});
  check("google start redirects to IdP", g.status === 302 && g.headers.get("location").startsWith(stubBase + "/auth?"));
  const loc = new URL(g.headers.get("location"));
  check("auth url params", loc.searchParams.get("client_id") === "test-client" && loc.searchParams.get("scope") === "openid email profile" && !!loc.searchParams.get("state"));
  const state = loc.searchParams.get("state");

  g = await worker.fetch(new Request(BASE + "/api/auth/google/callback?code=abc&state=bogus"), env, {});
  check("callback bad state 400", g.status === 400 && (await g.json()).error === "bad-state");

  g = await worker.fetch(new Request(BASE + "/api/auth/google/callback?code=bad-sig&state=" + encodeURIComponent(state)), env, {});
  const badSig = await g.json();
  check("callback rejects bad id_token signature", g.status === 400 && badSig.error === "id-token-bad-signature");

  g = await worker.fetch(new Request(BASE + "/api/auth/google/callback?code=abc&state=" + encodeURIComponent(state)), env, {});
  check("callback success redirects with token", g.status === 302 && g.headers.get("location").includes("/login.html#google-token="));
  const gtok = decodeURIComponent(g.headers.get("location").split("google-token=")[1]);
  const me = await api("/api/auth/me", { headers: { authorization: "Bearer " + gtok } });
  check("google session user", me.status === 200 && me.body.user.email === "goo.gle@example.com" && me.body.user.method === "google");

  /* expired id_token rejected */
  const expToken = await makeIdToken(kp.privateKey, Object.assign({}, goodClaims, { exp: Math.floor(Date.now() / 1000) - 10 }));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === stubBase + "/token") return new Response(JSON.stringify({ access_token: "at", id_token: expToken }), { headers: { "content-type": "application/json" } });
    return origFetch(input, init);
  };
  const state2 = new URL((await worker.fetch(new Request(BASE + "/api/auth/google"), env, {})).headers.get("location")).searchParams.get("state");
  g = await worker.fetch(new Request(BASE + "/api/auth/google/callback?code=abc&state=" + encodeURIComponent(state2)), env, {});
  check("callback rejects expired id_token", g.status === 400 && (await g.json()).error === "id-token-expired");
  globalThis.fetch = origFetch;
  stub.close();
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
