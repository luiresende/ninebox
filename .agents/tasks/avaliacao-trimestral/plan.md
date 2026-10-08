# Implementation Plan — Avaliação Trimestral (ciclos por período)

Static web app (no build/npm/ES modules). IIFE globals `window.Model`, `window.Store`.
All paths below are relative to the worktree root `c:\dev\avaliacao\.worktrees\trimestral`.

## Design decisions (grounded in the code read)

- **periodKey format**: `"YYYY-Qn"`, quarters fixed to the civil calendar — Q1=Jan-Mar, Q2=Apr-Jun,
  Q3=Jul-Sep, Q4=Oct-Dec. Current quarter = `"" + year + "-Q" + (Math.floor(month/3)+1)` where
  `month` is 0-indexed from `new Date()`. Rationale: fixed calendar quarters make the key stable and
  comparable across members and across reloads, independent of when evaluation started.
- **New data shape**: `member.periods[periodKey] = { scores, plan }`. `scores` keeps the existing
  `{ [pillarId]: { [competencyName]: 1..5 } }` shape; `plan` keeps the existing
  `[ { id, title, desc, tasks:[{id,text,done}] } ]` shape. Nothing about the inner shapes changes —
  only the nesting under `periods[periodKey]`.
- **Migration strategy — lazy, on read, non-destructive**: a legacy member has top-level `scores`
  and/or `plan` and no `periods`. On read we build `periods[currentQuarter] = { scores, plan }` and
  KEEP the legacy top-level fields untouched in memory. We only drop the legacy top-level fields when
  the member is next SAVED (write path strips `scores`/`plan` from the doc root and persists
  `periods`). Rationale: keeping legacy fields until a real write means a pure read never risks data
  loss, and because Firestore `save` uses `{ merge: true }` we explicitly delete the stale root
  fields on write (via `firebase.firestore.FieldValue.delete()` in Firebase mode; plain object
  omission in local mode) so they can't resurrect. Idempotent: if `periods` already exists we do not
  overwrite it; a member read twice yields the same structure.
- **Where migration lives**: in `store.js`, wrapping both read (`list`) and write (`save`) in BOTH
  `LocalStore` and the Firebase store, via two shared helpers `migrateOnRead(member)` and
  `prepareForWrite(member)`. This keeps `app.js` free of migration branching and guarantees every
  code path that touches the store is covered.
- **Model stays period-agnostic via a scores accessor**: rather than thread a periodKey through every
  calc, add `Model.periodScores(member, periodKey)` returning the scores object for that period (with
  read-time fallback to legacy top-level), and change `pillarAverage` / `memberScoresByCompetency` /
  `teamAverageByCompetency` / `performanceScore` / `potentialScore` / `nineBoxCell` / `nineBoxLabel`
  to accept an explicit `periodKey` argument. Rationale: a single accessor localizes the
  retrocompat/fallback logic; callers in app.js pass the selected quarter. Signature chosen so the
  team-average and Nine Box always use the SAME selected quarter (task requirement 4).
- **Selected quarter is app state**: `app.js` holds `selectedPeriod` (defaults to current quarter).
  The global selector in each relevant view's `.view-head` reads/writes it. Collaborators can change
  it to browse history (read-only is already enforced by `canEdit()` gating the dot buttons / inputs).
- **Permissions / rules unchanged**: all data stays inside the `members` doc; `firestore.rules` and
  `firebase-config.js` are NOT touched.

## Ordered items

- [ ] 1. Add period helpers + lazy migration to the Store layer.
      In `js/store.js`: add module-level helpers `currentPeriodKey()` (returns `"YYYY-Qn"` from
      `new Date()`), `periodKeyFor(date)`, `migrateOnRead(member)` (if no `member.periods`, create
      `periods[currentPeriodKey()] = { scores: member.scores||{}, plan: member.plan||[] }`, leaving
      legacy fields in place; idempotent when `periods` already exists), and `prepareForWrite(member)`
      (ensure `periods` exists via `migrateOnRead`, then produce the payload with root `scores`/`plan`
      removed — in Firebase mode set them to `firebase.firestore.FieldValue.delete()`; in local mode
      omit them). Wire `migrateOnRead` into `LocalStore.list` and `firebaseStore.list` (map each
      member through it), and `prepareForWrite` into both `save` paths. Expose
      `window.Store.currentPeriodKey` and `window.Store.periodKeyFor`.
      Files: js/store.js
      Verify: `caddy file-server --listen :8080 --root c:\dev\avaliacao\.worktrees\trimestral` then
      open http://localhost:8080 (local mode); in DevTools console confirm no errors and that
      `Store.currentPeriodKey()` returns the expected `YYYY-Qn`. Confirm braces/parens/backticks
      balanced (file parses — no console SyntaxError on load).

- [ ] 2. Make model calculations operate on a selected period.
      In `js/model.js`: add `periodScores(member, periodKey)` returning
      `(member.periods && member.periods[periodKey] && member.periods[periodKey].scores) ||
      member.scores || {}` (retrocompat fallback). Change `pillarAverage(member, pillar, periodKey)`,
      `memberScoresByCompetency(member, pillar, periodKey)`,
      `teamAverageByCompetency(members, pillar, excludeId, periodKey)`,
      `performanceScore(member, periodKey)`, `potentialScore(member, periodKey)`,
      `nineBoxCell(member, periodKey)`, `nineBoxLabel(member, periodKey)` to resolve scores through
      `periodScores`. Keep `weightedAxis` passing the periodKey through. Export `periodScores`.
      Files: js/model.js
      Verify: reload http://localhost:8080; console `Model.pillarAverage(m, Model.PILLARS[0],
      Store.currentPeriodKey())` on a member returns a finite number equal to the pre-change value for
      a migrated member. No SyntaxError on load.

- [ ] 3. Add the global quarter selector markup + the Evolução nav item/view to index.html.
      In `index.html`: add a quarter-selector control (prev button, `YYYY-Qn` label, next button) into
      the `.view-head` of `#view-evaluate`, `#view-ninebox`, and `#view-plan` — use a shared markup
      block with distinct ids per view (e.g. `#q-sel-evaluate`, `#q-sel-ninebox`, `#q-sel-plan`) OR a
      single reused component rendered by JS; choose the JS-rendered approach (one `renderQuarterBar(container)`
      helper) to avoid markup duplication. Add nav item
      `<button class="nav-item" data-view="evolution"><span class="nav-icon">📊</span> Evolução</button>`
      after the Plano item, and `<section id="view-evolution" class="view">` with a member select
      (`#evolution-member-select`), a canvas (`#evolution-chart`), and an empty-state element.
      Files: index.html
      Verify: reload http://localhost:8080; the "Evolução" tab appears in the sidebar and clicking it
      shows the (empty) section; the quarter bar appears in Avaliação/Nine Box/Plano.

- [ ] 4. Wire the selected quarter into app.js state + the quarter bar, and adapt the dependent views.
      In `js/app.js`: add `let selectedPeriod = Store.currentPeriodKey();` Add
      `renderQuarterBar()`/prev-next handlers that update `selectedPeriod` and re-render the active
      view. Update `renderEvaluate`/`setScore` to read/write `member.periods[selectedPeriod].scores`
      (create the period lazily on first write) and pass `selectedPeriod` to all `Model.*` calls.
      Update `renderPlan`/`persistPlan`/`addTask`/`toggleTask`/`removeTask` and the objective modal to
      operate on `member.periods[selectedPeriod].plan`. Update `renderNineBox` to pass `selectedPeriod`
      to `Model.performanceScore`/`potentialScore`/`nineBoxLabel`. In `setScore`, build the period
      object if missing so collaborators-vs-leader and empty periods behave correctly. Keep
      `canEdit()` gating unchanged (collaborator read-only, incl. when browsing other quarters).
      Files: js/app.js
      Verify: reload; as leader, set scores on current quarter, switch to another quarter (empty),
      switch back — scores persist. In local mode, inspect `localStorage['avaliacao.members.v1']` and
      confirm the saved member has `periods[<q>]` and NO root `scores`/`plan`. Nine Box and the radar
      team-average reflect the selected quarter.

- [ ] 5. Implement the Evolução line chart + collaborator/leader member selection.
      In `js/app.js`: add `renderEvolution()` wired from `switchView('evolution')`. Build an ordered
      list of the member's existing period keys (sorted ascending), compute each pillar's average per
      period via `Model.pillarAverage(member, pillar, key)`, and render a Chart.js `line` chart on
      `#evolution-chart` with three datasets (hard/soft/discipline) using each pillar's `color`, y-axis
      0..SCALE_MAX. Leader picks the member via `#evolution-member-select`; collaborator sees only self
      (hide/disable the select). Destroy any prior chart instance before re-draw. Register the view in
      `switchView` and in `reloadAndRender` when active.
      Files: js/app.js
      Verify: reload; Evolução shows a line chart; with a member having scores in ≥2 quarters the three
      pillar lines plot one point per quarter. Collaborator sees only their own chart.

- [ ] 6. Add CSS for the quarter bar (and Evolução chart wrap if needed).
      In `styles.css`: add `.quarter-bar` (flex row, gap, aligned via existing `.view-head` right-align
      pattern — mirror `.view-head .select { margin-left:auto }`), small prev/next `.q-nav` buttons,
      and `.q-label`. Add an `.evolution-wrap` sized like `.ninebox-wrap` for the canvas. Reuse the
      existing CSS variables (`--surface-2`, `--border`, `--text`, `--muted`, `--primary`). No new theme.
      Files: styles.css
      Verify: reload; quarter bar is styled consistently with the dark theme and right-aligned in the
      view head; the Evolução canvas has a sensible height.

- [ ] 7. Add console.assert self-tests for migration + period calc.
      In `js/store.js` (or a small guarded block that runs only in local/dev), add a self-test invoked
      once on load behind a flag (e.g. `window.__RUN_SELFTEST__` or `location.search.includes('selftest')`):
      (a) a synthetic LEGACY member `{id,scores:{hard:{'Cloud / AWS':4}},plan:[...]}` run through
      `migrateOnRead` gains `periods[currentPeriodKey()]` with the same scores/plan;
      (b) a synthetic NEW member (already has `periods`, no root scores) is returned unchanged
      (deep-equal periods, still no root scores);
      (c) `Model.pillarAverage(migratedLegacy, hardPillar, currentPeriodKey())` equals the hand-computed
      expected average. Use `console.assert(cond, msg)` with clear messages. Keep it side-effect-free on
      real data (operate on synthetic objects only).
      Files: js/store.js
      Verify: open http://localhost:8080/?selftest ; console shows the asserts and NONE fail
      (no "Assertion failed" lines).

- [ ] 8. (Bonus, if time permits) Overlay previous-quarter on the Avaliação radar and show Nine Box drift.
      In `js/app.js` `drawRadar`: add a faint dataset for the previous quarter
      (`Model.periodKeyFor` of a date 3 months earlier, or compute prev `YYYY-Qn`) when that period
      exists for the member. In `renderNineBox`: when a previous quarter exists, draw a light connector
      from the previous point to the current point per member. Guard everything so missing previous data
      is a no-op. This is explicitly lower priority than the line chart (item 5).
      Files: js/app.js
      Verify: reload with a member having two consecutive quarters; the radar shows a secondary faint
      shape and the Nine Box shows the drift indicator. Core features (items 1-7) still pass.

## Final integration verification

Run `caddy file-server --listen :8080 --root c:\dev\avaliacao\.worktrees\trimestral` and in a browser:
1. All four tabs (Avaliação, Nine Box, Plano, Evolução) load without console errors.
2. Legacy member migrates to current quarter on read; its scores/plan are intact.
3. After saving, the stored doc uses `periods[...]` and has no root `scores`/`plan`.
4. Switching quarters and returning preserves data.
5. `?selftest` asserts all pass.
6. Login, roles, Usuários (incl. delete button), and Tutorial still work (not regressed).

**Stop contract:** the implement-and-review loop stops when
`c:\dev\avaliacao\.worktrees\trimestral\.agents\tasks\avaliacao-trimestral\review.json` has top-level
`"verdict": "APPROVED"`.
