/* DuoStage backend skeleton — credit ledger
   Entry shapes (credit_ledger table):
     grant   { delta:+N }              pack purchased (payment confirmed)
     reserve { delta:-N, refId:job }   job started, credits leave available
     consume { delta: 0, refId:job }   settlement marker: job succeeded
     return  { delta:+N, refId:job }   settlement: confirmed failure refunds
   available(userId) = Σ delta
   reserved(userId)  = Σ |reserve| without a consume/return marker on same refId
   Business rules enforced here:
     - grant happens exactly once per paid order (caller checks order status)
     - a reserve can be settled exactly once (consume OR return) */
"use strict";
const crypto = require("crypto");

function entry(db, userId, reason, delta, refType, refId) {
  const id = "l_" + crypto.randomBytes(10).toString("hex");
  db.set("credit_ledger", id, { id, userId, reason, delta, refType: refType || null, refId: refId || null, created: Date.now() });
  return id;
}

function ledgerFor(db, userId) {
  return db.all("credit_ledger").filter((e) => e.userId === userId).sort((a, b) => a.created - b.created);
}

function available(db, userId) {
  return ledgerFor(db, userId).reduce((sum, e) => sum + e.delta, 0);
}

function settledRefIds(db, userId) {
  return new Set(ledgerFor(db, userId).filter((e) => e.reason === "consume" || e.reason === "return").map((e) => e.refId));
}

function reserved(db, userId) {
  const settled = settledRefIds(db, userId);
  return ledgerFor(db, userId)
    .filter((e) => e.reason === "reserve" && !settled.has(e.refId))
    .reduce((sum, e) => sum + Math.abs(e.delta), 0);
}

function grant(db, userId, amount, refType, refId) {
  if (!(amount > 0)) throw new Error("bad-amount");
  return entry(db, userId, "grant", amount, refType, refId);
}

function reserve(db, userId, amount, refId) {
  if (!(amount > 0)) throw new Error("bad-amount");
  if (available(db, userId) - reserved(db, userId) < amount) return { ok: false, error: "insufficient" };
  entry(db, userId, "reserve", -amount, "job", refId);
  return { ok: true };
}

/* settle a reserve exactly once; returns error if already settled or unknown */
function settle(db, userId, refId, kind) {
  if (kind !== "consume" && kind !== "return") throw new Error("bad-kind");
  const holds = ledgerFor(db, userId).filter((e) => e.reason === "reserve" && e.refId === refId);
  if (!holds.length) return { ok: false, error: "unknown-ref" };
  if (settledRefIds(db, userId).has(refId)) return { ok: false, error: "already-settled" };
  const amount = Math.abs(holds[0].delta);
  if (kind === "consume") entry(db, userId, "consume", 0, "job", refId);
  else entry(db, userId, "return", amount, "job", refId);
  return { ok: true, amount };
}

function summary(db, userId) {
  return {
    balance: available(db, userId),
    reserved: reserved(db, userId),
    ledger: ledgerFor(db, userId).slice(-20).reverse(),
  };
}

module.exports = { grant, reserve, settle, summary, available, reserved };
