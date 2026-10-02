#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
const cwd = process.cwd();
const errors = [];
const markdown = [];
async function walk(dir) {
  for (const row of await fs.readdir(dir, {withFileTypes:true})) {
    if (row.name.startsWith('._')) continue;
    const full = path.join(dir,row.name);
    if (row.isDirectory()) await walk(full);
    else if (row.name.endsWith('.md')) markdown.push(full);
  }
}
for (const file of ['AGENTS.md','GOAL_PROMPT.md','README.md','CONTRIBUTING.md','SECURITY.md']) markdown.push(path.resolve(file));
for (const dir of ['docs','specs','server','packages','tests','public']) await walk(path.resolve(dir));
for (const file of markdown) {
  const text = await fs.readFile(file,'utf8');
  // Only links outside fenced examples are treated as executable references.
  const body = text.replace(/```[\s\S]*?```/g,'');
  for (const match of body.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1];
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const target = decodeURIComponent(href.split('#')[0]);
    try {await fs.access(path.resolve(path.dirname(file),target));}
    catch {errors.push(`${path.relative(cwd,file)}: missing link ${href}`);}
  }
}
const manifest = JSON.parse(await fs.readFile('specs/routes.json','utf8'));
const ids = new Set();
const paths = new Set();
let excluded = 0;
for (const route of manifest.routes) {
  if (ids.has(route.id)) errors.push(`duplicate route id: ${route.id}`);
  ids.add(route.id);
  if (!route.id || !route.owner || !route.phase || !route.coverage || !Array.isArray(route.evidence)) errors.push(`incomplete route: ${route.id}`);
  if (route.path !== null) {
    if (!route.path.startsWith('/')) errors.push(`invalid route path: ${route.id}`);
    if (paths.has(route.path)) errors.push(`duplicate route path: ${route.path}`);
    paths.add(route.path);
  } else if (route.kind !== 'pending-discovery') errors.push(`null path without pending-discovery: ${route.id}`);
  if (route.disposition === 'excluded') {
    excluded++;
    if (!route.excludeReason) errors.push(`excluded without reason: ${route.id}`);
  }
  try {await fs.access(path.resolve('specs',route.spec));}
  catch {errors.push(`route ${route.id}: missing spec ${route.spec}`);}
}
for (const id of ['account-settings','workspace','subscription','payouts','developers','usage','voice-payouts','voice-analytics','voice-opportunities','music-published','iconic-voices']) {
  if (!manifest.routes.some(r=>r.id===id && r.disposition==='excluded')) errors.push(`upstream account/marketing route must be excluded: ${id}`);
}
const local = manifest.routes.filter(r=>r.kind==='local-extension');
if (!local.some(r=>r.id==='local-provider-settings')) errors.push('BYOK local configuration missing');
if (errors.length) {
  console.error(errors.join('\n'));process.exitCode=1;
} else console.log(`PASS: ${markdown.length} Markdown files, ${manifest.routes.length} route entries (${excluded} excluded; ${local.length} local extensions), relative links and scope guards.`);
