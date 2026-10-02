#!/usr/bin/env node
/**
 * Build a visual contact sheet of extracted icons so they can be matched
 * against the real page by eye, instead of guessing from display names.
 *
 * Usage: node tools/icon-sheet.mjs <bundle.js> <out.html> IconName...
 */

import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [, , bundlePath, outPath, ...names] = process.argv;
if (!bundlePath || !outPath || names.length === 0) {
  console.error("usage: icon-sheet.mjs <bundle.js> <out.html> IconName...");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, ".icons.json");

// The extractor writes JSON to $OUT and prints markup to stdout.
execFileSync(
  process.execPath,
  [join(here, "extract-icons.mjs"), bundlePath, ...names],
  { env: { ...process.env, OUT: tmp }, stdio: "ignore" },
);

const extracted = JSON.parse(readFileSync(tmp, "utf8"));
unlinkSync(tmp);

/* The extractor already emits standalone SVG markup. */

const cells = names
  .map((n) => {
    const raw = extracted[n];
    if (!raw) {
      return `<div class="cell miss">${n}<br><small>MISSING</small></div>`;
    }
    return `<div class="cell">
      <svg fill="none" xmlns="http://www.w3.org/2000/svg" width="72" height="72"
           viewBox="0 0 18 18" style="stroke-width:1.5;color:#111">${raw}</svg>
      <span>${n}</span>
    </div>`;
  })
  .join("\n");

writeFileSync(
  outPath,
  `<!doctype html><meta charset="utf-8">
<style>
  body{font:12px ui-sans-serif,system-ui;background:#fff;color:#111;margin:24px}
  h1{font-size:15px;margin:0 0 16px}
  .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}
  .cell{border:1px solid #e5e5e5;border-radius:10px;padding:10px;text-align:center}
  .cell svg{stroke:currentColor}
  .cell span{display:block;margin-top:6px;font-size:10px;color:#555;word-break:break-all}
  .miss{border-color:#f00;color:#c00}
</style>
<h1>Icon candidates — ${names.length}</h1>
<div class="grid">${cells}</div>`,
);

console.error(`wrote ${outPath} (${names.length} icons)`);
