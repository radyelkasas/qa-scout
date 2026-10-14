# QA Scout heuristics — what to try on every page

Work like a tester with 10+ years: **explore first, then attack**, record evidence as you go, and never
report what you haven't reproduced. For each page, walk the sections below in order. Depth comes from the
config (`smoke` = §1–2 only, `standard` = §1–8, `deep` = everything).

## 1. Orient (2 minutes)
- Reach the page **the way a user would** (sidebar/menu), not only by URL. Note if the active menu item matches.
- `H.inventory()` → headings, every button, tab, input, table. This is your coverage checklist — every button gets clicked.
- `H.audit({ highlight: true, name: 'landing' })` → candidates for layout/i18n/a11y issues. Confirm each one by looking before logging it.
- Try the bare index route (`/section` without `/all`) and a trailing slash. Blank pages and doubled paths are common.
- Title vs breadcrumb vs menu label: do they name the same thing?

## 2. Read (lists, tables, dashboards)
- Empty state, one row, many rows, pagination (next/prev/page size), sorting.
- Search: a hit, a miss (does the empty message say "no results", not "no data yet"?), Arabic + Latin, partial words.
- Each filter alone, combined, reset. Does the URL keep the state after reload?
- Every row action menu: open it, list items, try each one.
- Numbers, currency, dates, time durations: format, units, RTL placement, pluralization ("1 أسئلة" ✗).
- Does a column hide data? Wide tables inside narrow boxes hide columns/actions (`clipped-content`).

## 3. Create (forms & wizards)
1. **Submit empty** → is there client validation? Are required fields marked? Are server messages human ("حقل **material id** مطلوب" ✗)? Does the toast mention hidden errors ("و2 أخطاء أخرى")?
2. **Invalid values** → negative, zero, huge, decimals where integers expected, max length+1, emoji, HTML/script text, leading/trailing spaces.
3. **Logical contradictions** → end before start, min > max, sum ≠ 100, percent > 100, duplicates of unique fields (code, email).
4. **Valid create** with a recognisable prefix (`QA …`). Then verify it **actually saved**: list, detail, API or DB.
5. After success: redirect? toast? form reset? Can a double-click create duplicates?
6. Wizards: can you skip a step with invalid data? Does Back keep values? Does the review step tell the truth?
7. Labels: does each field save into what its label says? (We found a "question text" editor that saved the lesson body.)

## 4. Update
- Does the edit form load **all** existing values (rich text, selects, files)? Saving an untouched form must not wipe data — verify via API/DB.
- Change one field, save, re-open. Success message? Does the list order jump?
- Concurrent/stale edits if relevant (two tabs).

## 5. Delete & archive
- Confirmation text: correct entity name/noun? Does it say permanent vs archived?
- **Delete something that is used elsewhere** (lesson in a course, question in an exam, concept with questions, subject with grades). Expect: blocked or "used in N places — archive instead". Then visit the places that used it: vanished item? ghost item? orphan reference?
- Cascades: what else disappears? Check the API/DB, not just the screen.
- Restore/archive filters if offered.

## 6. Permissions (needs a lower-privilege account)
- Log in as the limited account; visit every page and `/add`, `/:id/edit` routes directly.
- Buttons shown that the user can't use = finding (UX); action that **succeeds** without permission = critical (security).
- Server must refuse (403). How does the UI react — message, or a global error page after the user filled a form?
- Pickers: do teacher/student/user dropdowns show the right user types only?
- End-user account (student): what can they see via the app/API? Over-exposed fields?

## 7. Interconnections (where serious bugs hide)
For every workflow in the config, and for every "data created here is used there" relation you discover:
- Create upstream → verify downstream shows it (correct name, code, totals).
- Change upstream → does downstream update, or keep a frozen copy? Is that intended and visible?
- Delete upstream → downstream behaviour (see §5).
- Two definitions of the same thing in different places (e.g. course mark split defined in 3 places) → which one wins? Record it.
- Numbers that cross pages (marks, totals, percentages, GPA, counts): recompute by hand. Units/scales must agree (points vs %).
- Status machines: try every transition, try skipping, try the same user doing maker + checker, try legacy states.
- Notifications/side effects: if the UI says "notified", check that something was actually sent (DB/jobs/logs).
- Record a verdict per workflow with `H.flow(name, 'works'|'broken'|'partial'|'blocked', detail)`.

## 8. Language, RTL, accessibility
- Switch language once per page (or per run): leftovers in the other language, raw keys (`MENU.X.Y`), source-language
  placeholders ("Select...") in a translated UI, pluralisation ("1 items").
- Spelling in every UI language you test. The audit ships an Arabic pack (hamza إضافة/إعادة/إدارة/أنت/متأكد,
  ة vs ه, ى vs ي); for other languages, read the inventory text yourself.
- RTL mirroring: corners of button groups, margins between icon and label, toggle switches touching labels, menus opening off-screen.
- Keyboard: are clickable things real buttons/links? Icons with no name? Controls nested in controls?
- Contrast, including hover/active states (hover the active item!). Floating chat/help buttons covering content.
- Phone width (390 px): horizontal scroll, sticky bars covering content, menus.
- Dark mode if configured: re-render charts after switching (not just flipping the attribute).

## 9. Robustness & performance
- Console: "Maximum update depth", key warnings, missing translations, page errors — capture counts.
- Network: 4xx/5xx during normal use, 429 under normal navigation, slow requests (> 2 s).
- Reload mid-flow, browser back, open the same page twice. Unsaved-changes guard?
- Rate limits: pace yourself (`H.pace()`); a 429 caused by the test is a note, not a bug, unless normal use triggers it.

## 10. Data verification (when API/DB access exists)
- After every write, confirm the stored value. Our biggest finding (grade 90 → 48 F) only showed up by reading the row before/after.
- Read the backend code for anything that computes (totals, letters, GPA, prices) and recompute one example by hand.
- Seed data can be wrong in ways that real data might be too — report both "seed bug" and "UI gives no guidance".

## Severity rubric
| Severity | Use when |
|---|---|
| critical | Wrong grades/money, data loss, silent destructive cascade, security hole (action succeeds without permission, data leak) |
| high | Main flow broken or misleading result; user can't complete a core task; silent failure of an important action |
| medium | Confusing behaviour with a workaround; wrong labels; missing validation for non-critical fields; a11y blockers for some users |
| low | Cosmetic, wording, spelling, minor layout |

## Finding quality bar
Every finding = title (what's wrong, in the user's terms) + steps + expected + actual + evidence (screenshot with the
element highlighted, network line, DB/API value) + where (file:line when known) + severity. If you can't reproduce it,
don't log it — or log it as `status: 'suspected'` with what's missing. If you later disprove it, `H.retract(id, reason)`
and say so to the user.
