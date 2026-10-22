# Plan review log (append-only)

## Run setup — 2026-10-22
- Workflow: claudex-loop 2.1.0, host = Claude Code (coordinator and planner), plan reviewer = Codex CLI, builder = Claude (this session), final inspector = fresh Codex session.
- Plan: PLAN.md. Log: PLAN-REVIEW-LOG.md. Max review rounds: 5. MAX_FIX_ROUNDS 2, MAX_INSPECTION_ROUNDS 2. Inspection: on.
- Models: no explicit reviewer/inspector model requested; Codex uses its CLI configuration (recorded per run when observable).
- Scope and authorization: owner (Kai) asked to decide the first-version architecture, plan and implement it, with Claude building; push to GitHub authorized (repo https://github.com/Podi-Skying/Aya-Travel-Australia).
- Owner decisions: GitHub + Vercel + Next.js (React, TypeScript) + Neon Postgres + Auth.js GitHub login (owner Podi-Skying), Claude API later; trip dates Sydney 11/03–11/06, Tasmania 11/06–11/27.
- Run diagnostics are kept outside the checkout under the session scratchpad.

## Round 1 — Codex review
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/review-r1/claudex-ak01y2dr/result.json
- Plan SHA256 reviewed: 35eb9973a6d304b4d0f400a8208c16e70174587c99e6c860c5e9be20b7d700fd
- CLI: codex-cli 0.163.0; requested model: CLI default; effective_model (client-applied, from rollout): gpt-6-luna; effort xhigh; sandbox read-only.
- Verdict: REVISE. Summary: gaps in concurrent version writes, offline coverage, budget editing parity, date-bound voting, deletion handling; ambiguous 11/03 flight remap.
- Findings: F-01 (medium) concurrent writes can 500 instead of 409; F-02 (medium) offline lacks versions and alert status; F-03 (medium) shared-cost participants not editable; F-04 (medium) vote key omits date; F-05 (medium) a25 origin-dependent fields; F-06 (low) rate_limits survive trip deletion.
- Coverage: PLAN.md, docs/*, site/js/app.js, site/js/data.js. Limitations: plan only, no commands run.

### Host dispositions (round 1)
All six findings accepted and applied to PLAN.md:
- F-01 accepted: writes lock the trip row (SELECT ... FOR UPDATE) before the base-version check; residual unique violations map to 409. AC4 now requires a concurrent-write test (one success, one 409, one new version).
- F-02 accepted: offline store now also holds last-known alert status (rule warnings, feasibility labels, alertsSources) and, for the owner, the version list with each version's document (read-only offline). AC10 extended.
- F-03 accepted: owner can edit days[].costs[].participants; listed in section 4.5.
- F-04 accepted: vote identity is (item_id, day_date, voter_hash); unique key and edit/withdraw use all three; votes for a moved activity stay on the old date and are reported separately as "日期已變更的舊回應". AC7 extended with a date-move test.
- F-05 accepted: a25 field-by-field rewrite specified in section 4.9 (origin-dependent source, durations, and fare removed and marked unknown).
- F-06 accepted: rate_limits rows carry trip_id with ON DELETE CASCADE; AC9 checks they are removed.

Owner-driven changes since round 1 (not reviewer findings; please review them):
- D7 dates confirmed by the owner. D8 (new owner instruction): remove the 10/25–11/02 day plans entirely but keep their attraction information. Section 4.9 was rewritten: the seed is a single version 1 with no day before 11/03; legacy items a03–a24 move into an unscheduled attractionPool of packages with suggestion-only dates; owner actions to schedule/unschedule are added (section 4.5); AC14 rewritten.
- New section 4.11 and AC15: port of site/landing.html (3D journey page, commit 8f06712) with chapter order Sydney first, stops by item id, stats derived from data, and reduced-motion/WebGL fallbacks.
- Section numbering changed (4.9 seed/pool, 4.10 accessibility, 4.11 journey).

## Round 2 — Codex review (resumed session)
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/review-r2/claudex-x9jhqpvk/result.json
- Plan SHA256 reviewed: 20b5f28cc3e6d084e6a65954ede50ab611c8997c0ae65d2e34e91b1dccd2577e; effective_model gpt-6-luna.
- Verdict: REVISE. Round-1 dispositions confirmed addressed. New findings: R2-01 (medium) pool scheduling listed as non-goal; R2-02 (medium) no destination check when scheduling; R2-03 (medium) package data merged into day with no undo; R2-04 (medium) journey chapters not chronological (a37); R2-05 (low) docs keep old dates; R2-06 (medium) item ids not required unique; R2-07 (low) landing copy still calls Sydney an interlude.

### Host dispositions (round 2)
All seven findings accepted and applied:
- R2-01 accepted: the non-goal now excludes only choosing placements for the owner; scheduling actions are in scope and the seed schedules nothing from the pool.
- R2-02 accepted: packages carry `seg` (seeded "tas"); scheduling is allowed only onto days with the same `seg` (UI filters dates, API returns 400 otherwise); day `seg` never changes. Test added in AC14.
- R2-03 accepted: package contributions are stored as `day.attached[]` records, not merged into owner-edited day fields; `effectiveDay(day)` applies them for budget/rules/map/journey; single-item scheduling attaches nothing; items keep `originPackage`; when the last item of an attached package leaves a day the attachment is removed and returned to the pool. Driver conflicts return 400. Tests added in AC14, including that an unrelated owner edit survives.
- R2-04 accepted: a37 (Tahune, 11/08) moved from wild to hobart so seeded chapters are chronological; chronology defined for the seeded version, chapters are narrative groups afterwards; AC15 checks cross-chapter order.
- R2-05 accepted: AC1 now requires docs/DECISIONS.md and docs/PRODUCT_BRIEF.md to carry the new dates and D8.
- R2-06 accepted: schema requires globally unique item ids across days and pool; duplicate-id import/save tests added to AC14.
- R2-07 accepted: all route-dependent landing copy rewritten for Sydney-first; AC15 greps for the old wording.

## Round 3 — Codex review (resumed session)
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/review-r3/claudex-kpp3p3k0/result.json
- Plan SHA256 reviewed: 99e9a429ebb58d9a542c0b4571f5f740300e60701b3718623b2400e08ca42129
- Verdict: REVISE. Prior findings resolved. New: R3-01 (medium) single-item scheduling drops the driver dependency; R3-02 (medium) boolean driver confirmation can carry over to a different driver.

### Host dispositions (round 3)
Both findings accepted and applied:
- R3-01 accepted: a drive item scheduled alone from a package with needsDriver carries an item-level needsDriver; effectiveDay derives the day's effective requirement from day field, then attachments, then item-level requirements; conflicting drivers on one day return 400. AC14 adds the a04-alone test (warning shown, a04 tentative). Privacy filter also masks item-level needsDriver.
- R3-02 accepted: driver confirmation is stored as day.driverConfirmation = { driver, window } and counts only when driver equals the effective needsDriver; stale confirmations are shown as "確認對象已變更" and do not count. AC14 adds the confirm-Zayden/detach/attach-JJ test; AC3 parity harness maps confirmation to legacy driverOk; AC6 checks the confirmation window is not public.

## Round 4 — Codex review (resumed session)
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/review-r4/claudex-5f6albur/result.json
- Plan SHA256 reviewed: a57c92374f3581a98ea2a9125f333f6ae6e12e40c0c4a1388955746cecb3d84e
- Verdict: REVISE. Prior fixes present. New: R4-01 (medium) walk items from a driven package lose the driver dependency; R4-02 (medium) confirmation without a time window could count.

### Host dispositions (round 4)
Both findings accepted and applied:
- R4-01 accepted: any single item scheduled from a package with needsDriver carries item-level needsDriver regardless of its mode; such items are tentative while unconfirmed. AC14 adds the a11 (walk) test.
- R4-02 accepted: driverConfirmation.window is required, non-empty, HH:MM–HH:MM with start before end; driver must be a key of drivers; invalid confirmations are rejected on save and import. AC14 adds the empty/malformed window test.

## Round 5 — Codex review (resumed session, round budget reached)
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/review-r5/claudex-9ermpt0g/result.json
- Plan SHA256 reviewed: 91ef507f9cd3eba6dfd92434d20ac44264b35fd931d455654387029bd6020ac7
- Verdict: REVISE. Round-4 fixes confirmed. New: R5-01 (medium) single scheduled driver-dependent item loses package drive time and alternative.

### Host dispositions (round 5)
- R5-01 accepted: a single driver-dependent item carries packageContext = { key, driveHrs, alt }; effectiveDay adds each package's driveHrs once per day and lists each alt once; costs and flags still not attached; context removed when the item moves back. AC14 adds the a11 test (2.5 h drive and alternative shown; added once for a11 + a12).

### Status after the round budget
- MAX_ROUNDS (5) reached. The plan was revised for R5-01 after the last review; that revision is not yet independently reviewed, so the plan is NOT approved.
- Host position: R5-01 is a narrow data-context fix; findings have converged from 6 → 7 → 2 → 2 → 1, all in the attraction-pool driver edge cases, with no remaining architecture objections.
- Decision requested from the owner: authorize one extra review round (recommended) or proceed to build with the R5-01 revision recorded as unreviewed.

## Round 6 — extra Codex review (beyond MAX_ROUNDS; coordinator-recommended option A, owner answer pending)
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/review-r6/claudex-ngw2vp82/result.json
- Plan SHA256 reviewed: 4c6c8a12305554ed6d326bda7381134deb97a880c58f4daf5049b3b6da4ce06c
- Verdict: REVISE. R5-01 fix confirmed. New: R6-01 (medium) single item drops package flags (hike/ferry/transfer), so the heavy-day warning can be missed.

### Host dispositions (round 6)
- R6-01 accepted, fixed structurally to close this class of single-item findings: a single scheduled item now carries the package's complete non-cost context (needsDriver, driveHrs, alt, ferry, hike, transfer). effectiveDay merges attachment and single-item contexts with one rule, deduplicated by package key. The only difference between scheduling a whole package and a single item is the package costs. AC14 adds the a12 heavy-day warning test.

## Round 7 — extra Codex review
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/review-r7/claudex-pic_l_sd/result.json
- Plan SHA256 reviewed: a33121db1ece9e41fa62820ba29317dc6f03f278b9d32d713e04e9c733663cef
- Verdict: REVISE. R6-01 fix accepted. New: R7-01 (medium) packageContext.needsDriver could leak driver names on public pages.

### Host dispositions (round 7)
- R7-01 accepted: toPublicDoc now walks the whole document recursively, masking needsDriver in every nested location (day, item, packageContext, attached[], attractionPool) and removing every driverConfirmation; a final serialized-output guard fails closed if any driver key or stay address remains. AC6 now checks the itinerary and journey public responses after single-item scheduling, a whole-package attachment, and a driver confirmation.

## Round 8 — extra Codex review
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/review-r8/claudex-gjrhwpyo/result.json
- Plan SHA256 reviewed: 7a0db40ea58dad60a317fffe10f2a88c52ac5524bfb9083cd433c65025198cf2
- Verdict: REVISE. R7-01 accepted as fixed. New: R8-01 (medium) concurrent share-link creation could leave two active links; R8-02 (medium) rate-limit check not atomic.

### Host dispositions (round 8)
- R8-01 accepted: share-link create/deactivate lock the trip row in one transaction; partial unique index (trip_id) WHERE active; residual violation maps to 409; AC7 adds the concurrent create test.
- R8-02 accepted: rate-limit quota is reserved atomically with INSERT ... ON CONFLICT DO UPDATE ... RETURNING count for both keys inside the vote transaction; rejected requests roll back; AC7 adds concurrent burst tests at each limit (limits configurable for tests).

## Round 9 — extra Codex review
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/review-r9/claudex-76m4cwe3/result.json
- Plan SHA256 reviewed: 0a48486a1411124e9dd6bff9313c071e30cf04c58f969303e45037e00eb81246
- Verdict: REVISE. R8 fixes confirmed. New: R9-01 (high) owner pages such as /journey not required to authenticate before reading the owner doc; R9-02 (medium) public vote input not validated against scheduled items, nickname limit not server-side; R9-03 (medium) privacy guard would trip on empty address strings; R9-04 (medium) uncapped versions vs storage assumptions and offline growth.

### Host dispositions (round 9)
- R9-01 accepted: every owner page and read route calls requireOwner() server-side before any DB read; owner-doc loaders require the verified identity as an argument; AC5 adds page-level tests with a loader spy.
- R9-02 accepted: public interest requests validated server-side (body size, UUID voter key, nickname ≤ 20, new votes must match a scheduled item/date, edits/withdrawals must match an existing vote); AC7 extended.
- R9-03 accepted: guard checks only non-empty addresses plus absence of address/driverConfirmation keys; AC6 adds empty-address test.
- R9-04 accepted: server keeps all versions (FR-07) with a revised size estimate; offline keeps documents for the 20 most recent versions plus version 1; AC10 updated.

### Status
- Review rounds used: 9 (5 budgeted + 4 extra). The final plan (with the round-9 dispositions) has NOT received an APPROVED verdict.
- Host decision: proceed to build under the owner's original plan-and-implement authorization, recording this plan version as unreviewed for the round-9 changes, as proposed to the owner (option A). Final code inspection by a fresh Codex session remains mandatory and will cover the round-9 changes in code.
- Plan SHA256 at build start: ce9f6e7fdb10a7ad43e3559a5b8c531cf2efd061468bd40f4173e4d5eddadbaa

## Build (Claude, this session)
- Base commit for inspection: 4f02e72. Build commit: e95117d.
- Host proof run: npm ci, npm run lint, npm run typecheck, npm test (74 tests), npm run build — all exit 0; npm audit --omit=dev: 0 vulnerabilities.
- Manual checks (local production build, PGlite seed, visitor share link): overview, day detail, map, pool, info, 375 px width (no horizontal scroll), interest submit and withdraw, journey page, offline reload with server stopped. Owner pages were not checked manually (GitHub login needed; to do on production after docs/DEPLOY.md).
- Found and fixed during manual checks: offline banner did not appear when the service worker answered from its cache (SW now marks cached fallbacks with x-aya-offline).

## Inspection 1 — fresh Codex session
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/inspect-1/claudex-626mlnza/result.json; effective_model gpt-6-luna.
- Verdict: REVISE. R-01 (medium) impossible dates/times accepted; R-02 (medium) alert status from API/offline not shown; R-03 (medium) journey loader stays if Three.js chunk fails; R-04 (medium) journey pages lack last-sync/offline notice; R-05 (low) request body read fully before size check; R-06 (low) NEXTAUTH_URL vs preview deployments.

### Fix round 1 (Claude) — dispositions
- R-01 accepted: real calendar-date check and 00:00–23:59 times in schema and item edits; tests added.
- R-02 accepted: client keeps the server alert status, restores it from the offline snapshot, and the information tab lists the last-known planning alerts with the sync time.
- R-03 accepted: scene import failure dismisses the loader, hides the canvas and shows all chapter cards.
- R-04 accepted: journey pages fetch the trip data, show the last-sync footer and an offline notice when served from cache.
- R-05 accepted: bounded incremental body reading; test streams an oversized body without Content-Length and checks reading stops early.
- R-06 accepted: DEPLOY.md and PLAN.md section 7 now do authenticated manual checks on production (OAuth callback is bound to one URL); recorded as a plan change.
- Additional fix found while verifying R-04 offline: after a new deploy, assets loaded before the new service worker took control were not cached, so the next offline visit had no JavaScript. Pages now send their loaded assets and data URLs to the worker ("warm"), and a newly activated worker asks open pages to re-send them. Verified: deploy → one online visit → server stopped → page and tabs work offline with the notice.
- Proof after fixes: lint, typecheck, 77 tests, build — all exit 0.

## Inspection 2 — fresh Codex session (MAX_INSPECTION_ROUNDS reached)
- Result: /private/tmp/claude-501/-Users-tanghuakui-Downloads-claude-Aya------/658c8c6d-5439-4fec-9bcf-1d7cb7e5eb37/scratchpad/cx/inspect-2/claudex-*/result.json (snapshot 61ec80b); effective_model gpt-6-luna.
- Verdict: REVISE. Inspection-1 fixes not repeated as findings. New: F-01 (medium) same-key package contexts with different drivers hid a driver conflict; F-02 (medium) missing food estimate for a segment gave NaN totals; F-03 (medium) driver-name masking was case-sensitive; F-04 (low) visitor key unstable without localStorage.

### Fix round 2 (Claude) — dispositions
- F-01 accepted: schema rejects inconsistent same-key contexts on a day; effectiveDay collects driver requirements before de-duplication.
- F-02 accepted: schema requires a food estimate for every segment used by a day.
- F-03 accepted: masking matches names case-insensitively including full-width letters, without rewriting other text; the guard compares NFKC-lowercased text.
- F-04 accepted: in-memory fallback keeps one voter key per page session.
- Proof after fixes: lint, typecheck, 80 tests, build — all exit 0.

### Final status
- Inspection budget (2) is used up. The fix-round-2 edits above have NOT been independently inspected; they are covered only by the host's tests.
- Authorship: all code written by Claude (this session). Codex reviewed the plan (9 rounds) and inspected the code twice (snapshots e95117d and 61ec80b).
- Not verified: owner pages with real GitHub login, Neon in production, Vercel deployment (owner steps in docs/DEPLOY.md).
