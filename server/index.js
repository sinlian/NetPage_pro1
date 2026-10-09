/* DuoStage backend skeleton — entrypoint
   Run:  node server/index.js        (override with PORT / DS_SECRET / DS_DATA)
   Writes server/server.pid so dev tooling can stop it cleanly. */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { createDb } = require("./db");
const jobs = require("./jobs");
const { createApp } = require("./app");

const db = createDb(config.dataFile);
const server = http.createServer(createApp(config, db));
server.listen(config.port, config.host, () => {
  fs.writeFileSync(path.join(__dirname, "server.pid"), String(process.pid));
  console.log(`[duostage] api + static on http://${config.host}:${config.port} (pid ${process.pid})`);
  console.log("[duostage] dev endpoints:", config.devEndpoints ? "on" : "off");
});

/* zombie-job sweep: pending/running past the timeout fail + refund */
const sweepTimer = setInterval(() => {
  const n = jobs.sweepJobs(db, config);
  if (n) console.log("[duostage] swept", n, "zombie job(s)");
}, 30000);
sweepTimer.unref();

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
