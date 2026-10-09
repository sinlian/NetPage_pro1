/* DuoStage Workers — tokens & sessions (Web Crypto HMAC)
   Magic-link tokens: random 24 bytes hex, single use, TTL bound.
   Session tokens: "<sessionId>.<hmac>" where hmac covers sessionId|uid|exp,
   and the session row must still exist (so logout revokes immediately). */

const enc = new TextEncoder();

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function createMagicToken() {
  return hex(crypto.getRandomValues(new Uint8Array(24)));
}

async function hmacSign(secret, payload) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueSession(db, cfg, userId) {
  const sessionId = hex(crypto.getRandomValues(new Uint8Array(16)));
  const exp = Date.now() + cfg.sessionTtlMs;
  const sig = await hmacSign(cfg.secret, sessionId + "|" + userId + "|" + exp);
  await db.set("sessions", sessionId, { id: sessionId, userId, created: Date.now(), expires: exp });
  return sessionId + "." + sig;
}

/* returns session row or null */
export async function verifySession(db, cfg, token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const sessionId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const row = await db.get("sessions", sessionId);
  if (!row) return null;
  if (Date.now() > row.expires) { await db.del("sessions", sessionId); return null; }
  const expect = await hmacSign(cfg.secret, sessionId + "|" + row.userId + "|" + row.expires);
  if (!timingSafeEqualStr(sig, expect)) return null;
  return row;
}

export async function revokeSession(db, token) {
  if (!token) return;
  const dot = token.lastIndexOf(".");
  await db.del("sessions", dot < 0 ? token : token.slice(0, dot));
}

export function bearerToken(request) {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
