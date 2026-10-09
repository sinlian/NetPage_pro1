/* DuoStage backend skeleton — configuration */
"use strict";
const path = require("path");

module.exports = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 8787),
  /* HMAC secret for session tokens — override in production via env */
  secret: process.env.DS_SECRET || "dev-secret-change-me",
  sessionTtlMs: 1000 * 60 * 60 * 24 * 7, /* 7 days */
  linkTtlMs: 15 * 60 * 1000,            /* 15 minutes, matches product policy */
  /* JSON file repository; swap for SQLite/Postgres behind db.js interface */
  dataFile: process.env.DS_DATA || path.join(__dirname, "data.json"),
  /* web root served statically (the existing static site) */
  webRoot: path.join(__dirname, ".."),
  /* dev-only endpoints (inbox listing). Disable in production. */
  devEndpoints: process.env.DS_DEV_ENDPOINTS !== "off",

  /* ---- pricing: single source of truth for packs & credit costs ---- */
  packs: {
    single:  { usd: 4.99,  credits: 240 },
    starter: { usd: 9.90,  credits: 480 },
    creator: { usd: 24.90, credits: 1440 },
    studio:  { usd: 49.90, credits: 3360 },
  },
  /* credits per video: model -> quality -> duration seconds */
  creditTable: {
    aurora: { "768": { 5: 160, 10: 200, 15: 240 }, "2k": { 5: 260, 10: 325, 15: 390 } },
    flow:   { "768": { 5: 150, 10: 190, 15: 230 }, "2k": { 5: 245, 10: 310, 15: 370 } },
    omni:   { "768": { 5: 170, 10: 210, 15: 250 }, "2k": { 5: 275, 10: 340, 15: 405 } },
  },

  /* ---- jobs / uploads ---- */
  maxActiveJobs: 3,                       /* per-user concurrent pending+running cap */
  jobTimeoutMs: 10 * 60 * 1000,           /* zombie sweep: pending/running older than this fail + refund */
  renderTtlMs: 30 * 24 * 60 * 60 * 1000,  /* renders hosted 30 days in dev */
  uploadsDir: process.env.DS_UPLOADS || path.join(__dirname, "uploads"),
  maxUploadBytes: 10 * 1024 * 1024,
};
