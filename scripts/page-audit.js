// QA Scout — https://github.com/radyelkasas/qa-scout · by Rady Elkasas (https://radyelkasas.com/) · MIT License
// In-page heuristic audit. Serialized and run inside the page by driver.js → H.audit().
// Returns candidate issues; the tester confirms the real ones with H.finding().
module.exports = function pageAudit(opts) {
  opts = opts || {};
  const out = [];
  const LIMIT = opts.limit || 12;
  const counts = {};
  const root = (opts.root && document.querySelector(opts.root)) || document.body;
  const rtl = getComputedStyle(document.body).direction === 'rtl' || document.documentElement.dir === 'rtl' || document.body.dir === 'rtl';
  const vis = e => { if (!e || !e.getBoundingClientRect) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
  const sel = e => {
    if (!e || !e.tagName) return null;
    if (e.id && !/^\d/.test(e.id)) return '#' + CSS.escape(e.id);
    const parts = []; let n = e;
    for (let i = 0; n && n.nodeType === 1 && i < 4; i++, n = n.parentElement) {
      let p = n.tagName.toLowerCase();
      if (n.id && !/^\d/.test(n.id)) { parts.unshift('#' + CSS.escape(n.id)); break; }
      const cls = [...n.classList].filter(c => !/^(css-|sc-|jsx-)/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.map(c => CSS.escape(c)).join('.');
      const sib = n.parentElement ? [...n.parentElement.children].filter(x => x.tagName === n.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const txt = e => (e.innerText || e.value || e.getAttribute?.('aria-label') || e.getAttribute?.('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 90);
  const add = (rule, severity, message, el, extra) => {
    counts[rule] = (counts[rule] || 0) + 1;
    if (counts[rule] > LIMIT) return;
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    out.push(Object.assign({ rule, severity, message, selector: sel(el), text: el ? txt(el) : '', box: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null }, extra || {}));
    if (opts.highlight && r && r.width) {
      const o = document.createElement('div'); o.className = '__qa_hl';
      Object.assign(o.style, { position: 'fixed', left: (r.left - 3) + 'px', top: (r.top - 3) + 'px', width: (r.width + 6) + 'px', height: (r.height + 6) + 'px', border: '3px solid #ef4444', borderRadius: '6px', zIndex: 2147483646, pointerEvents: 'none', boxShadow: '0 0 0 2px rgba(255,255,255,.8)' });
      const tag = document.createElement('span'); tag.textContent = rule;
      Object.assign(tag.style, { position: 'absolute', top: '-20px', insetInlineStart: '-3px', background: '#ef4444', color: '#fff', font: '600 11px/16px system-ui', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap' });
      o.appendChild(tag); document.documentElement.appendChild(o);
    }
  };
  const all = [...root.querySelectorAll('*')].filter(e => !e.closest('#__pw_cursor'));
  const interactiveSel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [tabindex]:not([tabindex="-1"])';

  // 1. Page-level horizontal scroll
  if (document.documentElement.scrollWidth > innerWidth + 2) add('page-hscroll', 'medium', `Page scrolls horizontally (${document.documentElement.scrollWidth}px > ${innerWidth}px viewport).`, document.body);

  // 2. Clipped / horizontally scrolling containers (hidden columns, actions)
  for (const e of all) {
    if (!vis(e)) continue;
    const s = getComputedStyle(e);
    if (!/(auto|scroll|hidden)/.test(s.overflowX)) continue;
    if (e.clientWidth < 120 || e.scrollWidth <= e.clientWidth + 8) continue;
    if (s.textOverflow === 'ellipsis' || e.children.length === 0) {
      if (s.whiteSpace.includes('nowrap') && e.innerText && e.innerText.trim().length > 3) add('truncated-text', 'low', `Text is cut off ("${txt(e)}").`, e);
      continue;
    }
    const hiddenPx = e.scrollWidth - e.clientWidth;
    add('clipped-content', hiddenPx > 120 ? 'high' : 'medium', `Content is ${e.scrollWidth}px wide in a ${e.clientWidth}px box — ${hiddenPx}px (columns/actions) hidden until scrolled sideways${s.overflowX === 'hidden' ? ' and NOT scrollable' : ''}.`, e, { hiddenPx });
  }

  // 3. Form controls without an accessible name
  for (const e of root.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')) {
    if (!vis(e) && !(e.type === 'radio' || e.type === 'checkbox')) continue;
    if (e.closest('[class*="react-select__input"]')) continue;
    const named = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.labels && e.labels.length) || e.title || e.closest('label');
    if (!named) add(e.placeholder ? 'placeholder-as-label' : 'unlabeled-input', e.placeholder ? 'low' : 'medium', e.placeholder ? `Field identified only by its placeholder "${e.placeholder}" (no label / aria-label).` : 'Form field has no label or aria-label.', e);
    if (e.type === 'number' && e.min === '' && e.max === '' && vis(e)) add('number-no-bounds', 'low', 'Number field has no min/max — any value can be typed.', e);
  }

  // 4. Buttons / links with no accessible name (icon-only)
  for (const e of root.querySelectorAll('button, a[href], [role=button]')) {
    if (!vis(e)) continue;
    if (!(e.innerText || '').trim() && !e.getAttribute('aria-label') && !e.getAttribute('title') && !e.getAttribute('aria-labelledby') && !e.querySelector('img[alt]:not([alt=""])'))
      add('unnamed-control', 'low', 'Icon-only control has no aria-label/title — screen readers announce nothing.', e);
  }

  // 5. Mouse-only controls (pointer cursor, not focusable)
  for (const e of all) {
    if (!vis(e)) continue;
    const tag = e.tagName.toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'option'].includes(tag)) continue;
    if (e.closest('a, button, label, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], .react-select__control, .react-select__option')) continue;
    if (getComputedStyle(e).cursor !== 'pointer') continue;
    if (e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer' && !['svg', 'i'].includes(tag)) continue;
    if (e.tabIndex >= 0 || e.getAttribute('role')) continue;
    const r = e.getBoundingClientRect(); if (r.width > 400 || r.height > 200) continue;
    add('mouse-only-control', 'medium', `Clickable <${tag}> is not a button/link and not keyboard-focusable.`, e);
  }

  // 6. Nested interactive elements
  for (const e of root.querySelectorAll('button button, a a, button a[href], a[href] button')) if (vis(e)) add('nested-interactive', 'medium', `Interactive element nested inside another (${e.parentElement.closest('a,button').tagName.toLowerCase()} > ${e.tagName.toLowerCase()}) — invalid HTML, breaks keyboard/screen readers.`, e);

  // 7. Duplicate ids
  const ids = {}; for (const e of document.querySelectorAll('[id]')) ids[e.id] = (ids[e.id] || 0) + 1;
  const dups = Object.entries(ids).filter(([k, v]) => v > 1 && k && !k.startsWith('react-select'));
  if (dups.length) add('duplicate-id', 'low', `Duplicate ids: ${dups.slice(0, 8).map(([k, v]) => `${k}×${v}`).join(', ')}.`, null);

  // 8. Stacked dialogs
  const dialogs = [...document.querySelectorAll('.modal.show, [role=dialog][aria-modal=true], dialog[open], .swal2-popup')].filter(vis);
  if (dialogs.length > 1) add('stacked-dialogs', 'high', `${dialogs.length} dialogs are open at the same time.`, dialogs[dialogs.length - 1], { texts: dialogs.map(d => txt(d).slice(0, 40)) });

  // 9 + 10 + 11. Text checks: raw i18n keys, untranslated chrome, Arabic spelling
  const keyRe = /\b[A-Z][A-Z0-9]+(?:[._][A-Z0-9]+){2,}\b/;
  const arabic = /[\u0600-\u06FF]/;
  const latinWord = /^[A-Za-z][A-Za-z .…!?'’:/()-]{2,}$/;
  const extra = (opts.allowWords || []).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const allowWordsRe = new RegExp('^(' + ['Excel|JSON|HTML5?|YouTube|WhatsApp|Telegram|Google|Zoom|N/A|OK|E-?mail|Web|iOS|Android', extra].filter(Boolean).join('|') + ')$', 'i');
  const allowLatin = { test: t => /^[A-Z0-9]{2,6}$/.test(t) || allowWordsRe.test(t) }; // acronyms (EGP, PDF, CSV…) must be uppercase
  const typos = [['اضافة', 'إضافة'], ['اضف', 'أضف'], ['اعادة', 'إعادة'], ['تعين', 'تعيين'], ['ادارة', 'إدارة'], ['الافكار', 'الأفكار'], ['السوال', 'السؤال'], ['مستوي', 'مستوى'], ['الشكاوي', 'الشكاوى'], ['المحاضره', 'المحاضرة'], ['الدرجه', 'الدرجة'], ['النسبه', 'النسبة'], ['متاكد', 'متأكد'], ['انت', 'أنت'], ['الغاء', 'إلغاء'], ['ارسال', 'إرسال'], ['الاسئلة', 'الأسئلة'], ['اسئلة', 'أسئلة'], ['المخصصه', 'المخصصة'], ['اخفاء', 'إخفاء'], ['اظهار', 'إظهار'], ['الى', 'إلى'], ['اذا', 'إذا'], ['اختار', 'اختر (أمر)'], ['اخرى', 'أخرى'], ['الاعدادات', 'الإعدادات'], ['الاجراءات', 'الإجراءات'], ['انشاء', 'إنشاء'], ['اسم المستخدم', null]];
  const bd = '(^|[\\s،.:؛!؟()«»"\'\\-/])';
  const typoRes = typos.filter(t => t[1]).map(([w, f]) => [new RegExp(bd + w + '(?=$|[\\s،.:؛!؟()«»"\'\\-/])'), w, f]);
  const seenTypos = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = node.textContent.trim(); if (!t) continue;
    const el = node.parentElement; if (!el || !vis(el) || el.closest('script,style,code,pre,textarea,[contenteditable=true],#__pw_cursor')) continue;
    const m = t.match(keyRe); if (m && !/^[A-Z0-9_-]+$/.test(t.replace(m[0], '').trim() + 'X')) { /* mixed */ }
    if (m) add('raw-i18n-key', 'medium', `Raw translation key shown to users: "${m[0]}".`, el);
    const chrome = el.closest('button, th, label, .btn, .badge, h1, h2, h3, h4, h5, .card-title, .menu-title, .nav-link, [role=tab], .modal-title, .react-select__placeholder, .toast, .Toastify__toast, .alert');
    if (chrome) {
      if (rtl && latinWord.test(t) && !allowLatin.test(t) && !/@|https?:/.test(t) && !/^[A-Z0-9-]{2,12}$/.test(t)) add('untranslated-text', 'medium', `English text in the Arabic UI: "${t.slice(0, 60)}".`, el);
      if (!rtl && arabic.test(t) && !el.closest('[lang=ar],[dir=rtl]')) add('untranslated-text', 'medium', `Arabic text in the English UI: "${t.slice(0, 60)}".`, el);
    }
    if (rtl) for (const [re, w, fix] of typoRes) if (re.test(' ' + t + ' ') && !seenTypos.has(w)) { seenTypos.add(w); add('arabic-spelling', 'low', `Spelling: «${w}» → «${fix}» in "${t.slice(0, 50)}".`, el); }
  }
  for (const e of root.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    if (!vis(e)) continue;
    const p = e.placeholder.trim();
    if (rtl && latinWord.test(p) && !allowLatin.test(p) && !/@|https?:|\d/.test(p)) add('untranslated-text', 'medium', `English placeholder in the Arabic UI: "${p}".`, e);
  }

  // 12. Floating elements covering interactive ones (chat bubbles, FABs, sticky bars)
  const floats = all.filter(e => { const s = getComputedStyle(e); if (!/(fixed|sticky)/.test(s.position) || !vis(e)) return false; const r = e.getBoundingClientRect(); return r.width < 180 && r.height < 180 && r.width > 16; });
  const targets = [...root.querySelectorAll(interactiveSel)].filter(vis);
  const reported = new Set();
  for (const f of floats) {
    const fr = f.getBoundingClientRect();
    for (const t of targets) {
      if (f.contains(t) || t.contains(f) || reported.has(t)) continue;
      const tr = t.getBoundingClientRect();
      const ix = Math.max(0, Math.min(fr.right, tr.right) - Math.max(fr.left, tr.left));
      const iy = Math.max(0, Math.min(fr.bottom, tr.bottom) - Math.max(fr.top, tr.top));
      const area = ix * iy; if (!area) continue;
      if (area / Math.min(fr.width * fr.height, tr.width * tr.height) < 0.15) continue;
      const topEl = document.elementFromPoint(Math.max(fr.left, tr.left) + ix / 2, Math.max(fr.top, tr.top) + iy / 2);
      if (!topEl || t.contains(topEl)) continue;
      reported.add(t);
      add('floating-overlap', 'medium', `Floating element covers "${txt(t).slice(0, 40)}" (${Math.round(ix)}×${Math.round(iy)}px).`, t, { floating: sel(f) });
    }
  }

  // 13. Images
  for (const e of root.querySelectorAll('img')) {
    if (!vis(e)) continue;
    if (!e.hasAttribute('alt')) add('img-no-alt', 'low', 'Image has no alt attribute.', e);
    if (e.complete && e.naturalWidth === 0) add('broken-image', 'medium', `Broken image (${(e.currentSrc || e.src || '').slice(0, 80)}).`, e);
  }

  // 14. Low contrast text (WCAG ratio < 3 for normal UI text)
  const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const alpha = c => { const m = c.match(/[\d.]+/g); return m && m.length === 4 ? Number(m[3]) : 1; };
  const bgOf = e => { for (let n = e; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (alpha(b) > 0.5) return b; } return 'rgb(255,255,255)'; };
  const seenContrast = new Set();
  for (const e of all) {
    if (!vis(e) || !e.childNodes.length || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    if (e.closest('[disabled], .disabled, [aria-disabled=true]')) continue;
    const s = getComputedStyle(e); const fg = s.color; const bg = bgOf(e);
    const L1 = lum(fg), L2 = lum(bg); if (L1 == null || L2 == null || alpha(fg) < 0.3) continue;
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const key = fg + '|' + bg;
    if (ratio < 3 && !seenContrast.has(key)) { seenContrast.add(key); add('low-contrast', ratio < 2 ? 'high' : 'medium', `Text contrast ${ratio.toFixed(2)}:1 (${fg} on ${bg}) — hard to read.`, e, { ratio: +ratio.toFixed(2) }); }
  }

  // Cleanup helper marker
  const summary = {};
  for (const [k, v] of Object.entries(counts)) summary[k] = v;
  return { url: location.href, rtl, viewport: { w: innerWidth, h: innerHeight }, summary, issues: out };
};
