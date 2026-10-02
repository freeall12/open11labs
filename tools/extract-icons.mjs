#!/usr/bin/env node
/**
 * Extract real SVG icon components from the source site's JS bundles.
 *
 * The app ships two icon libraries, both minified, both recoverable:
 *
 *   A. components declared as `(0,x.memo)(function(...){...})` with a
 *      `displayName="Name"` tag, wrapping children in a fixed
 *      `<svg width=18 height=18 viewBox="0 0 18 18">` with strokeWidth 1.5.
 *   B. components registered as `"Name",0,function({size,color,...})`, whose
 *      children carry their own strokeWidth.
 *
 * Both are keyed by the icon's declared name, so the replica can use the real
 * artwork instead of hand-drawn approximations.
 *
 * Usage:
 *   node tools/extract-icons.mjs <bundle.js> --list
 *   node tools/extract-icons.mjs <bundle.js> --match <re>
 *   node tools/extract-icons.mjs <bundle.js> IconNameA IconNameB ...
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , bundlePath, ...args] = process.argv;

if (!bundlePath) {
  console.error(
    "usage: extract-icons.mjs <bundle.js> [--list|--match <re>|IconName...]",
  );
  process.exit(1);
}

const src = readFileSync(bundlePath, "utf8");

/* ---------------------------------------------------------------- naming -- */

/** Library A names. */
const namesA = [...src.matchAll(/displayName="([A-Za-z0-9_]+)"/g)].map(
  (m) => m[1],
);

/** Library B names, as registered in the module export map. */
const namesB = [
  ...src.matchAll(/"([A-Za-z][A-Za-z0-9_]{2,40})",0,function\(\{size:/g),
].map((m) => m[1]);

const allNames = [...new Set([...namesA, ...namesB])];

if (args[0] === "--list") {
  console.log([...allNames].sort().join("\n"));
  process.exit(0);
}

if (args[0] === "--match") {
  const re = new RegExp(args[1], "i");
  const hits = [...allNames].filter((n) => re.test(n)).sort();
  console.log(hits.join("\n"));
  console.error(`\n${hits.length} match(es)`);
  process.exit(0);
}

const wanted = args.filter((a) => !a.startsWith("--"));

/* --------------------------------------------------------------- scanning -- */

/**
 * Walk forward from `start` to the matching close of `open`, skipping string
 * literals — path data is full of characters that would skew a naive count.
 */
function matchDelim(text, start, open, close) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Offset of the `memo(function...)` that owns the component at `from`. */
function lastMemoBefore(from) {
  const re = /\(0,[A-Za-z0-9_$]+\.memo\)\(function/g;
  let found = -1;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index >= from) break;
    found = m.index;
  }
  return found;
}

/**
 * Return the raw `children:` expression of a component.
 *
 * The value is a call chain (`(0,o.jsx)("path",{…})[(0,o.jsx)("circle",{…})]`),
 * so every group is internally balanced. Scanning until the depth would drop
 * below zero lands exactly on the closer of the props object the value sits in.
 */
function readChildren(childrenAt) {
  const start = childrenAt + "children:".length;
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth < 0) return src.slice(start, i).trim();
    }
  }
  return null;
}

function fromLibraryA(name) {
  const at = src.indexOf(`displayName="${name}"`);
  if (at < 0) return null;

  const memoAt = lastMemoBefore(at);
  if (memoAt < 0) return null;

  // Skip `function(<params>)` — the first `{` there is the destructured args.
  const fnAt = src.indexOf("function", memoAt);
  if (fnAt < 0) return null;
  const parenAt = src.indexOf("(", fnAt);
  if (parenAt < 0) return null;
  const parenEnd = matchDelim(src, parenAt, "(", ")");
  if (parenEnd < 0) return null;

  const brace = src.indexOf("{", parenEnd);
  if (brace < 0) return null;
  const bodyEnd = matchDelim(src, brace, "{", "}");
  if (bodyEnd < 0) return null;

  const body = src.slice(brace + 1, bodyEnd);
  const ci = body.lastIndexOf("children:");
  if (ci < 0) return null;
  return readChildrenIn(body, ci);
}

function fromLibraryB(name) {
  const at = src.indexOf(`"${name}",0,function({size:`);
  if (at < 0) return null;
  const ci = src.indexOf("children:", at);
  if (ci < 0 || ci - at > 3000) return null;
  return readChildren(ci);
}

function readChildrenIn(body, ci) {
  const start = ci + "children:".length;
  let depth = 0;
  let quote = null;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth < 0) return body.slice(start, i).trim();
    }
  }
  return null;
}

/* ------------------------------------------------------------- rendering -- */

/** Turn a minified children expression into standalone SVG markup. */
function toSvgMarkup(expr) {
  return expr
    .replace(
      /\(0,[A-Za-z0-9_$]+\.jsx\)\("([a-z]+)",\s*\{([\s\S]*?)\}\)/g,
      (_m, tag, props) => {
        const attrs = [];
        for (const p of props.matchAll(
          /([A-Za-z][A-Za-z0-9]*):\s*("(?:[^"\\]|\\.)*")/g,
        )) {
          const value = p[2].slice(1, -1).replace(/"/g, "&quot;");
          const attr = p[1]
            .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
            .toLowerCase();
          attrs.push(`${attr}="${value}"`);
        }
        return `<${tag} ${attrs.join(" ")} />`;
      },
    )
    .replace(/^\[|\]$/g, "")
    // Sibling elements arrive comma-separated; drop the separators so the
    // markup is valid JSX rather than stray text nodes.
    .replace(/>\s*,\s*</g, "><");
}

/* ------------------------------------------------------------------ main -- */

const results = {};
for (const name of wanted) {
  const raw = fromLibraryA(name) ?? fromLibraryB(name);
  if (!raw) {
    console.error(`  ! ${name}: not found`);
    continue;
  }
  results[name] = toSvgMarkup(raw);
}

for (const [name, markup] of Object.entries(results)) {
  console.log(`--- ${name}`);
  console.log(markup);
}

if (process.env.OUT) {
  writeFileSync(process.env.OUT, JSON.stringify(results, null, 2));
  console.error(`\nwrote ${Object.keys(results).length} -> ${process.env.OUT}`);
}
