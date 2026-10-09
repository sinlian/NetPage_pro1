/* Sync the static site from the repo root into workers/public/
   (Workers Static Assets serving directory). Run after editing any
   html/css/js/svg:  node scripts/sync-public.mjs */
import { copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "workers", "public");

const FILES = [
  "index.html", "login.html", "account.html", "checkout-dev.html",
  "dev-inbox.html", "dev-jobs.html",
  "css/style.css",
  "assets/sample-output.svg",
];

mkdirSync(join(pub, "css"), { recursive: true });
mkdirSync(join(pub, "js"), { recursive: true });
mkdirSync(join(pub, "assets"), { recursive: true });

let n = 0;
for (const f of FILES) {
  const src = join(root, f);
  if (!existsSync(src)) { console.warn("skip missing:", f); continue; }
  copyFileSync(src, join(pub, f));
  n++;
}
for (const f of readdirSync(join(root, "js"))) {
  if (!f.endsWith(".js")) continue;
  copyFileSync(join(root, "js", f), join(pub, "js", f));
  n++;
}
console.log(`synced ${n} files -> workers/public/`);
