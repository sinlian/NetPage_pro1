/* DuoStage Workers — dev smoke: quick API flow check (login -> upload -> job -> finish -> renders)
   Pure Node against the in-memory shims; handy before deploying.
   Usage: node workers/debug-renders.mjs */
import worker from "./src/index.js";
import { createMemoryKv } from "./src/db.js";
import { createMemoryBucket } from "./src/r2.js";
import { loadConfig } from "./src/config.js";

const env = { DS_KV: createMemoryKv(), DS_R2: createMemoryBucket(), DS_SECRET: "t", DS_DEV_ENDPOINTS: "on",
  ASSETS: { async fetch() { return new Response("x"); } } };
const BASE = "http://w.internal";
async function api(p, o = {}) { const r = await worker.fetch(new Request(BASE + p, o), env, {}); let b = null; try { b = await r.json(); } catch (e) {} return { status: r.status, body: b }; }
const jp = (p, obj, h = {}) => api(p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(obj) });

await jp("/api/auth/magic-link", { email: "smoke@duostage.dev" });
const inbox = await api("/api/dev/inbox");
const cons = await jp("/api/auth/consume", { token: inbox.body.items[0].id });
const B = { authorization: "Bearer " + cons.body.token };
const ps1 = await jp("/api/uploads/presign", { mime: "image/png", size: 2, slot: 1 }, B);
await api(ps1.body.putUrl, { method: "PUT", body: new Uint8Array([1, 2]) });
const ps2 = await jp("/api/uploads/presign", { mime: "image/png", size: 2, slot: 2 }, B);
await api(ps2.body.putUrl, { method: "PUT", body: new Uint8Array([2, 1]) });
const co = await jp("/api/checkout", { pack: "single" }, B);
await jp("/api/pay/confirm", { orderId: co.body.orderId, outcome: "success" });
const jb = await jp("/api/jobs", { model: "aurora", duration: 5, quality: "768", aspect: "9:16", photo1: ps1.body.uploadId, photo2: ps2.body.uploadId }, B);
const fin = await jp("/api/dev/jobs/finish", { jobId: jb.body.jobId, outcome: "success" });
const lib = await api("/api/renders", { headers: B });
console.log("smoke:", jb.status === 200 && fin.status === 200 && lib.body.renders.length === 1 ? "OK" : "BROKEN",
  "| render:", lib.body.renders[0] && lib.body.renders[0].render.id,
  "| download:", lib.body.renders[0] && lib.body.renders[0].render.download_url.slice(0, 40));
