/* DuoStage Workers — configuration from env with dev defaults */
export function loadConfig(env = {}) {
  return {
    secret: env.DS_SECRET || "dev-secret-change-me",
    sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
    linkTtlMs: 15 * 60 * 1000,
    devEndpoints: env.DS_DEV_ENDPOINTS !== "off",
    /* Google OAuth — set via wrangler secret / dashboard vars; absent = 501 */
    googleClientId: env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || "",
    /* overridable for offline tests */
    googleAuthUrl: env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
    googleTokenUrl: env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
    googleJwksUrl: env.GOOGLE_JWKS_URL || "https://www.googleapis.com/oauth2/v3/certs",
    packs: {
      single:  { usd: 4.99,  credits: 240 },
      starter: { usd: 9.90,  credits: 480 },
      creator: { usd: 24.90, credits: 1440 },
      studio:  { usd: 49.90, credits: 3360 },
    },
    creditTable: {
      aurora: { "768": { 5: 160, 10: 200, 15: 240 }, "2k": { 5: 260, 10: 325, 15: 390 } },
      flow:   { "768": { 5: 150, 10: 190, 15: 230 }, "2k": { 5: 245, 10: 310, 15: 370 } },
      omni:   { "768": { 5: 170, 10: 210, 15: 250 }, "2k": { 5: 275, 10: 340, 15: 405 } },
    },
    maxActiveJobs: 3,
    jobTimeoutMs: 10 * 60 * 1000,
    renderTtlMs: 30 * 24 * 60 * 60 * 1000,
    maxUploadBytes: 10 * 1024 * 1024,
  };
}
