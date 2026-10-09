/* DuoStage backend skeleton — tokens & sessions
   Magic-link tokens: random 24 bytes hex, single use, TTL bound.
   Session tokens: "<sessionId>.<hmac>" where hmac covers sessionId|uid|exp,
   and the session row must still exist (so logout revokes immediately). */
"use strict";
const crypto = require("crypto");

function hmacSign(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createMagicToken() {
  return crypto.randomBytes(24).toString("hex");
}

function issueSession(db, cfg, userId) {
  const sessionId = crypto.randomBytes(16).toString("hex");
  const exp = Date.now() + cfg.sessionTtlMs;
  const sig = hmacSign(cfg.secret, sessionId + "|" + userId + "|" + exp);
  db.set("sessions", sessionId, { id: sessionId, userId, created: Date.now(), expires: exp });
  return sessionId + "." + sig;
}

/* returns session row or null */
function verifySession(db, cfg, token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const sessionId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const row = db.get("sessions", sessionId);
  if (!row) return null;
  if (Date.now() > row.expires) { db.del("sessions", sessionId); return null; }
  const expect = hmacSign(cfg.secret, sessionId + "|" + row.userId + "|" + row.expires);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  return row;
}

function revokeSession(db, token) {
  if (!token) return;
  const dot = token.lastIndexOf(".");
  db.del("sessions", dot < 0 ? token : token.slice(0, dot));
}

function bearerToken(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

module.exports = { createMagicToken, issueSession, verifySession, revokeSession, bearerToken };
