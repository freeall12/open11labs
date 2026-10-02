#!/usr/bin/env node
// Local-only index. Never copies reference material into public assets.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(process.argv[2] || 'research/elevenlabs-2026-10-02');
const jsonl = async name => (await fs.readFile(path.join(root, name), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const evidence = await jsonl('evidence.jsonl');
const actions = await jsonl('actions.jsonl');
const escape = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const csv = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const files = [];
const rows = [];
for (const e of evidence) {
  const a = actions.find(x => x.id === e.id || x.id + '-failed' === e.id);
  rows.push(`| ${escape(e.id)} | ${escape(new URL(e.url).pathname + new URL(e.url).search)} | [截图](${e.screenshot}) · [快照](${e.snapshot}) | ${a?.error ? '点击失败，已保留现场' : a ? '点击有回执；需检查结果是否稳定' : '观察快照，不能认定点击已验证'} | ${escape(e.note)} |`);
  for (const relative of [e.screenshot, e.snapshot]) {
    const bytes = await fs.readFile(path.join(root, relative));
    files.push({ path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
}
const controls = new Map();
for (const e of evidence) for (const c of e.controls) {
  const url = new URL(e.url); const route = url.pathname + url.search;
  const key = JSON.stringify([route, c.tag, c.role, c.text, c.href, c.type]);
  if (!controls.has(key)) controls.set(key, { route, ...c, evidence: new Set() });
  controls.get(key).evidence.add(e.id);
}
const header = ['route','tag','role','text','href','type','disabled','expanded','status','evidence'];
const records = [...controls.values()].map(c => [c.route,c.tag,c.role,c.text,c.href,c.type,c.disabled,c.expanded,'仅观察控件；实测响应见 interaction-findings.md',[...c.evidence].join(';')]);
await fs.writeFile(path.join(root, 'buttons.csv'), [header,...records].map(r => r.map(csv).join(',')).join('\n')+'\n');
await fs.writeFile(path.join(root, 'INDEX.md'), `# 本地私有调研索引\n\n${evidence.length} 条 UI 证据，${actions.length} 条动作日志，${new Set(evidence.map(e=>e.url)).size} 个 URL（包括查询参数和个人项目 URL），${controls.size} 种去重控件记录。数字不等于覆盖率。\n\n**包含账号标识、个人项目和参考素材，不得提交或公开。**\n\n- [按钮清单](buttons.csv)\n- [动作日志](actions.jsonl)\n- [观察日志](evidence.jsonl)\n- [实测结论](interaction-findings.md)\n- [文件校验清单](manifest.json)\n\n| 证据 ID | 路径 | 文件 | 测试性质 | 备注 |\n|---|---|---|---|---|\n${rows.join('\n')}\n`);
await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ evidenceCount:evidence.length, actionCount:actions.length, observedUrlCount:new Set(evidence.map(e=>e.url)).size, controlRecordCount:controls.size, files },null,2)+'\n');
console.log(JSON.stringify({ evidence:evidence.length, actions:actions.length, urls:new Set(evidence.map(e=>e.url)).size, controlRecords:controls.size }));
