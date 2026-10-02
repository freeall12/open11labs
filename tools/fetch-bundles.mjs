#!/usr/bin/env node
/**
 * Download the two JS bundles that carry the app's icon libraries.
 *
 * The bundles are not committed — they are ~1.4 MB of the source site's own
 * minified code. Run this once, then `node tools/build-icons.mjs` regenerates
 * src/lib/icons.tsx from whatever the current bundles contain.
 *
 * Both URLs are discovered from the public stylesheet/page, not hardcoded
 * blindly, so a CDN chunk rename can be recovered by re-running discovery.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://elevenlabs.io";
const PAGE = `${ORIGIN}/app/home`;

/* Bundles picked by content signature — see README. */
const TARGETS = [
  { out: "icons-bundle.js", need: 'viewBox:"0 0 18 18"', minPaths: 1500 },
  { out: "nav-bundle.js", need: ",0,function({size:", minIcons: 150 },
];

const page = await (await fetch(PAGE)).text();
const urls = [
  ...new Set(
    [...page.matchAll(/"(\/app_assets\/_next\/static\/chunks\/[^"]+\.js)"/g)].map(
      (m) => m[1],
    ),
  ),
];
console.error(`discovered ${urls.length} chunk urls`);

for (const target of TARGETS) {
  let found = null;

  for (const url of urls) {
    const res = await fetch(ORIGIN + url);
    if (!res.ok) continue;
    const text = await res.text();

    const ok =
      target.need === undefined ||
      (target.need && text.includes(target.need));
    if (!ok) continue;

    const paths = (text.match(/d:"M/g) || []).length;
    const icons = (
      text.match(/"[A-Za-z][A-Za-z0-9_]{2,40}",0,function\(\{size:/g) || []
    ).length;

    const enough =
      target.minPaths ? paths >= target.minPaths
      : target.minIcons ? icons >= target.minIcons
      : true;

    if (enough) {
      found = { url, text, paths, icons };
      break;
    }
  }

  if (!found) {
    console.error(`!! could not locate a bundle for ${target.out}`);
    process.exitCode = 1;
    continue;
  }

  writeFileSync(join(here, target.out), found.text);
  console.error(
    `wrote ${target.out}  ${(found.text.length / 1024).toFixed(0)}KB  ` +
      `paths=${found.paths} icons=${found.icons}  <- ${found.url.split("/").pop()}`,
  );
}

console.error("\nnext: node tools/build-icons.mjs");
