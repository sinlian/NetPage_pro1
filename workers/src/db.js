/* DuoStage Workers — repository over KV (one key per record)
   Key shape: t:<table>:<id>.  The rest of the worker only talks to this
   module, so swapping storage later means rewriting this file only.
   createMemoryKv() provides the same surface for the Node selftest. */

const TABLES = ["users", "magic_links", "sessions", "dev_inbox", "orders", "credit_ledger", "jobs", "uploads", "renders"];

export function createKvDb(kv) {
  async function all(table) {
    const prefix = `t:${table}:`;
    const out = [];
    let cursor;
    do {
      const list = await kv.list({ prefix, cursor });
      for (const k of list.keys) {
        const v = await kv.get(k.name, "json");
        if (v) out.push(v);
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
    return out;
  }
  return {
    all,
    async get(table, id) {
      return (await kv.get(`t:${table}:${id}`, "json")) || null;
    },
    async set(table, id, obj) {
      await kv.put(`t:${table}:${id}`, JSON.stringify(obj));
      return obj;
    },
    async del(table, id) {
      await kv.delete(`t:${table}:${id}`);
    },
    async find(table, pred) {
      const rows = await all(table);
      return rows.find(pred) || null;
    },
  };
}

/* in-memory KV shim for tests: get/put/delete/list({prefix,cursor}) */
export function createMemoryKv() {
  const map = new Map();
  return {
    async get(key, type) {
      const raw = map.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key, value) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    async list({ prefix = "", cursor } = {}) {
      const keys = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? keys.indexOf(cursor) : 0;
      const page = keys.slice(start < 0 ? 0 : start, (start < 0 ? 0 : start) + 1000);
      const next = (start < 0 ? 0 : start) + 1000;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: next >= keys.length,
        cursor: next < keys.length ? keys[next] : undefined,
      };
    },
  };
}

export { TABLES };
