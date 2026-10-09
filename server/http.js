/* DuoStage backend skeleton — HTTP helpers + static file serving */
"use strict";
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readJsonBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error("body-too-large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(new Error("bad-json")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(res, webRoot, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const abs = path.normalize(path.join(webRoot, rel));
  /* path traversal guard */
  if (!abs.startsWith(path.normalize(webRoot) + path.sep)) {
    res.writeHead(403); res.end("forbidden"); return;
  }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end("not found"); return; }
    const ext = path.extname(abs).toLowerCase();
    const cacheable = [".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"].includes(ext);
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      /* skeleton phase: never cache html/js/css so edits land immediately */
      "cache-control": cacheable ? "public, max-age=300" : "no-cache",
    });
    fs.createReadStream(abs).pipe(res);
  });
}

function readRawBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error("body-too-large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = { sendJson, readJsonBody, readRawBody, serveStatic, MIME };
