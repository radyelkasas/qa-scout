#!/usr/bin/env node
// QA Scout — https://github.com/radyelkasas/qa-scout · by Rady Elkasas (https://radyelkasas.com/) · MIT License
// QA Scout driver — a long-lived, visible (or headless), recorded browser that executes test steps
// sent over HTTP, keeps per-page evidence, and logs findings with highlighted screenshots.
//
// Start:  node driver.js --run <runDir>            (reads <runDir>/config.json)
// Steps:  scripts/step.sh <runDir> <<'JS' … JS     (JS body runs with `H` in scope; `page` = H.page)
// Stop:   curl -s -X POST http://127.0.0.1:<port>/close
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));
const { findBrowser } = require('./find-browser');
const pageAudit = require('./page-audit');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const runDir = path.resolve(arg('run', '.'));
const cfg = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'));
const PORT = Number(arg('port', cfg.driverPort || 9333));
const base = cfg.baseUrl.replace(/\/+$/, '');
const [vw, vh] = String(cfg.viewport || '1440x860').split('x').map(Number);
const rateLimit = Number(cfg.rateLimit || 200);
const dirs = { shots: path.join(runDir, 'screenshots'), video: path.join(runDir, 'videos'), evidence: path.join(runDir, 'evidence'), auth: path.join(runDir, 'auth'), downloads: path.join(runDir, 'downloads') };
Object.values(dirs).forEach(d => fs.mkdirSync(d, { recursive: true }));
const jsonl = (file, obj) => fs.appendFileSync(path.join(runDir, file), JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n');

const CURSOR = () => {
  const install = () => {
    if (document.getElementById('__pw_cursor')) return;
    const c = document.createElement('div'); c.id = '__pw_cursor';
    Object.assign(c.style, { position: 'fixed', zIndex: 2147483647, pointerEvents: 'none', width: '22px', height: '22px', margin: '-11px 0 0 -11px', borderRadius: '50%', background: 'rgba(239,68,68,.35)', border: '2px solid #ef4444', left: '-50px', top: '-50px', transition: 'transform .12s ease, background .12s ease', boxShadow: '0 0 0 3px rgba(255,255,255,.7)' });
    document.documentElement.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'scale(.6)'; c.style.background = 'rgba(239,68,68,.85)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; c.style.background = 'rgba(239,68,68,.35)'; }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', install); else install();
};
const NOISE = /WebSocket|Push API|Failed to load resource|Download the React DevTools|Support for defaultProps will be removed|React Router Future Flag|findDOMNode is deprecated|componentWillReceiveProps has been renamed/;
const TOAST_SEL = '.Toastify__toast, .toast.show, .swal2-popup, [role=alert], .notistack-Snackbar, .ant-message-notice, .ant-notification-notice, .chakra-toast, [data-sonner-toast]';

(async () => {
  const exe = findBrowser();
  if (!exe) { console.error('NO_BROWSER'); process.exit(2); }
  const headed = String(cfg.headed) !== 'false';
  const browser = await chromium.launch({ executablePath: exe, headless: !headed, slowMo: Number(cfg.slowMo || 50), args: headed ? [`--window-size=${vw},${vh + 100}`, '--window-position=40,30'] : [] });
  let context, page, session = '00-start', pageId = null, shot = 0, account = null, findingSeq = {};
  let log = []; const reqTimes = []; const recent = [];
  const sessionEvidence = () => path.join(dirs.evidence, session);

  const open = async (name, accountLabel) => {
    session = name; account = accountLabel || account; recent.length = 0;
    fs.mkdirSync(sessionEvidence(), { recursive: true });
    const statePath = account ? path.join(dirs.auth, account + '.json') : null;
    context = await browser.newContext({
      viewport: { width: vw, height: vh }, acceptDownloads: true,
      storageState: statePath && fs.existsSync(statePath) ? statePath : undefined,
      recordVideo: String(cfg.video) !== 'false' ? { dir: dirs.video, size: { width: vw, height: vh } } : undefined,
    });
    if (cfg.localStorageInit) await context.addInitScript(o => { for (const [k, v] of Object.entries(o)) if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, cfg.localStorageInit);
    await context.addInitScript(CURSOR);
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (NOISE.test(t) || (cfg.ignoreConsole || []).some(p => new RegExp(p).test(t))) return; const e = { type: m.type(), text: t.slice(0, 400) }; if (m.type() === 'error' || /Maximum update depth|validateDOMNesting|Each child in a list|MISSING_TRANSLATION|unique "key"/.test(t)) log.push(`console.${m.type()}: ${t.slice(0, 220)}`); fs.appendFileSync(path.join(sessionEvidence(), 'console.jsonl'), JSON.stringify({ ts: Date.now(), ...e }) + '\n'); } });
    page.on('pageerror', e => { log.push('pageerror: ' + e.message.slice(0, 300)); fs.appendFileSync(path.join(sessionEvidence(), 'console.jsonl'), JSON.stringify({ ts: Date.now(), type: 'pageerror', text: e.message.slice(0, 600) }) + '\n'); });
    page.on('request', r => { if (['xhr', 'fetch'].includes(r.resourceType())) reqTimes.push(Date.now()); });
    page.on('response', async r => {
      const req = r.request(); if (!['xhr', 'fetch'].includes(req.resourceType())) return;
      const entry = { ts: Date.now(), method: req.method(), url: r.url().replace(/^https?:\/\/[^/]+/, ''), status: r.status() };
      if (r.status() >= 400 || !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
        try { const body = await r.text(); entry.body = body.slice(0, 600); } catch {}
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { try { entry.request = (req.postData() || '').slice(0, 600); } catch {} }
        log.push(`${r.status() >= 400 ? 'HTTP ' + r.status() + ' ' : ''}${req.method()} ${entry.url.slice(0, 150)}${r.status() >= 400 && entry.body ? ' → ' + entry.body.replace(/\s+/g, ' ').slice(0, 160) : ''}`);
      }
      recent.push(entry); if (recent.length > 60) recent.shift();
      fs.appendFileSync(path.join(sessionEvidence(), 'network.jsonl'), JSON.stringify(entry) + '\n');
    });
  };
  const close = async () => {
    const v = page && page.video(); await context.close().catch(() => {});
    if (v) { try { const p = await v.path(); const dest = path.join(dirs.video, `${session}.webm`); fs.renameSync(p, dest); return dest; } catch {} }
  };
  await open('00-start');

  const H = {
    cfg, runDir, base,
    get page() { return page; }, get session() { return session; }, get pageId() { return pageId; }, get account() { return account; },

    // ---------- pacing & navigation ----------
    rate() { const now = Date.now(); while (reqTimes.length && now - reqTimes[0] > 60000) reqTimes.shift(); return reqTimes.length; },
    async pace(limit = Math.floor(rateLimit * 0.8)) { while (H.rate() > limit) await page.waitForTimeout(2000); },
    url(p) { return /^https?:/.test(p) ? p : base + (p.startsWith('/') ? p : '/' + p); },
    async go(p, opts = {}) { await H.pace(); await page.goto(H.url(p), { waitUntil: opts.waitUntil || 'networkidle', timeout: opts.timeout || 60000 }).catch(e => { if (!/Timeout/.test(e.message)) throw e; }); await page.waitForTimeout(opts.settle ?? 700); return page.url(); },
    async waitIdle(ms = 800) { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(ms); },

    // ---------- sessions, pages, accounts ----------
    /** New recorded session (one video). Keeps the current account's login. */
    async session(name, accountLabel) { const v = await close(); await open(name, accountLabel); return v; },
    /** Start testing a configured page: new session/video named after it. */
    async startPage(idOrUrl, accountLabel) {
      const p = (cfg.pages || []).find(x => x.id === idOrUrl || x.url === idOrUrl) || { id: idOrUrl, url: idOrUrl };
      pageId = p.id; findingSeq[pageId] = findingSeq[pageId] || 0;
      await H.session(p.id, accountLabel);
      jsonl('steps.jsonl', { page: pageId, session, kind: 'start', text: `Opened ${p.url}${account ? ' as ' + account : ''}` });
      await H.go(p.url);
      return { page: p, url: page.url() };
    },
    setPage(id) { pageId = id; findingSeq[id] = findingSeq[id] || 0; },
    /** Log in through the UI (visible typing) and remember the session for this account. */
    async login(label) {
      const acc = (cfg.accounts || []).find(a => a.label === label) || (cfg.accounts || [])[0];
      if (!acc) throw new Error('No account configured');
      if (account !== acc.label) await H.session(`login-${acc.label}`, null);
      await page.context().clearCookies();
      await H.go(acc.loginPath || cfg.loginPath || '/login');
      await page.evaluate(keep => { const saved = {}; for (const k of keep) saved[k] = localStorage.getItem(k); localStorage.clear(); sessionStorage.clear(); for (const [k, v] of Object.entries(saved)) if (v != null) localStorage.setItem(k, v); }, Object.keys(cfg.localStorageInit || {}));
      await H.go(acc.loginPath || cfg.loginPath || '/login');
      const id = page.locator('input[type=email], input[name*=email i], input[name*=identifier i], input[name*=user i], input[name*=phone i], input[autocomplete=username]').or(page.locator('input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio])')).first();
      await H.type(id, acc.identifier);
      await H.type(page.locator('input[type=password]').first(), acc.password);
      const before = page.url();
      await H.click(page.locator('button[type=submit], input[type=submit]').or(page.getByRole('button', { name: /log ?in|sign ?in|دخول|تسجيل الدخول/i })).first());
      await page.waitForURL(u => u.toString() !== before && !/login|auth/i.test(u.toString()), { timeout: 30000 }).catch(() => {});
      await H.waitIdle(1200);
      const ok = !/login|auth/i.test(page.url());
      if (ok) { await page.context().storageState({ path: path.join(dirs.auth, acc.label + '.json') }); account = acc.label; }
      jsonl('steps.jsonl', { page: pageId, session, kind: 'login', text: `Login as ${acc.label} (${acc.role}) → ${ok ? 'OK' : 'FAILED'} (${page.url()})` });
      return { ok, url: page.url(), account: acc.label };
    },

    // ---------- interaction helpers (visible cursor) ----------
    loc(t) { return typeof t === 'string' ? page.locator(t).first() : t; },
    async glide(target, opts = {}) {
      const loc = H.loc(target);
      await loc.scrollIntoViewIfNeeded({ timeout: opts.timeout ?? 10000 });
      const b = await loc.boundingBox(); if (!b) throw new Error('Target has no box (hidden?)');
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: opts.steps ?? 18 });
      await page.waitForTimeout(opts.pause ?? 180); return loc;
    },
    async click(target, opts = {}) { const loc = await H.glide(target, opts); await loc.click({ timeout: opts.timeout ?? 10000, force: !!opts.force }); await page.waitForTimeout(opts.after ?? 350); return loc; },
    /** Clears properly (also number inputs, which `fill('')` may not clear) then types visibly. */
    async type(target, text, opts = {}) {
      const loc = await H.click(target);
      await loc.fill('').catch(() => {});
      if ((await loc.inputValue().catch(() => '')) !== '') { await loc.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A'); await loc.press('Backspace'); }
      if (opts.fast) await loc.fill(String(text)); else await loc.pressSequentially(String(text), { delay: opts.delay ?? 22 });
      return loc;
    },
    /** Sets a value directly (dates, number fields, very long text). */
    async setValue(target, value) { const loc = await H.glide(target); await loc.fill(String(value)); return loc; },
    /** Checks a (possibly visually hidden) radio/checkbox. */
    async check(target) { const loc = H.loc(target); const b = await loc.evaluate(e => { const t = e.closest('label') || e.parentElement; const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }).catch(() => null); if (b) await page.mouse.move(b.x, b.y, { steps: 14 }); await loc.check({ force: true }); return loc; },
    /** Native <select>. */
    async select(target, labelOrValue) { const loc = await H.glide(target); try { await loc.selectOption({ label: labelOrValue }); } catch { await loc.selectOption(labelOrValue); } return loc; },
    /** React-select / combobox: opens, optionally types, picks by text/regex/index, returns all option texts. */
    async pick(control, { text, match, index } = {}) {
      const c = H.loc(control); await H.click(c);
      if (text) await page.keyboard.type(text, { delay: 35 });
      await page.waitForTimeout(900);
      const optsLoc = page.locator('.react-select__option, [role=option]');
      const options = await optsLoc.allInnerTexts();
      let i = index ?? 0;
      if (match) { const re = match instanceof RegExp ? match : new RegExp(match); i = options.findIndex(o => re.test(o)); }
      if (i >= 0 && i < options.length) await H.click(optsLoc.nth(i)); else await page.keyboard.press('Escape');
      return { options, picked: options[i] ?? null };
    },
    /** Collects toasts/alerts that appear within `ms` (don't conclude "no toast" before waiting). */
    async toasts(ms = 2500) {
      const seen = new Set(); const end = Date.now() + ms;
      while (Date.now() < end) { for (const t of await page.locator(TOAST_SEL).allInnerTexts().catch(() => [])) if (t.trim()) seen.add(t.trim().replace(/\s+/g, ' ').slice(0, 200)); await page.waitForTimeout(250); }
      return [...seen];
    },
    async closeToasts() { await page.locator('.Toastify__close-button, .toast .btn-close, .swal2-close').evaluateAll(b => b.forEach(x => x.click())).catch(() => {}); },
    async modals() { return page.locator('.modal.show, [role=dialog][aria-modal=true], dialog[open], .swal2-popup').evaluateAll(ms => ms.filter(m => m.offsetParent || getComputedStyle(m).display !== 'none').map(m => m.innerText.trim().replace(/\s+/g, ' ').slice(0, 400))); },
    topModal() { return page.locator('.modal.show, [role=dialog][aria-modal=true], dialog[open], .swal2-popup').last(); },
    async closeModals() { for (let i = 0; i < 8 && (await H.modals()).length; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); } },
    /** Captures a download triggered by `trigger` (locator or function). */
    async download(trigger, name) { const dl = page.waitForEvent('download', { timeout: 20000 }); if (typeof trigger === 'function') await trigger(); else await H.click(trigger); const d = await dl; const p = path.join(dirs.downloads, name || d.suggestedFilename()); await d.saveAs(p); return { file: p, suggested: d.suggestedFilename() }; },
    /** Captures the JSON/body of the next request matching `re` while `action` runs. */
    async captureRequest(re, action) { let hit = null; const h = r => { if (re.test(r.url()) && !hit) hit = { method: r.method(), url: r.url(), body: r.postData() }; }; page.on('request', h); await action(); await H.waitIdle(600); page.off('request', h); return hit; },
    async setViewport(w, h) { await page.setViewportSize({ width: w, height: h }); },
    async colorScheme(s) { await page.emulateMedia({ colorScheme: s }); },
    async setLocalStorage(obj, reload = true) { await page.evaluate(o => { for (const [k, v] of Object.entries(o)) localStorage.setItem(k, v); }, obj); if (reload) { await page.reload({ waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(800); } },
    /** Visible-text inventory of the page: headings, buttons, inputs, tables, links. */
    async inventory(rootSel = cfg.contentSelector || 'main, [role=main], #main, #content, #app, #root, body') {
      return page.evaluate(rs => {
        const root = document.querySelector(rs.split(',').map(s => s.trim()).find(s => document.querySelector(s))) || document.body;
        const v = e => e.offsetParent || getComputedStyle(e).position === 'fixed';
        const T = e => (e.innerText || e.value || e.getAttribute('aria-label') || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const uniq = a => [...new Set(a.filter(Boolean))];
        return {
          title: document.title, url: location.href,
          headings: uniq([...root.querySelectorAll('h1,h2,h3')].filter(v).map(T)).slice(0, 20),
          buttons: uniq([...root.querySelectorAll('button, a.btn, [role=button]')].filter(v).map(e => T(e) || '[icon:' + (e.className.baseVal ?? e.className).toString().slice(0, 30) + ']')).slice(0, 60),
          tabs: uniq([...root.querySelectorAll('[role=tab], .nav-link')].filter(v).map(T)),
          inputs: [...root.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(v).map(e => ({ name: e.name || e.id || '', type: e.type, label: (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || e.placeholder || '').trim().slice(0, 40), required: e.required })).slice(0, 60),
          tables: [...root.querySelectorAll('table')].filter(v).map(t => ({ headers: [...t.querySelectorAll('thead th')].map(T), rows: t.querySelectorAll('tbody tr').length })),
          links: uniq([...root.querySelectorAll('a[href]')].filter(v).map(a => T(a) + ' → ' + a.getAttribute('href'))).slice(0, 40),
        };
      }, rootSel);
    },

    /**
     * Discovers in-app pages from the current (logged-in) screen: expands collapsed menus, collects
     * same-origin links from navigation areas first, then the rest. Returns [{ path, text, area }].
     */
    async discover({ max = Number(cfg.maxPages || 25), expand = true, sweep = true } = {}) {
      const startUrl = page.url();
      const collect = () => page.evaluate(() => {
        const out = [];
        const areaOf = a => a.closest('nav, aside, [role=navigation], header, [class*=sidebar], [class*=menu], [class*=rail]') ? 'navigation' : 'content';
        for (const a of document.querySelectorAll('a[href]')) {
          const raw = (a.getAttribute('href') || '').trim();
          if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw)) continue; // '#' links resolve to the current page
          let u; try { u = new URL(raw, location.href); } catch { continue; }
          if (u.origin !== location.origin) continue;
          const p = u.pathname + (u.search || '');
          if (/logout|sign-?out|\.(pdf|zip|png|jpe?g|csv|xlsx)$/i.test(p)) continue;
          out.push({ path: p, text: (a.innerText || a.getAttribute('aria-label') || a.title || '').trim().replace(/\s+/g, ' ').slice(0, 60), area: areaOf(a) });
        }
        return out;
      });
      const all = new Map(); const addAll = list => { for (const l of list) { const prev = all.get(l.path); if (!prev || (prev.area !== 'navigation' && l.area === 'navigation')) all.set(l.path, l); } };
      if (expand) {
        const toggles = page.locator('nav [aria-expanded=false], aside [aria-expanded=false], [role=navigation] [aria-expanded=false], [class*=sidebar] [aria-expanded=false], [class*=menu] [aria-expanded=false]');
        const n = Math.min(await toggles.count().catch(() => 0), 30);
        for (let i = 0; i < n; i++) { const t = toggles.nth(i); if (await t.isVisible().catch(() => false)) { await t.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(150); } }
      }
      addAll(await collect());
      if (sweep) {
        // Menus built from buttons (icon rails, panels): click each nav button, harvest links and the page it opens.
        const btnSel = 'nav button, aside button, [role=navigation] button, [class*=sidebar] button, [class*=rail] button, nav [role=button], aside [role=button]';
        const RISKY = /log ?out|sign ?out|خروج|delete|remove|حذف|theme|dark|light|مظهر|داكن|فاتح|language|lang|اللغة|notif|إشعار|send|إرسال|ارسال|close|إغلاق|collapse|toggle sidebar/i;
        const labels = await page.locator(btnSel).evaluateAll((bs, risky) => bs.map((b, i) => ({ b, i })).filter(({ b }) => b.offsetParent && !b.closest('header, [role=banner], .modal, [role=dialog], [role=menu]') && !new RegExp(risky, 'i').test((b.innerText || '') + ' ' + (b.title || '') + ' ' + (b.getAttribute('aria-label') || ''))).map(({ i }) => i), RISKY.source).catch(() => []);
        for (const i of labels.slice(0, 30)) {
          const b = page.locator(btnSel).nth(i);
          if (!(await b.isVisible().catch(() => false))) continue;
          const before = page.url();
          await b.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(400);
          addAll(await collect());
          if (page.url() !== before) { const u = new URL(page.url()); const heading = await page.locator('h1').first().innerText().catch(() => ''); addAll([{ path: u.pathname + u.search, text: (heading || (await b.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 60), area: 'navigation' }]); }
        }
        if (page.url() !== startUrl) { await page.goto(startUrl, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(500); }
      }
      const links = [...all.values()].sort((a, b) => (a.area === 'navigation' ? 0 : 1) - (b.area === 'navigation' ? 0 : 1));
      const result = links.slice(0, max);
      jsonl('steps.jsonl', { page: pageId, session, kind: 'discover', text: `Discovered ${links.length} in-app pages (kept ${result.length})` });
      fs.writeFileSync(path.join(runDir, 'discovered-pages.json'), JSON.stringify(links, null, 2));
      return result;
    },
    /** Adds discovered/extra pages to the run's config (so reports include them). */
    addPages(list) {
      cfg.pages = cfg.pages || []; const have = new Set(cfg.pages.map(p => p.url));
      for (const item of list) { const url = item.path || item.url || item; if (have.has(url)) continue; have.add(url); const id = String(cfg.pages.length + 1).padStart(2, '0') + '-' + (String(url).replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40) || 'home'); cfg.pages.push({ id, url, priority: 'normal', notes: item.text ? `menu: ${item.text}` : '' }); }
      fs.writeFileSync(path.join(runDir, 'config.json'), JSON.stringify(cfg, null, 2));
      return cfg.pages.map(p => p.id + ' ' + p.url);
    },

    // ---------- evidence ----------
    async snap(name, opts = {}) { const dir = path.join(dirs.shots, pageId || session); fs.mkdirSync(dir, { recursive: true }); const p = path.join(dir, `${String(++shot).padStart(3, '0')}-${String(name).replace(/[^\w؀-ۿ-]+/g, '_').slice(0, 50)}.png`); if (opts.element) await H.loc(opts.element).screenshot({ path: p }); else await page.screenshot({ path: p, fullPage: !!opts.full }); return path.relative(runDir, p); },
    /** Draws a red frame (overlay, immune to app CSS) around one or more targets. */
    async highlight(target, label = '') {
      const locs = Array.isArray(target) ? target : [target]; let drawn = 0;
      for (const t of locs) {
        const loc = H.loc(t);
        if (!(await loc.count().catch(() => 0))) continue;
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        drawn += await loc.evaluate((e, lbl) => {
          const r = e.getBoundingClientRect(); const o = document.createElement('div'); o.className = '__qa_hl';
          Object.assign(o.style, { position: 'fixed', left: (r.left - 4) + 'px', top: (r.top - 4) + 'px', width: (r.width + 8) + 'px', height: (r.height + 8) + 'px', border: '3px solid #ef4444', borderRadius: '6px', zIndex: 2147483646, pointerEvents: 'none', boxShadow: '0 0 0 2px rgba(255,255,255,.85)' });
          if (lbl) { const tag = document.createElement('span'); tag.textContent = lbl; Object.assign(tag.style, { position: 'absolute', top: '-21px', insetInlineStart: '-3px', background: '#ef4444', color: '#fff', font: '600 11px/16px system-ui', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }); o.appendChild(tag); }
          document.documentElement.appendChild(o); return 1;
        }, label).catch(() => 0);
      }
      return drawn;
    },
    async clearHighlights() { await page.evaluate(() => document.querySelectorAll('.__qa_hl').forEach(e => e.remove())).catch(() => {}); },
    /** Runs the automated page audit. Saves candidates to audit.jsonl; returns a compact summary. */
    async audit(opts = {}) {
      const res = await page.evaluate(`(${pageAudit.toString()})(${JSON.stringify({ highlight: !!opts.highlight, root: opts.root || cfg.contentSelector, limit: opts.limit, allowWords: cfg.allowLatinWords || [] })})`);
      let shotPath = null; if (opts.highlight && res.issues.length) { shotPath = await H.snap('audit-' + (opts.name || 'page'), { full: !!opts.full }); await H.clearHighlights(); }
      jsonl('audit.jsonl', { page: pageId, session, name: opts.name || null, screenshot: shotPath, ...res });
      return { summary: res.summary, rtl: res.rtl, screenshot: shotPath, issues: res.issues.map(i => `[${i.severity}] ${i.rule}: ${i.message}${i.selector ? '  ⟨' + i.selector.slice(0, 80) + '⟩' : ''}`) };
    },
    /**
     * Records a CONFIRMED finding with evidence. Required: title, severity (critical|high|medium|low).
     * Optional: category, layer (frontend|backend|data|both), steps[], expected, actual, where, highlight (selector/locator),
     * verifiedBy (ui|api|db|code), status (confirmed|suspected), related[] (other page ids), id.
     */
    async finding(f) {
      if (!f || !f.title || !f.severity) throw new Error('finding needs title + severity');
      const pid = f.page || pageId || session; findingSeq[pid] = (findingSeq[pid] || 0) + 1;
      const pre = /^\d+/.test(pid) ? 'P' + pid.match(/^\d+/)[0] : pid.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'F';
      const id = f.id || `${pre}-${String(findingSeq[pid]).padStart(2, '0')}`;
      const drawn = f.highlight ? await H.highlight(f.highlight, id) : null;
      const screenshot = f.noShot ? null : await H.snap('finding-' + id, { full: !!f.fullShot });
      if (f.highlight) await H.clearHighlights();
      const net = recent.filter(e => e.status >= 400 || !['GET', 'HEAD', 'OPTIONS'].includes(e.method)).slice(-6);
      const rec = { id, page: pid, session, url: page.url(), status: 'confirmed', category: 'functional', layer: 'frontend', verifiedBy: 'ui', ...f, highlight: undefined, screenshot, video: `videos/${session}.webm`, network: f.network ?? net };
      jsonl('findings.jsonl', rec);
      return { id, screenshot, ...(f.highlight && !drawn ? { warning: 'highlight target not found — screenshot has no frame; fix the locator and re-log or retract' } : {}) };
    },
    /** Withdraws an earlier finding that turned out to be wrong (kept in an appendix, out of the counts). */
    retract(id, reason) { jsonl('findings.jsonl', { id, retracted: true, reason }); return { id, retracted: true }; },
    /** Logs a test step (shows in "Steps performed"). */
    step(text, extra = {}) { jsonl('steps.jsonl', { page: pageId, session, kind: 'step', text, ...extra }); return text; },
    /** Logs something that works (shows in "What works"). */
    pass(text) { jsonl('notes.jsonl', { page: pageId, session, type: 'pass', text }); return text; },
    /** Logs coverage gaps (shows in "Not tested"). */
    notTested(text) { jsonl('notes.jsonl', { page: pageId, session, type: 'not-tested', text }); return text; },
    /** Records a workflow verdict for the interconnections report. verdict: works|broken|partial|blocked. */
    flow(name, verdict, detail, related = []) { jsonl('flows.jsonl', { name, verdict, detail, related, page: pageId }); return { name, verdict }; },
    drain() { const l = log; log = []; const c = {}; l.forEach(x => { const k = x.slice(0, 160); c[k] = (c[k] || 0) + 1; }); return Object.entries(c).map(([k, v]) => v > 1 ? `${k} (x${v})` : k).slice(0, 25); },
  };

  fs.writeFileSync(path.join(runDir, 'driver.json'), JSON.stringify({ port: PORT, pid: process.pid, browser: exe, startedAt: new Date().toISOString() }, null, 2));
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => body += d);
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/close') { const v = await close(); await browser.close(); res.end(JSON.stringify({ video: v })); server.close(); setTimeout(() => process.exit(0), 200); return; }
      if (req.url === '/status') { res.end(JSON.stringify({ session, pageId, account, url: page.url(), rate: H.rate() })); return; }
      try {
        const fn = new Function('H', 'page', `return (async () => { ${body} })();`);
        // `page` always resolves to the CURRENT tab, even after H.startPage()/H.session() replace it mid-step.
        const livePage = new Proxy({}, { get: (_, k) => { const v = H.page[k]; return typeof v === 'function' ? v.bind(H.page) : v; } });
        const result = await fn(H, livePage);
        res.end(JSON.stringify({ ok: true, url: page.url(), session, rate: H.rate(), result, log: H.drain() }, null, 1));
      } catch (e) { res.end(JSON.stringify({ ok: false, url: page?.url(), session, rate: H.rate(), error: String(e.message || e).slice(0, 900), log: H.drain() }, null, 1)); }
    });
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`DRIVER_READY http://127.0.0.1:${PORT} run=${runDir}`));
})().catch(e => { console.error('DRIVER_FAILED', e); process.exit(1); });
