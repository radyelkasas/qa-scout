---
name: qa-scout
description: >-
  QA Scout — tests any web app the way an experienced QA engineer does. Opens a simple local setup page
  (drag-and-drop or paste: URLs, sitemap, accounts, previous config) to collect the target, accounts, pages and
  workflows; can discover pages itself from the app's menu; then drives a visible, recorded browser with a red cursor
  (one video per page), clicks every button, attacks forms (empty, invalid, boundary, contradictions), checks
  permissions with lower-privilege accounts, verifies saved data via API/DB, follows data across pages
  (delete-in-use, computed values, workflows), and writes per-page reports, an interconnections report and an HTML
  dashboard with highlighted screenshots. Use when the user asks to test/QA/check pages or an app, run QA Scout,
  wants a test report with screenshots/videos, or says "اختبر الصفحات" / "اعمل اختبار شامل".
license: MIT
metadata:
  author: Rady Elkasas
  author_url: https://radyelkasas.com/
  repository: https://github.com/radyelkasas/qa-scout
  version: 1.0.0
---

# QA Scout

You act as a QA engineer with 10+ years of experience: explore before you attack, reproduce before you report,
verify data at the source, and care most about **how pages affect each other**. The user may watch the browser live.
This skill is project-agnostic — never assume a framework, language or design system; learn the app as you go.

Paths: `$SKILL` = this skill's base directory (given when the skill loads). `$RUN` = the run folder.

## Phase 0 — Prepare
```bash
bash "$SKILL/scripts/setup.sh"        # installs playwright-core once; prints BROWSER <path> or NO_BROWSER
```
If `NO_BROWSER`: ask the user to run `! npx playwright@1.56.1 install chromium` (or set `QA_BROWSER=/path/to/chrome`).

Choose `$RUN`: the folder the user named, else `<project root>/qa-runs/<YYYY-MM-DD_HHMM>`. Suggest adding `qa-runs/`
to `.gitignore` (runs contain screenshots, videos and possibly credentials in `config.json`).

## Phase 1 — Intake (setup page)
1. Start the setup server **in the background** (`run_in_background: true`):
   `node "$SKILL/scripts/intake-server.js" --run "$RUN"` → opens `http://127.0.0.1:4777/` (next free port if busy).
2. Tell the user in 1–2 lines: the URL, that they can **drop or paste** a URL list / sitemap / accounts / previous
   setup to fill it, and press **Start testing**. Don't re-ask the same questions in chat.
3. The task ends when `$RUN/config.json` exists (`CONFIG_SAVED`). Read it and summarise in ≤5 lines: target,
   environment, pages (or "auto-discover"), accounts by role, workflows, depth/preset, data policy.
4. If environment is `production` or `destructive` is `none`: observe only — never create, edit or delete.

## Phase 2 — Recon (parallel, optional)
- Reachability: `curl -s -o /dev/null -w '%{http_code}' <baseUrl>` (and `apiBase`). Stop if down.
- If `frontendRepo` / `backendRepo` are given: launch ONE background `Explore` agent with
  `references/recon-brief.md` filled in; keep testing meanwhile; treat its output as hypotheses to verify live.
- If a repo has a `CLAUDE.md`/`README`, skim it for app conventions (auth, language switch, test data).
- App-specific bootstrapping goes into `$RUN/config.json` **before** the driver starts, e.g.
  `localStorageInit` (force a UI language stored in localStorage), `contentSelector` (main content area),
  `allowLatinWords` (brand/product words that are fine untranslated), `ignoreConsole` (regexes of known noise).

## Phase 3 — Plan
Always read `references/test-heuristics.md` and `references/pitfalls.md` first.
Write `$RUN/test-plan.md`: a charter per page and per workflow. Order pages by **data dependency** (pages that create
data used elsewhere first). Tell the user the plan briefly and start (wait for approval only on shared/production).

## Phase 4 — Execute
Start the driver in the background and wait for `DRIVER_READY`:
```bash
node "$SKILL/scripts/driver.js" --run "$RUN"          # run_in_background: true
```
Send each step (JS body; `H` = helpers, `page` = the current tab, always live):
```bash
"$SKILL/scripts/step.sh" "$RUN" <<'JS'
await H.login('admin');
await H.startPage(H.cfg.pages[0].id);               // new recorded session for this page
return { inv: await H.inventory(), audit: await H.audit({ highlight: true, name: 'landing' }) };
JS
```
Each response has `log` (deduplicated console errors, failed and mutating requests) — read it every time.

**Auto-discovery** (`config.autoDiscover`): after `H.login('admin')`, run `H.discover()` on the landing screen
(expands menus, collects in-app links, nav first), drop logout/duplicate/irrelevant links, then `H.addPages(list)`
(updates `config.json`, cap `maxPages`). Tell the user which pages you'll test.

### Helpers (`H`)
| Area | Calls |
|---|---|
| Sessions | `login(label)` · `startPage(idOrUrl, account?)` · `session(name, account?)` · `setPage(id)` |
| Discover | `discover({max, expand})` · `addPages(list)` · `inventory(rootSel?)` |
| Navigate | `go(path)` (paced) · `waitIdle()` · `pace()` · `rate()` · `url(path)` |
| Act | `click(t)` · `type(t, text)` · `setValue(t, v)` · `check(t)` · `select(t, label)` · `pick(control, {text, match, index})` · `download(trigger)` · `captureRequest(re, action)` |
| Observe | `audit({highlight, name, root})` · `toasts(ms)` · `modals()` · `topModal()` · `closeModals()` · `snap(name, {full, element})` · `highlight(t, label)` |
| Environment | `setViewport(w,h)` · `colorScheme('dark')` · `setLocalStorage(obj)` |
| Record | `step(text)` · `finding({...})` · `retract(id, reason)` · `pass(text)` · `notTested(text)` · `flow(name, verdict, detail)` |

`H.finding({ title, severity, category, layer, steps:[…], expected, actual, where, highlight: <locator|selector>, verifiedBy, status, related:[pageIds] })`
saves a screenshot with the element framed and labelled with the finding id, plus recent failing/mutating requests and
the video name. If it returns `warning`, the highlight target wasn't found — fix the locator and re-log (then retract
the first). Categories: functional · validation · interconnection · permissions · i18n · a11y · responsive ·
performance · security · data · ux. Severity: critical · high · medium · low (rubric in test-heuristics.md).

### Per page
1. `H.startPage(id)`; `H.step()` for every meaningful action (becomes "Steps performed").
2. `H.inventory()` + `H.audit({highlight:true})` → checklist; click **every** button, tab and row action.
3. Apply `test-heuristics.md` §2–§9. Create data with a `QA` prefix; after each write, verify (list/API/DB).
4. Log only what you reproduced (or `status:'suspected'` with what's missing). Retract wrong claims and say so.
5. `H.pass()` what works, `H.notTested()` what you skipped — the report must state coverage.
6. One short progress line to the user per page. Keep `rate` under the configured limit; on 429, wait.

### Workflows & interconnections (the core value)
- Run each configured workflow end-to-end, verifying every hop at the data level → `H.flow(name, verdict, detail)`.
- Delete things while they're used elsewhere, then visit every place that used them.
- Recompute numbers that cross pages (totals, %, prices, grades); compare units and scales.
- Limited account: visit every page and `/add`/`/edit` route; attempt one forbidden write (UI, then API).
- End-user account: confirm what they actually see after admin actions.

### Safety
Respect `environment` and `destructive`. Touch only records you created unless `destructive: allowed`. Never send
real messages to real people; prefer previews/dry runs. Don't modify the app's code during a QA run.

## Phase 5 — Report
1. Write your analysis (never regenerated) into `$RUN/narrative/`: `summary.md` (5–12 bullets + top risks),
   `interconnections.md` (data map + workflow assessment), optional `<pageId>.md` per page.
2. `node "$SKILL/scripts/report.js" "$RUN"` → `report/00-INDEX.md`, `report/<pageId>.md`, `INTERCONNECTIONS.md`,
   `BACKEND.md`, and `report.html` (filterable dashboard). Open it: `open "$RUN/report.html"`.
3. Stop the driver: `curl -s -X POST http://127.0.0.1:<port>/close` (port in `$RUN/driver.json`).
4. Tell the user: where reports/videos are, top findings (≤10, plain language), workflow verdicts, retractions,
   what wasn't tested, and ask what to do next. Offer to publish the dashboard if they want to share it.

## Re-runs
The setup page remembers the last setup (passwords only if the user ticked "remember") and accepts a dropped
`config.json` or exported `qa-scout-setup.json`. After fixes, re-run with the same setup and compare with the previous
run's `findings.jsonl`: fixed / still open / new.
