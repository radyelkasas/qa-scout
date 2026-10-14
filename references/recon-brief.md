# Recon brief (prompt template for the code-mapping agent)

Use when the config has `frontendRepo` and/or `backendRepo`. Launch ONE background `Explore` agent (very thorough)
with the prompt below, filled in. Start browser testing in parallel; merge its hypotheses into the test plan when it
returns. Treat its output as **hypotheses to verify live**, never as findings.

---
Repos (read-only): frontend `{frontendRepo}`, backend `{backendRepo}`. Search breadth: very thorough.

I am about to QA these routes as {admin role} (and {limited roles}):
{one route per line}

For EACH route give me (compactly):
1. Page component file and main child components (paths).
2. Every user action (create/edit/delete, filters, bulk, import/export, publish, wizard steps, row actions).
3. Backend endpoints called (method + path) and the controller/service handling them.
4. Permission keys checked in the UI (route gate, button gates) and in the backend policy.
5. Tenant/variant/role differences that apply.

Then map the INTERCONNECTIONS with file:line evidence:
- Which entities flow between these pages (what is created on one and consumed on another).
- These workflows specifically: {workflows from config}
- For each delete endpoint: soft vs hard delete, cascades, and whether it checks usage elsewhere.
- Any value computed across pages (totals, percentages, GPA, prices, counts): where it's computed and what scale/units.
- Places where the same concept is defined twice (two sources of truth).

Finally list obvious gaps/risks with file:line: dead links / bad redirects, frontend calling endpoints that don't exist,
fields sent but ignored (or required but never sent), missing permission gates, unreachable states, stubs/TODOs in
critical paths, raw validation attribute names. Keep it under ~1500 words; no file dumps.
---
