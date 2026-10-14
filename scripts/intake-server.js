#!/usr/bin/env node
// QA Scout — https://github.com/radyelkasas/qa-scout · by Rady Elkasas (https://radyelkasas.com/) · MIT License
// Serves the QA setup form, writes <runDir>/config.json on submit, prints CONFIG_SAVED and exits.
// Usage: node intake-server.js --run <runDir> [--port 4777] [--no-open]
const http = require('http'); const fs = require('fs'); const path = require('path'); const { exec } = require('child_process');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const runDir = path.resolve(arg('run', path.join(process.cwd(), 'qa-runs', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))));
let port = Number(arg('port', 4777));
const skillDir = path.resolve(__dirname, '..');
const lastFile = path.join(skillDir, '.last-config.json');
fs.mkdirSync(runDir, { recursive: true });

const html = fs.readFileSync(path.join(skillDir, 'assets', 'intake.html'), 'utf8');
const defaults = () => { try { return JSON.parse(fs.readFileSync(lastFile, 'utf8')); } catch { return {}; } };

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
  if (req.method === 'GET' && req.url === '/defaults') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(defaults())); }
  if (req.method === 'POST' && (req.url === '/check' || req.url === '/discover')) {
    let body = ''; req.on('data', d => body += d);
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      try {
        const { url } = JSON.parse(body || '{}'); const base = String(url || '').replace(/\/+$/, '');
        if (req.url === '/check') res.end(JSON.stringify(await check(base)));
        else res.end(JSON.stringify(await discover(base)));
      } catch (e) { res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/submit') {
    let body = ''; req.on('data', d => { body += d; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body);
        cfg.baseUrl = String(cfg.baseUrl || '').replace(/\/+$/, '');
        cfg.apiBase = String(cfg.apiBase || '').replace(/\/+$/, '');
        cfg.runDir = cfg.outDirOverride ? path.resolve(cfg.outDirOverride) : runDir;
        cfg.createdAt = new Date().toISOString();
        cfg.pages = (cfg.pages || []).map((p, i) => ({ id: String(i + 1).padStart(2, '0') + '-' + slug(p.url), ...p }));
        cfg.languages = String(cfg.languages || 'en').split(/[\s,]+/).filter(Boolean).join(',');
        if (!cfg.baseUrl) throw new Error('baseUrl is required');
        cfg.tool = { name: 'QA Scout', author: 'Rady Elkasas', url: 'https://radyelkasas.com/' };
        fs.mkdirSync(cfg.runDir, { recursive: true });
        const file = path.join(cfg.runDir, 'config.json');
        fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
        if (cfg.runDir !== runDir) fs.writeFileSync(path.join(runDir, 'config.json'), JSON.stringify(cfg, null, 2));
        const remembered = { ...cfg }; delete remembered.runDir; delete remembered.createdAt; delete remembered.outDirOverride;
        if (!cfg.rememberPasswords) remembered.accounts = (cfg.accounts || []).map(a => ({ ...a, password: '' }));
        remembered.pages = (cfg.pages || []).map(({ id, ...p }) => p);
        fs.writeFileSync(lastFile, JSON.stringify(remembered, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, path: file }));
        console.log('CONFIG_SAVED ' + file);
        setTimeout(() => process.exit(0), 800);
      } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message) })); }
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});
async function get(url, ms = 6000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'QA-Scout/1.0' } }); const text = await r.text(); return { status: r.status, ok: r.ok, text, url: r.url }; }
  finally { clearTimeout(t); }
}
async function check(base) {
  try {
    const r = await get(base);
    const title = (r.text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
    const spa = /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(r.text) && (r.text.match(/<a\s/gi) || []).length < 5;
    return { ok: r.status < 500, status: r.status, title: title.trim().slice(0, 80), spa };
  } catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'timed out' : String(e.message || e) }; }
}
async function discover(base) {
  const origin = new URL(base).origin; const out = new Set();
  const add = u => { try { const x = new URL(u, base); if (x.origin === origin && !/\.(png|jpe?g|svg|css|js|ico|pdf|zip|xml)$/i.test(x.pathname)) out.add(x.pathname + x.search); } catch {} };
  for (const sm of [origin + '/sitemap.xml', origin + '/sitemap_index.xml']) {
    try { const r = await get(sm); if (r.ok && /<loc>/i.test(r.text)) { for (const m of r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) add(m[1]); if (out.size) return { source: 'sitemap.xml', paths: [...out].slice(0, 200) }; } } catch {}
  }
  try { const r = await get(base); for (const m of r.text.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) add(m[1]); } catch {}
  return { source: out.size ? 'links on the home page' : 'home page', paths: [...out].slice(0, 200) };
}
function slug(u) { return String(u || 'page').replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40) || 'home'; }
function listen() {
  server.once('error', e => { if (e.code === 'EADDRINUSE' && port < 4800) { port++; listen(); } else throw e; });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log('INTAKE_URL ' + url); console.log('RUN_DIR ' + runDir);
    if (!args.includes('--no-open')) exec((process.platform === 'darwin' ? 'open ' : process.platform === 'win32' ? 'start ' : 'xdg-open ') + url);
  });
}
listen();
