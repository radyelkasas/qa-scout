# Pitfalls learned the hard way (read before driving the browser)

> Part of QA Scout by Rady Elkasas (https://radyelkasas.com/).

## Driver & selectors
- **After `H.session()` / `H.startPage()` the old tab is closed.** The `page` given to steps is a live proxy that always
  points at the current tab — but never store `page.locator(...)` objects across a session switch; re-create them.
- **Field ids vs names.** An inventory may show `levelName` that is an `id`, not a `name`. Try `#id`, `[name=…]`, then
  `getByLabel()`/`getByPlaceholder()`.
- **react-select / comboboxes**: clicking the placeholder fails (the input container intercepts). Click
  `.react-select__control`, type, wait ~900 ms (async options), then click the option. Use `H.pick(control, { match })`.
  Search may be client-side over only the loaded page of options — that is itself a finding.
- **Multi-select menus stay open** after a pick; press Escape before clicking the next control.
- **Hidden radios/checkboxes** (custom styled): use `H.check(locator)` (moves the cursor to the label, force-checks).
- **Number inputs**: `fill('')` may not clear a formatted value ("28.00" + "150" → "28.00150"). `H.type()` handles it;
  for direct values use `H.setValue()`.
- **Date inputs** (`datetime-local`): use `H.setValue(loc, 'YYYY-MM-DDTHH:mm')`.
- **`strict mode violation`**: a role/name matched several elements (e.g. a sidebar "Send notifications" link and the
  form's "Send" button). Scope to the content area (`main`, or `config.contentSelector`) or the open modal (`H.topModal()`).
- **Elements reported "not visible"** while you can see them: you are on a different wizard step than you think, or a
  stray Enter submitted a step. Take a screenshot before assuming.
- **Stacked modals** intercept clicks on the lower ones → `H.closeModals()`; and report the stacking.
- **Icon-only / svg controls** (expand arrows, kebab menus): find them by position relative to the row text
  (`boundingBox`) and click with `page.mouse` — and log that they aren't keyboard accessible.

## Timing (avoid false findings)
- **Never conclude "no toast / no navigation" after 1.5 s.** Use `H.toasts(2500)`; for navigation re-check the URL a
  few seconds later. Twice in practice the toast/navigation did happen — just after a long refetch.
- Wait for `networkidle` + a short settle after every action that saves (`H.waitIdle()`).
- Background render loops ("Maximum update depth") don't block the page but flood the console — count them.

## Rate limits
- Many APIs throttle per IP (e.g. `throttle:300,1`). Rapid page loads produce 429s that are **test-induced**. Keep
  `H.rate()` under the configured limit (`H.go()` paces automatically; add `H.pace()` in loops). Note the 429 only if
  it happens at a normal user's pace — or if a single endpoint has a much lower inline limit.

## Shell gotchas (zsh on macOS)
- Never name a shell variable `path` in zsh — it is tied to `$PATH` and every command disappears.
- `curl -F 'field=<p>x</p>'` reads a **file** named `p>x</p>`; use `--form-string` for HTML values.
- `cat -A` doesn't exist on macOS; use `cat -v` / `od -c`.
- Quote paths that contain spaces.

## Data & verification
- Read the DB/API before **and** after a write that computes something (totals, GPA, letters). Screens can look fine.
- Seeders and demo data are often internally inconsistent (future dates, wrong subjects, points vs percentages). Say
  "seed data" when that's the cause, but still report the UI's lack of guidance.
- When the UI won't offer a choice you need for a test (e.g. a semester), you may set it through the API/DB in an
  **isolated** test DB — say so explicitly in the finding ("linked via DB because the UI didn't offer it").
- Creating throwaway records: prefix with `QA`, and delete through the UI when testing delete; list leftovers at the end.

## Honesty rules
- If a claim turns out wrong, retract it (`H.retract`) and tell the user in plain words — e.g. "the toast does appear;
  my first check was too early".
- Distinguish **verified in UI**, **verified via API/DB**, and **read in code only** (`verifiedBy`).
- Test-script mistakes are not app bugs (e.g. "my script picked the parent as teacher") — but the bug they reveal may
  still be real ("parents are selectable at all").
