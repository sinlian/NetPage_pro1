/* DuoStage backend skeleton — JSON file repository
   Tables: users, magic_links, sessions, dev_inbox.
   The rest of the server only talks to this module, so swapping the
   storage engine (SQLite / Postgres) later means rewriting this file only. */
"use strict";
const fs = require("fs");
const path = require("path");

const TABLES = ["users", "magic_links", "sessions", "dev_inbox", "orders", "credit_ledger", "jobs", "uploads", "renders"];

function createDb(file) {
  let state = {};
  TABLES.forEach((t) => (state[t] = {}));

  /* load */
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      TABLES.forEach((t) => { if (raw[t]) state[t] = raw[t]; });
    }
  } catch (e) {
    console.error("[db] failed to load, starting empty:", e.message);
  }

  let saveTimer = null;
  function save() {
    /* debounce + atomic replace */
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const tmp = file + ".tmp";
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, file);
      } catch (e) {
        console.error("[db] save failed:", e.message);
      }
    }, 30);
  }

  return {
    all(table) { return Object.values(state[table] || {}); },
    get(table, id) { return (state[table] || {})[id] || null; },
    set(table, id, obj) { state[table][id] = obj; save(); return obj; },
    del(table, id) { delete state[table][id]; save(); },
    find(table, pred) { return Object.values(state[table] || {}).find(pred) || null; },
    _flush() { /* test hook: synchronous persist */
      if (saveTimer) clearTimeout(saveTimer);
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    },
  };
}

module.exports = { createDb, TABLES };
