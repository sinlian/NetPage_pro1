/* DuoStage backend skeleton — in-process self test
   Run: node server/selftest.js
   Boots the app on an ephemeral port with a temp data file, exercises the
   full auth flow + static serving, prints PASS/FAIL, exits non-zero on failure. */
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("./app");
const { createDb } = require("./db");

const tmpData = path.join(os.tmpdir(), "ds-selftest-" + Date.now() + ".json");
const cfg = Object.assign({}, require("./config"), {
  host: "127.0.0.1", port: 0,
  secret: "test-secret", sessionTtlMs: 60000, linkTtlMs: 60000,
  dataFile: tmpData, devEndpoints: true,
});

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS", name); }
  else { failed++; console.log("FAIL", name, extra || ""); }
}

async function main() {
  const db = createDb(cfg.dataFile);
  const server = http.createServer(createApp(cfg, db));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const j = (r) => r.json();

  /* health */
  let r = await fetch(base + "/api/health");
  let b = await j(r);
  check("health", r.status === 200 && b.ok === true);

  /* bad email rejected */
  r = await fetch(base + "/api/auth/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nope" }) });
  check("magic-link rejects bad email", r.status === 400);

  /* request link */
  r = await fetch(base + "/api/auth/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "Tester@Example.com" }) });
  b = await j(r);
  check("magic-link accepted", r.status === 200 && b.ok === true && b.token === undefined);

  /* dev inbox lists it, email normalized */
  r = await fetch(base + "/api/dev/inbox");
  b = await j(r);
  const item = b.items && b.items[0];
  check("dev inbox has link", !!item && item.email === "tester@example.com" && item.used === false);

  /* consume wrong token */
  r = await fetch(base + "/api/auth/consume", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "deadbeef" }) });
  check("consume rejects unknown token", r.status === 400);

  /* consume real token */
  r = await fetch(base + "/api/auth/consume", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: item.id }) });
  b = await j(r);
  check("consume returns session", r.status === 200 && b.ok === true && !!b.token && b.user.email === "tester@example.com");
  const token = b.token;

  /* replay rejected (single use) */
  r = await fetch(base + "/api/auth/consume", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: item.id }) });
  check("consume is single-use", r.status === 400);

  /* me with bearer */
  r = await fetch(base + "/api/auth/me", { headers: { authorization: "Bearer " + token } });
  b = await j(r);
  check("me returns user", r.status === 200 && b.user.email === "tester@example.com" && b.user.method === "email");

  /* me without bearer */
  r = await fetch(base + "/api/auth/me");
  check("me requires bearer", r.status === 401);

  /* tampered token rejected */
  r = await fetch(base + "/api/auth/me", { headers: { authorization: "Bearer " + token.slice(0, -2) + "xx" } });
  check("tampered token rejected", r.status === 401);

  /* logout revokes */
  r = await fetch(base + "/api/auth/logout", { method: "POST", headers: { authorization: "Bearer " + token } });
  check("logout ok", r.status === 200);
  r = await fetch(base + "/api/auth/me", { headers: { authorization: "Bearer " + token } });
  check("session revoked after logout", r.status === 401);

  /* google placeholder */
  r = await fetch(base + "/api/auth/google", { method: "POST" });
  check("google oauth is 501 placeholder", r.status === 501);

  /* ---------- Phase 2: pricing, checkout, ledger ---------- */
  const H_JSON = { "content-type": "application/json" };
  r = await fetch(base + "/api/pricing");
  b = await j(r);
  check("pricing config exposed", r.status === 200 && b.packs.single.credits === 240 && b.creditTable.aurora["768"][15] === 240 && b.creditTable.aurora["2k"][15] === 390);

  r = await fetch(base + "/api/checkout", { method: "POST", headers: H_JSON, body: JSON.stringify({ pack: "single" }) });
  check("checkout requires bearer", r.status === 401);

  /* fresh session for the buyer */
  await fetch(base + "/api/auth/magic-link", { method: "POST", headers: H_JSON, body: JSON.stringify({ email: "buyer@example.com" }) });
  r = await fetch(base + "/api/dev/inbox");
  b = await j(r);
  const buyerLink = b.items.find((i) => i.email === "buyer@example.com");
  r = await fetch(base + "/api/auth/consume", { method: "POST", headers: H_JSON, body: JSON.stringify({ token: buyerLink.id }) });
  b = await j(r);
  const token2 = b.token;
  const H = { authorization: "Bearer " + token2, "content-type": "application/json" };

  r = await fetch(base + "/api/credits", { headers: H });
  b = await j(r);
  check("fresh balance is zero", r.status === 200 && b.balance === 0 && b.reserved === 0);

  r = await fetch(base + "/api/checkout", { method: "POST", headers: H, body: JSON.stringify({ pack: "nope" }) });
  check("unknown pack rejected", r.status === 400);

  r = await fetch(base + "/api/checkout", { method: "POST", headers: H, body: JSON.stringify({ pack: "single" }) });
  b = await j(r);
  check("checkout created with dev url", r.status === 200 && b.checkoutUrl.includes("checkout-dev.html?order="));
  const orderId = b.orderId;

  r = await fetch(base + "/api/dev/order?id=" + orderId);
  b = await j(r);
  check("dev order lookup", r.status === 200 && b.order.status === "pending" && b.order.credits === 240);

  r = await fetch(base + "/api/pay/confirm", { method: "POST", headers: H_JSON, body: JSON.stringify({ orderId, outcome: "success" }) });
  b = await j(r);
  check("pay confirm grants", b.ok === true && b.status === "paid");
  r = await fetch(base + "/api/credits", { headers: H });
  b = await j(r);
  check("balance is 240 after pay", b.balance === 240);

  r = await fetch(base + "/api/pay/confirm", { method: "POST", headers: H_JSON, body: JSON.stringify({ orderId, outcome: "success" }) });
  b = await j(r);
  check("webhook replay is idempotent", b.ok === true && b.already === true);
  r = await fetch(base + "/api/credits", { headers: H });
  b = await j(r);
  check("no double grant", b.balance === 240);

  /* cancel path grants nothing */
  r = await fetch(base + "/api/checkout", { method: "POST", headers: H, body: JSON.stringify({ pack: "starter" }) });
  b = await j(r);
  const orderId2 = b.orderId;
  r = await fetch(base + "/api/pay/confirm", { method: "POST", headers: H_JSON, body: JSON.stringify({ orderId: orderId2, outcome: "cancel" }) });
  b = await j(r);
  check("cancel settles order", b.ok === true && b.status === "cancelled");
  r = await fetch(base + "/api/credits", { headers: H });
  b = await j(r);
  check("cancel grants nothing", b.balance === 240);

  /* ledger lifecycle: reserve -> consume / return, single settlement */
  const credits = require("./credits");
  const uid = db.all("users").find((u) => u.email === "buyer@example.com").id;
  let cr = credits.reserve(db, uid, 240, "job_a");
  check("reserve ok", cr.ok === true);
  b = credits.summary(db, uid);
  check("reserve drops available & shows hold", b.balance === 0 && b.reserved === 240);
  cr = credits.settle(db, uid, "job_a", "consume");
  check("settle consume ok", cr.ok === true);
  b = credits.summary(db, uid);
  check("consumed stays deducted, hold cleared", b.balance === 0 && b.reserved === 0);
  cr = credits.settle(db, uid, "job_a", "return");
  check("double settlement rejected", cr.ok === false && cr.error === "already-settled");
  credits.grant(db, uid, 100, "test", "t1");
  cr = credits.reserve(db, uid, 100, "job_b");
  check("second reserve ok", cr.ok === true);
  cr = credits.settle(db, uid, "job_b", "return");
  check("settle return refunds", cr.ok === true && cr.amount === 100);
  b = credits.summary(db, uid);
  check("refunded balance restored", b.balance === 100 && b.reserved === 0);
  cr = credits.reserve(db, uid, 99999, "job_c");
  check("overdraft rejected", cr.ok === false && cr.error === "insufficient");

  /* ---------- Phase 3: uploads + jobs ---------- */
  credits.grant(db, uid, 2000, "test", "t2");
  const H2 = { authorization: "Bearer " + token2, "content-type": "application/json" };

  /* presign validation */
  r = await fetch(base + "/api/uploads/presign", { method: "POST", headers: H2, body: JSON.stringify({ slot: 1, mime: "image/gif", size: 100 }) });
  check("presign rejects bad mime", r.status === 400);
  r = await fetch(base + "/api/uploads/presign", { method: "POST", headers: H2, body: JSON.stringify({ slot: 1, mime: "image/png", size: 20 * 1024 * 1024 }) });
  check("presign rejects oversize", r.status === 400);
  r = await fetch(base + "/api/uploads/presign", { method: "POST", headers: H2, body: JSON.stringify({ slot: 1, mime: "image/png", size: 1234 }) });
  b = await j(r);
  check("presign ok", r.status === 200 && b.putUrl.startsWith("/api/uploads/put/"));
  const up1 = b.uploadId;
  r = await fetch(base + "/api/uploads/presign", { method: "POST", headers: H2, body: JSON.stringify({ slot: 2, mime: "image/webp", size: 999 }) });
  b = await j(r);
  const up2 = b.uploadId;

  /* put bytes */
  r = await fetch(base + "/api/uploads/put/" + up1, { method: "PUT", headers: { "content-type": "image/png" }, body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
  b = await j(r);
  check("put stores upload", r.status === 200 && b.key === up1);
  r = await fetch(base + "/api/uploads/put/" + up2, { method: "PUT", headers: { "content-type": "image/webp" }, body: Buffer.from([82, 73, 70, 70]) });
  check("put second upload", r.status === 200);
  r = await fetch(base + "/api/uploads/put/" + up1, { method: "PUT", body: Buffer.from([1]) });
  check("put replay rejected", r.status === 404);

  /* job validation */
  r = await fetch(base + "/api/jobs", { method: "POST", headers: H2, body: JSON.stringify({ model: "nope", duration: 15, quality: "768", aspect: "9:16", photo1: up1, photo2: up2 }) });
  check("job rejects bad model", r.status === 400);
  r = await fetch(base + "/api/jobs", { method: "POST", headers: H2, body: JSON.stringify({ model: "aurora", duration: 7, quality: "768", aspect: "9:16", photo1: up1, photo2: up2 }) });
  check("job rejects bad duration", r.status === 400);
  r = await fetch(base + "/api/jobs", { method: "POST", headers: H2, body: JSON.stringify({ model: "aurora", duration: 15, quality: "768", aspect: "2:1", photo1: up1, photo2: up2 }) });
  check("job rejects bad aspect", r.status === 400);
  r = await fetch(base + "/api/jobs", { method: "POST", headers: H2, body: JSON.stringify({ model: "aurora", duration: 15, quality: "768", aspect: "9:16", photo1: "u_dead", photo2: up2 }) });
  check("job rejects foreign photo", r.status === 400);

  /* job create reserves credits */
  const before = credits.summary(db, uid).balance;
  r = await fetch(base + "/api/jobs", { method: "POST", headers: H2, body: JSON.stringify({ model: "aurora", duration: 15, quality: "768", aspect: "9:16", photo1: up1, photo2: up2 }) });
  b = await j(r);
  check("job created pending", r.status === 200 && b.status === "pending" && b.cost === 240);
  const job1 = b.jobId;
  let sum = credits.summary(db, uid);
  check("job reserve deducted", sum.balance === before - 240 && sum.reserved === 240);

  /* active cap */
  const mk = async () => {
    const rr = await fetch(base + "/api/jobs", { method: "POST", headers: H2, body: JSON.stringify({ model: "aurora", duration: 5, quality: "768", aspect: "1:1", photo1: up1, photo2: up2 }) });
    return { status: rr.status, body: await rr.json() };
  };
  const c1 = await mk();
  const c2 = await mk();
  const c3 = await mk();
  check("active job cap 429", c3.status === 429);
  /* settle the two cap jobs as failed so their holds release before later assertions */
  await fetch(base + "/api/dev/jobs/finish", { method: "POST", headers: H_JSON, body: JSON.stringify({ jobId: c1.body.jobId, outcome: "failed" }) });
  await fetch(base + "/api/dev/jobs/finish", { method: "POST", headers: H_JSON, body: JSON.stringify({ jobId: c2.body.jobId, outcome: "failed" }) });

  /* dev finish success: consume + render row */
  r = await fetch(base + "/api/dev/jobs/finish", { method: "POST", headers: H_JSON, body: JSON.stringify({ jobId: job1, outcome: "success" }) });
  b = await j(r);
  check("finish success", r.status === 200 && b.job.status === "succeeded" && !!b.job.render);
  sum = credits.summary(db, uid);
  check("success keeps deduction, hold cleared", sum.balance === before - 240 && sum.reserved === 0);
  r = await fetch(base + "/api/dev/jobs/finish", { method: "POST", headers: H_JSON, body: JSON.stringify({ jobId: job1, outcome: "failed" }) });
  check("finish replay rejected", r.status === 400);

  /* finish failed refunds */
  r = await fetch(base + "/api/jobs", { method: "POST", headers: H2, body: JSON.stringify({ model: "flow", duration: 10, quality: "2k", aspect: "16:9", photo1: up1, photo2: up2 }) });
  b = await j(r);
  const job2 = b.jobId;
  const cost2 = b.cost;
  check("flow 2k 10s costs 310", cost2 === 310);
  r = await fetch(base + "/api/dev/jobs/finish", { method: "POST", headers: H_JSON, body: JSON.stringify({ jobId: job2, outcome: "failed" }) });
  check("finish failed", r.status === 200);
  sum = credits.summary(db, uid);
  check("failed refunds reserve", sum.reserved === 0 && sum.balance === before - 240);

  /* moderation rejection refunds with error code */
  r = await fetch(base + "/api/jobs", { method: "POST", headers: H2, body: JSON.stringify({ model: "omni", duration: 5, quality: "768", aspect: "9:16", photo1: up1, photo2: up2 }) });
  b = await j(r);
  const job3 = b.jobId;
  r = await fetch(base + "/api/dev/jobs/finish", { method: "POST", headers: H_JSON, body: JSON.stringify({ jobId: job3, outcome: "rejected" }) });
  b = await j(r);
  check("rejection sets moderation code + refunds", b.job.error_code === "moderation" && credits.summary(db, uid).balance === before - 240);

  /* job list reflects statuses + render urls */
  r = await fetch(base + "/api/jobs", { headers: H2 });
  b = await j(r);
  const byId = {};
  b.jobs.forEach((x) => (byId[x.id] = x));
  check("job list statuses", byId[job1].status === "succeeded" && byId[job1].render.output_url.endsWith("sample-output.svg") && byId[job2].status === "failed" && byId[job3].error_code === "moderation");

  /* zombie sweep fails + refunds */
  r = await fetch(base + "/api/jobs", { method: "POST", headers: H2, body: JSON.stringify({ model: "aurora", duration: 5, quality: "768", aspect: "1:1", photo1: up1, photo2: up2 }) });
  b = await j(r);
  const job4 = b.jobId;
  const old = db.get("jobs", job4);
  old.created = Date.now() - (cfg.jobTimeoutMs + 1000);
  db.set("jobs", job4, old);
  const balBeforeSweep = credits.summary(db, uid).balance;
  const swept = require("./jobs").sweepJobs(db, cfg);
  check("sweep fails zombie", swept >= 1 && db.get("jobs", job4).status === "failed");
  check("sweep refunds zombie", credits.summary(db, uid).balance === balBeforeSweep + db.get("jobs", job4).cost);

  /* static asset for dev renders */
  r = await fetch(base + "/assets/sample-output.svg");
  check("sample render asset served", r.status === 200);

  /* static serving */
  r = await fetch(base + "/");
  const html = await r.text();
  check("static index served", r.status === 200 && /DuoStage/i.test(html) && html.includes("logo-word"));
  r = await fetch(base + "/js/i18n.js");
  check("static js served", r.status === 200);
  r = await fetch(base + "/..%2f..%2fetc%2fpasswd");
  check("traversal blocked", r.status === 403 || r.status === 404);

  /* persistence across db reload */
  db._flush();
  const db2 = createDb(cfg.dataFile);
  check("users persisted to json", db2.all("users").length === 2);

  server.close();
  try { fs.unlinkSync(tmpData); } catch (e) { /* ignore */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("selftest crashed:", e); process.exit(1); });
