#!/usr/bin/env node
// QA Scout — https://github.com/radyelkasas/qa-scout · by Rady Elkasas (https://radyelkasas.com/) · MIT License
// Builds the reports for a run: report/*.md (index, one per page, interconnections, backend) + report.html dashboard.
// Usage: node report.js <runDir>
// Narrative written by the tester is merged from <runDir>/narrative/{summary,interconnections,<pageId>}.md.
const fs = require('fs'); const path = require('path');
const runDir = path.resolve(process.argv[2] || '.');
const read = f => { try { return fs.readFileSync(path.join(runDir, f), 'utf8'); } catch { return ''; } };
const lines = f => read(f).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const cfg = JSON.parse(read('config.json') || '{}');
const L = cfg.reportLanguage === 'ar' ? {
  title: 'تقرير الاختبار', page: 'الصفحة', steps: 'الخطوات المنفذة', findings: 'الملاحظات', works: 'ما يعمل جيداً', notTested: 'لم يُختبر', sev: 'الخطورة', finding: 'الملاحظة', where: 'الموضع', evidence: 'الدليل', video: 'الفيديو', audit: 'فحص آلي (مرشّحات تحتاج تأكيد)', retracted: 'ملاحظات سُحبت بعد التحقق', flows: 'مسارات العمل والترابط', verdict: 'الحكم', none: 'لا يوجد', expected: 'المتوقع', actual: 'الفعلي', top: 'أهم الملاحظات', pages: 'الصفحات', backend: 'ملاحظات الخادم والبيانات', summary: 'الملخص',
} : {
  title: 'QA report', page: 'Page', steps: 'Steps performed', findings: 'Findings', works: 'What works', notTested: 'Not tested', sev: 'Sev', finding: 'Finding', where: 'Where', evidence: 'Evidence', video: 'Video', audit: 'Automated audit (candidates — verify before reporting)', retracted: 'Retracted after verification', flows: 'Workflows & interconnections', verdict: 'Verdict', none: 'None', expected: 'Expected', actual: 'Actual', top: 'Top findings', pages: 'Pages', backend: 'Backend & data findings', summary: 'Summary',
};
const SEV = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };
const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// Findings with retractions applied (last record per id wins).
const raw = lines('findings.jsonl'); const byId = new Map(); const retracted = [];
for (const r of raw) { if (r.retracted) { const prev = byId.get(r.id); if (prev) { byId.delete(r.id); retracted.push({ ...prev, reason: r.reason }); } } else byId.set(r.id, r); }
const findings = [...byId.values()].sort((a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9));
const steps = lines('steps.jsonl'); const notes = lines('notes.jsonl'); const flows = lines('flows.jsonl'); const audits = lines('audit.jsonl');
const pages = (cfg.pages || []).map(p => p.id);
for (const f of findings) if (f.page && !pages.includes(f.page)) pages.push(f.page);
const pageMeta = id => (cfg.pages || []).find(p => p.id === id) || { id, url: id };
const narrative = f => read(path.join('narrative', f)).trim();
const outDir = path.join(runDir, 'report'); fs.mkdirSync(outDir, { recursive: true });
const rel = p => p ? '../' + p.replace(/\\/g, '/') : '';
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const counts = f => Object.fromEntries(Object.keys(SEV).map(s => [s, f.filter(x => x.severity === s).length]));
const countStr = c => Object.entries(c).filter(([, n]) => n).map(([s, n]) => `${SEV[s]} ${n}`).join(' · ') || '—';

function findingBlock(f) {
  const parts = [`### ${SEV[f.severity] || ''} ${f.id} — ${f.title}`, '', `**${L.sev}:** ${f.severity} · **category:** ${f.category}${f.layer ? ' · **layer:** ' + f.layer : ''}${f.verifiedBy ? ' · **verified by:** ' + f.verifiedBy : ''}${f.status === 'suspected' ? ' · ⚠ suspected' : ''}`];
  if (f.steps?.length) parts.push('', '**Steps:**', ...f.steps.map((s, i) => `${i + 1}. ${s}`));
  if (f.expected) parts.push('', `**${L.expected}:** ${f.expected}`);
  if (f.actual) parts.push('', `**${L.actual}:** ${f.actual}`);
  if (f.detail) parts.push('', f.detail);
  if (f.where) parts.push('', `**${L.where}:** \`${f.where}\``);
  const ev = [];
  if (f.screenshot) ev.push(`![${f.id}](${rel(f.screenshot)})`);
  if (f.video) ev.push(`- ${L.video}: \`${f.video}\``);
  if (f.url) ev.push(`- URL: \`${f.url}\``);
  if (f.network?.length) ev.push('- Network: ' + f.network.map(n => `\`${n.method} ${n.url} → ${n.status}\``).join(', '));
  if (ev.length) parts.push('', `**${L.evidence}:**`, '', ...ev.map((e, i) => i === 0 && e.startsWith('![') ? e + '\n' : e));
  return parts.join('\n');
}

// ---------- per-page reports ----------
for (const id of pages) {
  const m = pageMeta(id); const pf = findings.filter(f => f.page === id);
  const st = steps.filter(s => s.page === id); const works = notes.filter(n => n.page === id && n.type === 'pass'); const gaps = notes.filter(n => n.page === id && n.type === 'not-tested');
  const au = audits.filter(a => a.page === id);
  const md = [`# ${id} — \`${m.url}\``, '', ...(m.notes ? [`> ${m.notes}`, ''] : []), `${L.video}: \`videos/${id}.webm\` · ${L.findings}: ${countStr(counts(pf))}`, ''];
  const nar = narrative(id + '.md'); if (nar) md.push(nar, '');
  md.push(`## ${L.steps}`, '', ...(st.length ? st.map((s, i) => `${i + 1}. ${s.text}`) : [`_${L.none}_`]), '');
  md.push(`## ${L.findings}`, '');
  if (pf.length) { md.push(`| ID | ${L.sev} | ${L.finding} | Category |`, '|---|---|---|---|', ...pf.map(f => `| ${f.id} | ${SEV[f.severity]} | ${esc(f.title)} | ${f.category} |`), '', ...pf.map(findingBlock).join('\n\n---\n\n').split('\n')); } else md.push(`_${L.none}_`);
  md.push('', `## ${L.works}`, '', ...(works.length ? works.map(w => `- ${w.text}`) : [`_${L.none}_`]));
  if (gaps.length) md.push('', `## ${L.notTested}`, '', ...gaps.map(g => `- ${g.text}`));
  if (au.length) {
    md.push('', `<details><summary>${L.audit}</summary>`, '');
    for (const a of au) { md.push(`**${a.name || 'audit'}** — \`${a.url}\` ${a.screenshot ? `([screenshot](${rel(a.screenshot)}))` : ''}`, ''); for (const i of a.issues || []) md.push(`- [${i.severity}] **${i.rule}** — ${i.message}${i.selector ? ` \`${i.selector.slice(0, 90)}\`` : ''}`); md.push(''); }
    md.push('</details>');
  }
  fs.writeFileSync(path.join(outDir, `${id}.md`), md.filter(x => x !== null).join('\n') + '\n---\n_Generated by [QA Scout](https://github.com/radyelkasas/qa-scout) — created by [Rady Elkasas](https://radyelkasas.com/)._\n');
}

// ---------- interconnections ----------
const inter = findings.filter(f => f.category === 'interconnection' || (f.related && f.related.length));
const flowMd = [`# ${L.flows}`, ''];
const nInter = narrative('interconnections.md'); if (nInter) flowMd.push(nInter, '');
if (cfg.workflows?.length || flows.length) {
  flowMd.push('| # | Workflow | ' + L.verdict + ' | Detail |', '|---|---|---|---|');
  const names = [...new Set([...(cfg.workflows || []), ...flows.map(f => f.name)])];
  names.forEach((n, i) => { const v = flows.filter(f => f.name === n).pop(); const icon = !v ? '⏳ not run' : { works: '✅ works', broken: '❌ broken', partial: '⚠️ partial', blocked: '⛔ blocked' }[v.verdict] || v.verdict; flowMd.push(`| F${i + 1} | ${esc(n)} | ${icon} | ${esc(v?.detail || '')} |`); });
  flowMd.push('');
}
flowMd.push(`## ${L.findings}`, '', ...(inter.length ? inter.map(findingBlock).join('\n\n---\n\n').split('\n') : [`_${L.none}_`]));
fs.writeFileSync(path.join(outDir, 'INTERCONNECTIONS.md'), flowMd.join('\n') + '\n');

// ---------- backend ----------
const be = findings.filter(f => ['backend', 'both', 'data'].includes(f.layer));
fs.writeFileSync(path.join(outDir, 'BACKEND.md'), [`# ${L.backend}`, '', ...(be.length ? [] : [`_${L.none}_`]), `| ID | ${L.sev} | ${L.finding} | ${L.where} |`, '|---|---|---|---|', ...be.map(f => `| ${f.id} | ${SEV[f.severity]} | ${esc(f.title)} | ${esc(f.where || '')} |`), ''].join('\n'));

// ---------- index ----------
const c = counts(findings);
const idx = [`# ${L.title} — ${cfg.project || ''}`, '', `**Target:** ${cfg.baseUrl || ''} · **Environment:** ${cfg.environment || ''} · **Run:** \`${path.basename(runDir)}\` · **Generated:** ${new Date().toLocaleString('sv-SE').slice(0, 16)}`, '', `**${L.findings}:** ${countStr(c)} (total ${findings.length})${retracted.length ? ` · ${retracted.length} retracted` : ''}`, ''];
const nSum = narrative('summary.md'); if (nSum) idx.push(nSum, '');
const topF = findings.filter(f => ['critical', 'high'].includes(f.severity)).slice(0, 20);
idx.push(`## ${L.top}`, '', ...(topF.length ? [`| ID | ${L.sev} | ${L.finding} | ${L.page} |`, '|---|---|---|---|', ...topF.map(f => `| ${f.id} | ${SEV[f.severity]} | ${esc(f.title)} | [${f.page}](${f.page}.md) |`)] : [`_${L.none} (critical/high)_`]), '');
idx.push(`## ${L.pages}`, '', `| ${L.page} | URL | ${L.findings} | ${L.video} |`, '|---|---|---|---|', ...pages.map(id => `| [${id}](${id}.md) | \`${pageMeta(id).url}\` | ${countStr(counts(findings.filter(f => f.page === id)))} | \`videos/${id}.webm\` |`), '', `- [${L.flows}](INTERCONNECTIONS.md)`, `- [${L.backend}](BACKEND.md)`, `- Dashboard: \`report.html\``, '');
if (retracted.length) idx.push(`## ${L.retracted}`, '', ...retracted.map(r => `- ~~${r.id} — ${r.title}~~ — ${r.reason || ''}`), '');
fs.writeFileSync(path.join(outDir, '00-INDEX.md'), idx.join('\n') + '\n---\n_Generated by [QA Scout](https://github.com/radyelkasas/qa-scout) — created by [Rady Elkasas](https://radyelkasas.com/)._\n');

// ---------- HTML dashboard ----------
const data = { cfg: { project: cfg.project, baseUrl: cfg.baseUrl, environment: cfg.environment, reportLanguage: cfg.reportLanguage }, findings, retracted, flows, workflows: cfg.workflows || [], pages: pages.map(id => ({ id, url: pageMeta(id).url, notes: pageMeta(id).notes })), steps, notes, audits: audits.map(a => ({ page: a.page, name: a.name, url: a.url, screenshot: a.screenshot, issues: a.issues })), summary: nSum };
const tpl = fs.readFileSync(path.join(__dirname, '..', 'assets', 'dashboard.html'), 'utf8');
fs.writeFileSync(path.join(runDir, 'report.html'), tpl.replace('/*__DATA__*/null', JSON.stringify(data).replace(/</g, '\\u003c')));
console.log(`REPORT_DONE ${outDir} (${findings.length} findings, ${pages.length} pages) + ${path.join(runDir, 'report.html')}`);
