/* DuoStage Workers — Google OAuth (OIDC authorization-code flow)
   1) GET /api/auth/google            -> 302 to accounts.google.com consent
   2) GET /api/auth/google/callback   -> code exchange + id_token verification
   id_token is fully verified: RS256 signature against Google JWKS,
   iss / aud / exp checks. Endpoints are overridable via cfg for offline tests. */

const enc = new TextEncoder();

function b64urlBytes(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlString(s) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeJson(seg) {
  const pad = seg.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function buildAuthUrl(cfg, state, redirectUri) {
  const q = new URLSearchParams({
    client_id: cfg.googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return cfg.googleAuthUrl + "?" + q.toString();
}

export async function exchangeCode(cfg, code, redirectUri) {
  const res = await fetch(cfg.googleTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.googleClientId,
      client_secret: cfg.googleClientSecret || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !body.id_token) return { ok: false, error: "token-exchange-failed" };
  return { ok: true, idToken: body.id_token };
}

/* full RS256 verification against the JWKS endpoint */
export async function verifyIdToken(cfg, idToken) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) return { ok: false, error: "malformed" };
  let header, claims;
  try {
    header = b64urlDecodeJson(parts[0]);
    claims = b64urlDecodeJson(parts[1]);
  } catch (e) {
    return { ok: false, error: "malformed" };
  }
  if (header.alg !== "RS256") return { ok: false, error: "bad-alg" };
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && now >= claims.exp) return { ok: false, error: "expired" };
  const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issOk) return { ok: false, error: "bad-iss" };
  if (claims.aud !== cfg.googleClientId) return { ok: false, error: "bad-aud" };
  /* signature */
  const jwks = await fetch(cfg.googleJwksUrl).then((r) => r.json()).catch(() => null);
  if (!jwks || !jwks.keys) return { ok: false, error: "jwks-unreachable" };
  const jwk = jwks.keys.find((k) => k.kid === header.kid) || jwks.keys[0];
  if (!jwk) return { ok: false, error: "no-key" };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const sigSeg = parts[2].replace(/-/g, "+").replace(/_/g, "/");
  const sigBin = atob(sigSeg + "=".repeat((4 - (sigSeg.length % 4)) % 4));
  const sig = Uint8Array.from(sigBin, (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, enc.encode(parts[0] + "." + parts[1]));
  if (!valid) return { ok: false, error: "bad-signature" };
  return { ok: true, claims };
}

export { b64urlString };
