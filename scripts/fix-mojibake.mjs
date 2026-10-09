/* One-off repair: line-level fix for GBK->UTF-8 double-encoding damage in index.html
   (PowerShell Set-Content incident, 2026-10-09). Replaces the damaged
   <option value="zh"> line and the two thumb-arrow lines by line match. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "index.html");
const lines = readFileSync(file, "utf8").split(/\r?\n/);
let fixed = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<option value="zh">') && !lines[i].includes(">中文<")) {
    lines[i] = '        <option value="zh">中文</option>';
    fixed++;
  } else if (lines[i].includes('class="thumb-arrow"') && !lines[i].includes(">→</span>")) {
    lines[i] = '            <span class="thumb-arrow">→</span>';
    fixed++;
  }
}
writeFileSync(file, lines.join("\n"), "utf8");
console.log("fixed lines:", fixed);
