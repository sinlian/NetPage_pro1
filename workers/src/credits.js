/* DuoStage Workers — credit ledger (async over the KV repository)
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

function hex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

async function entry(db, userId, reason, delta, refType, refId) {
  const id = "l_" + hex(crypto.getRandomValues(new Uint8Array(10)));
  await db.set("credit_ledger", id, { id, userId, reason, delta, refType: refType || null, refId: refId || null, created: Date.now() });
  return id;
}

async function ledgerFor(db, userId) {
  const rows = await db.all("credit_ledger");
  return rows.filter((e) => e.userId === userId).sort((a, b) => a.created - b.created);
}

async function available(db, userId) {
  const rows = await ledgerFor(db, userId);
  return rows.reduce((sum, e) => sum + e.delta, 0);
}

async function settledRefIds(db, userId) {
  const rows = await ledgerFor(db, userId);
  return new Set(rows.filter((e) => e.reason === "consume" || e.reason === "return").map((e) => e.refId));
}

async function reserved(db, userId) {
  const rows = await ledgerFor(db, userId);
  const settled = await settledRefIds(db, userId);
  return rows
    .filter((e) => e.reason === "reserve" && !settled.has(e.refId))
    .reduce((sum, e) => sum + Math.abs(e.delta), 0);
}

export async function grant(db, userId, amount, refType, refId) {
  if (!(amount > 0)) throw new Error("bad-amount");
  return entry(db, userId, "grant", amount, refType, refId);
}

export async function reserve(db, userId, amount, refId) {
  if (!(amount > 0)) throw new Error("bad-amount");
  if ((await available(db, userId)) - (await reserved(db, userId)) < amount) return { ok: false, error: "insufficient" };
  await entry(db, userId, "reserve", -amount, "job", refId);
  return { ok: true };
}

/* settle a reserve exactly once; error if already settled or unknown */
export async function settle(db, userId, refId, kind) {
  if (kind !== "consume" && kind !== "return") throw new Error("bad-kind");
  const rows = await ledgerFor(db, userId);
  const holds = rows.filter((e) => e.reason === "reserve" && e.refId === refId);
  if (!holds.length) return { ok: false, error: "unknown-ref" };
  if ((await settledRefIds(db, userId)).has(refId)) return { ok: false, error: "already-settled" };
  const amount = Math.abs(holds[0].delta);
  if (kind === "consume") await entry(db, userId, "consume", 0, "job", refId);
  else await entry(db, userId, "return", amount, "job", refId);
  return { ok: true, amount };
}

export async function summary(db, userId) {
  const rows = await ledgerFor(db, userId);
  return {
    balance: await available(db, userId),
    reserved: await reserved(db, userId),
    ledger: rows.slice(-20).reverse(),
  };
}

export { available, reserved };
