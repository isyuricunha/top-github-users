# Bug Report: isyuricunha/top-github-users

Audit of all bugs and errors found on 2026-11-02 while investigating why the
site stopped updating. Every finding below was demonstrated with an executed
command, a workflow run, or a failing/recovering test before being listed.
Root causes are marked with their epistemic grade: `confirmed` means
reproduced or observed directly; `hypothesis` means the best available
explanation with evidence, not proven.

Status snapshot: BUG-001, BUG-002, BUG-003, BUG-006 and BUG-007 to BUG-016
are fixed (fix commits listed per bug). BUG-004 and BUG-005 remain open with
external causes (GitHub-side 5xx; scheduler drops), mitigated and accepted.
Every sweep finding (BUG-007 to BUG-015) was independently re-probed by the
auditor before being accepted: each claim cites its own executed probe, not
the sweep's self-report. The 2026-11-02 fixes were authorized by the owner
after the report, and both fix series (87ee513 and 9ed707d..f7d7830) passed
independent review with verdict SOUND and no substantive findings.

## BUG-001: Round-robin cursor freezes on the first failing country

- **Status:** FIXED in 87b3197 (merge of PR #11)
- **Severity:** high
- **Description:** The hourly batch advanced the rotation cursor only to the
  first failed country. Australia sat at index 7 of 138 and failed every run
  with GitHub 5xx, so `checkpoint` stayed 7 forever and only the five
  countries after it (austria..belarus) were ever refreshed; 126 of 138
  country snapshots went 8 to 12 months stale.
- **Reproduction:**
  1. `git log --format='%h' -25 -- data/meta.json` and read `checkpoint` from
     each revision: it is `7` in 22 consecutive commits from 2026-10-28T08:49Z
     to 2026-11-02T02:51Z while runs kept collecting the same five countries.
  2. Logs of runs 41378019713 and 41382179547 end with the old message
     "1 of 6 country collections failed; the rotation restarts at the first
     failed country" and re-collect austria..belarus every time.
- **Root cause:** confirmed: the old `checkpointAfterBatch` computed
  `(start + firstFailureIndex) % locationCount`, and `firstFailureIndex` was 0
  whenever the country at the batch head failed, pinning the cursor. The fix
  replaces it with `planBatch`, which advances the cursor by the number of
  fresh countries taken from the rotation and requeues failed countries
  (bounded to 1 retry per run, deduped, capped, orphan-pruned).
- **Evidence:** bugs/evidence/BUG-001-checkpoint-trajectory.txt,
  bugs/evidence/BUG-001-rotation-logs.txt
- **Post-fix proof:** checkpoints 13 -> 18 -> 23 on 2026-11-02 with failures
  present, and run logs now read "failed countries are requeued for retry and
  the rotation advances by 5".

## BUG-002: Empty 200 body crashes the collector without retry

- **Status:** FIXED in 87ee513 (merge of PR #12)
- **Severity:** high
- **Description:** GitHub occasionally answers a GraphQL request with HTTP 200
  and an empty body under load. `GraphQLClient.query` called
  `response.json()` unguarded, so JSON parsing threw an unhandled
  `SyntaxError: Unexpected end of JSON input` that killed the whole
  collection process: no retries, no data commit, no deploy.
- **Reproduction:**
  1. Instrumented worktree probe on 2026-11-02 (~14:35 UTC):
     `node pipeline/src/cli.ts collect --country australia --dry-run` with a
     real token crashed after ~101s with `SyntaxError` raised from
     `response.json()` inside the `response.ok` branch; the process exited
     without retrying.
  2. Unit-level proof after the fix: `new Response('', { status: 200 })` fed
     through `fetchImpl`; the old code throws, the new code retries and
     succeeds (tests named below).
- **Root cause:** confirmed: the retry loop handled network errors, 5xx and
  GraphQL errors, but not JSON parsing failures on a 200 response.
- **Evidence:** bugs/evidence/BUG-002-prefix-crash-run-41458465272.txt,
  bugs/evidence/BUG-002-regression-tests.txt
- **Fix:** `pipeline/src/graphql.ts` wraps the JSON parse in try/catch
  (lines 72-95): an empty or invalid body now consumes the same attempt
  budget as a 5xx (exponential backoff) and exhaustion raises
  `ApiError("GitHub API <status> with an empty or invalid JSON body after N
  attempts")`. Regression tests:
  `pipeline/tests/collector.test.ts` lines 236-275
  ("retries an ok response with an empty body and succeeds", "counts an empty
  body against the same attempt budget as 5xx", "fails with ApiError when
  every response has an empty body"). Independent review of the fix commit:
  verdict SOUND, no substantive findings; the reviewer re-ran the three
  scenarios against the pre-fix code and confirmed each test fails there
  with the reported SyntaxError.

## BUG-003: Single-country collection path does not catch per-country failures

- **Status:** FIXED in 87ee513 (merge of PR #12)
- **Severity:** medium
- **Description:** The `--country <slug>` branch of `pipeline/src/cli.ts`
  called `collectOne()` without a try/catch. One country's `ApiError`
  (expected for BUG-004 countries) escaped, crashed the job with a stack
  trace, and skipped the requeue maintenance entirely.
- **Reproduction:** dry-run dispatch of `country=australia` on 2026-11-02
  (run 41458465272): the collect step exited 1 with an uncaught
  `ApiError: GitHub API 502 after 5 attempts` and no requeue update.
- **Root cause:** confirmed: asymmetric error handling between the batch
  path (try/catch per country, requeue maintenance) and the single-country
  path (bare await).
- **Evidence:** bugs/evidence/BUG-003-single-country-crash-run-41458465272.txt,
  bugs/evidence/BUG-003-postfix-clean-failure-run-41460811020.txt (post-fix
  dry-run on the same scenario fails cleanly with the batch-style log line
  and exit 1, no unhandled exception; the 44/44 regression suite passed in
  the same run)
- **Fix:** `pipeline/src/cli.ts` lines 91-105: the failure is caught, logged
  as `failed <slug>: <error>` (same format as the batch path at line 130),
  the country is added to `meta.requeue` with the same valid-country pruning
  and `MAX_REQUEUE` cap, meta is written, and the process exits 1 so the
  workflow still fails visibly. Dry-run adds nothing and exits 1. Independent
  review of the fix commit: verdict SOUND; exit-code semantics confirmed
  consistent with the batch all-fail contract (meta written before exit, so
  no lost writes).

## BUG-004: Chronic GitHub 5xx on UserContributions for australia

- **Status:** OPEN (external cause; mitigated by the requeue)
- **Severity:** medium
- **Description:** Every collection attempt for australia fails with
  `GitHub API 502/504 after 5 attempts`. `data/current/australia.json` has
  only ever been touched by the v2 seed commit (82d8a37, 2026-10-25), so the
  pipeline has never collected it. Belgium shows the same failure once
  (2026-11-02T05:12Z, run 41392044832) and also has seed-only data; with a
  single observed failure it is not proven chronic.
- **Reproduction:**
  1. Any scheduled or dispatched run that includes australia in the batch
     (for example run 41433587915 at 2026-11-02T11:02Z) logs
     "failed australia: ApiError: GitHub API 502 after 5 attempts".
  2. Dry-run dispatch of only australia fails the same way (run
     41458465272, conclusion failure at 14:10Z), and again after the
     BUG-002/BUG-003 fixes on code 87ee513 (run 41460811020, failure at
     14:23:45Z on 2026-11-02), confirming the 5xx is external and still
     happening.
  3. Instrumented local probe: the failing query is labeled
     `[UserContributions]`; no `[SearchUsers]` retry lines appear.
- **Root cause:** hypothesis (unconfirmed): GitHub server-side cost or
  gateway timeouts when computing `contributionsCollection` for australia's
  user set under load. Supporting evidence: the search phase succeeds
  locally (200, userCount 184909), the same 10-user contribution batch
  returns 200 in 5/5 consecutive local calls minutes later, brazil (10
  cities, search total 456183) collects fine on runners, and failures are
  sparse per batch (two batches recovered on retry, one exhausted). Nothing
  in this repository determines the 502; it originates at GitHub.
- **Evidence:** bugs/evidence/BUG-004-usercontributions-5xx.txt
- **Mitigation in place:** the rotation requeues australia every run and
  retries it hourly (bounded to 1 retry per run), so it will be collected
  as soon as GitHub stops returning 5xx for it. Possible future hardening
  (not authorized yet): smaller contribution batches or a smaller user cap
  for requeued heavy countries.

## BUG-005: GitHub scheduler drops hourly cron runs

- **Status:** OPEN (platform behavior; pace accepted by the owner)
- **Severity:** medium
- **Description:** The workflow cron is `17 * * * *` (hourly), but only 9
  scheduled runs occurred in a 48h window (2026-10-31T14:00Z to
  2026-11-02T14:00Z), with intervals of 3.4 to 8.6 hours. The pattern
  predates all fixes in this report (gaps are visible since 2026-10-29).
- **Reproduction:**
  `gh api repos/isyuricunha/top-github-users/actions/runs?event=schedule`
  shows the created_at list; 48 hourly slots, 9 fired. No queued or
  cancelled schedule runs exist: the scheduler simply does not create them.
- **Root cause:** confirmed by GitHub's documentation: "The schedule
  event can be delayed during periods of high loads of GitHub Actions
  workflow runs. High load times include the start of every hour. If the
  load is sufficiently high enough, some queued jobs may be dropped. To
  decrease the chance of delay, schedule your workflow to run at a
  different time of the hour." (docs.github.com, Events that trigger
  workflows, fetched 2026-11-02). The cron already sits at minute 17 and
  still loses roughly 80% of slots, so the documented mitigation is
  insufficient on its own.
- **Evidence:** bugs/evidence/BUG-005-schedule-slots-48h.txt
- **Impact:** the stale-country backfill advances about 5 countries per
  fired run, so full coverage of the remaining ~112 countries takes
  roughly 2 to 3 days instead of 1. Accepted by the owner on 2026-11-02.
  Deterministic alternative if ever wanted: an external hourly
  `workflow_dispatch` (dispatches are not subject to the schedule queue
  drops).

## BUG-006: Two Pages deploy paths raced (400 "in progress deployment")

- **Status:** RESOLVED (Pages source change to GitHub Actions by the owner
  on 2026-11-02, plus push-trigger removal in 3ff7486)
- **Severity:** medium
- **Description:** Two deploy paths existed: the workflow's own
  build+deploy-pages jobs and GitHub's auto-generated
  `pages-build-deployment` (dynamic/pages/pages-build-deployment). Both
  raced on every data commit push, producing HTTP 400 "in progress
  deployment" failures and stalling site updates even when the repo data
  was fresh.
- **Reproduction:** historical: GitHub run list shows
  `pages build and deployment` runs interleaved with `Rankings` runs on
  2026-10-30/31 and 2026-11-01, several with `failure` conclusion; the
  failing deployments carry the in-progress-deployment 400.
- **Root cause:** confirmed: duplicate deploy paths, two of them: (a) the
  Pages branch source kept a second (Jekyll) pipeline alive that raced the
  custom workflow and could overwrite the site with the branch contents;
  (b) the workflow's own data commits pushed to main, and the workflow's
  push trigger re-ran the whole pipeline for an artifact the committing run
  had already deployed.
- **Evidence:** bugs/evidence/BUG-006-pages-single-path.txt (zero
  "in progress deployment" matches in all 2026-11-02 run logs; zero
  pages-build-deployment runs after 02:32:38Z; live site JSON timestamps
  match the collect log lines exactly, proving the single-path chain
  collect -> commit -> build -> deploy -> CDN).
- **Fix:** Pages source set to GitHub Actions (owner change), and the
  `push: branches: [main]` trigger removed from
  `.github/workflows/rankings.yml` (3ff7486) with the invariant documented
  in docs/ARCHITECTURE.md (Operations).

## BUG-007: One corrupt history line wipes the country's whole history file

- **Status:** FIXED in 9ed707d (PR #13)
- **Severity:** medium
- **Description:** `readHistory` (`pipeline/src/writers.ts:40-52`) parses the
  whole JSONL file inside one try/catch. A single malformed line makes it
  return `[]`, and the next `appendHistory` (writers.ts:56-72) then rewrites
  the file with only the new entry, permanently destroying the country's
  entire collected history (the per-date timeline the site renders) with no
  warning.
- **Reproduction:** probe `/tmp/probe-verify-sweep.mjs` against a temp root
  with a history file of 3 valid lines plus 1 truncated line:
  `readHistory` returned 0 entries; after `appendHistory` the file has 1
  line (`2026-11-03`); data loss = 3 lines.
- **Root cause:** confirmed: the try/catch wraps both "file missing" (should
  return empty) and "any line malformed" (should skip the bad line), so one
  bad line erases the rest.
- **Evidence:** bugs/evidence/BUG-007-corrupt-history-line-wipes-file.txt
- **Suggested fix:** per-line try/catch that skips malformed lines (and
  warns), returning `[]` only when the file itself is missing.

## BUG-008: Batch under-fill pins the cursor and the all-fail exit never fires

- **Status:** FIXED in ca835e5 (PR #13)
- **Severity:** low
- **Description:** If `locations.length < count`, `planBatch`
  (`pipeline/src/checkpoint.ts:47-55`) stops after one full rotation and
  returns a batch smaller than `count`; the next run starts from the returned
  `nextCheckpoint` and produces the identical batch, so the rotation stalls
  on the same countries forever. In `pipeline/src/cli.ts:156` the all-fail
  check `failures === countArg` can then never be true, so a run where every
  country failed exits 0 and the workflow still commits and deploys.
- **Reproduction:** probe with 5 locations and `count=6`: run 1 from
  checkpoint 0 returns fresh a..e with `nextCheckpoint=0`; run 2 returns the
  identical batch; `failures=5 === countArg=6` is false, so exit 1 never
  fires.
- **Root cause:** confirmed: the fill loop's guard stops after one full
  rotation without handling `n < count`, and the exit check compares against
  `countArg` instead of `attempted.length`.
- **Evidence:** bugs/evidence/BUG-008-underfill-pins-cursor-allfail-exits0.txt
- **Suggested fix:** assert or clamp `n >= count` in `planBatch` (or warn on
  under-fill) and compare `failures === attempted.length` in the CLI.

## BUG-009: Negative checkpoint in meta crashes every subsequent run

- **Status:** FIXED in ca835e5 (PR #13)
- **Severity:** low
- **Description:** `readMeta` preserves a negative `checkpoint`, and
  `planBatch` (`pipeline/src/checkpoint.ts:47-53`) computes
  `cursor = checkpoint % n`, which stays negative in JavaScript for negative
  inputs, so `locations[cursor]` is `undefined` and the run crashes with
  `TypeError: Cannot read properties of undefined (reading 'country')` at
  checkpoint.ts:53 before any write. Every subsequent run crashes the same
  way until meta is repaired by hand.
- **Reproduction:** probe: `planBatch([], -3, 6, config.locations, 1)` on the
  real 138-location config raises exactly that TypeError at
  checkpoint.ts:53:33.
- **Root cause:** confirmed: no normalization of negative cursors
  (`((checkpoint % n) + n) % n` would self-heal).
- **Evidence:** bugs/evidence/BUG-009-negative-checkpoint-crashes-planbatch.txt
- **Suggested fix:** normalize the cursor modulo `n` in `planBatch` (or clamp
  invalid values in `readMeta`).

## BUG-010: GraphQL 200 with errors and no data key resolves undefined

- **Status:** FIXED in ca835e5 (PR #13)
- **Severity:** low
- **Description:** The client guard is `body.data === null`
  (`pipeline/src/graphql.ts`, response.ok branch). A 200 response shaped
  `{"errors":[{"message":"..."}]}` without a `data` key (or an empty object)
  passes the guard, logs only a partial-errors warning, and resolves to
  `undefined`. Downstream field access (for example
  `data.search.userCount` in collector.ts) then fails with an unrelated
  TypeError attributed to the country instead of a clean ApiError.
- **Reproduction:** probe with a fake `fetchImpl` returning
  `200 {"errors":[{"message":"boom"}]}` (no data key):
  `client.query(...)` resolved to `undefined`; with `200 {"data":null,...}`
  the same client correctly throws `ApiError: GraphQL errors: ...`.
- **Root cause:** confirmed for the mocked shape: the guard checks only
  `=== null`, not the key's presence. Whether GitHub ever sends this shape is
  unverified (no live probe with a valid token was made for this shape).
- **Evidence:** bugs/evidence/BUG-010-200-errors-without-data-key-returns-undefined.txt
- **Suggested fix:** treat a missing `data` key (`!('data' in body)` or
  `body.data == null`) as a hard error once attempts are exhausted.

## BUG-011: Whitespace-containing location terms are dead on GitHub search

- **Status:** FIXED in 8564f08 (PR #13)
- **Severity:** medium
- **Description:** `normalizeLocationTerm`
  (`pipeline/src/collector.ts:8-10`) replaces whitespace with underscore, and
  `buildSearchQuery` emits `location:<term>` unquoted. GitHub search does not
  match underscores to spaces: `location:united_states` returns 1 result
  while `location:"united states"` returns 295954. The 15 config countries
  with whitespace names plus brazil's `rio grande do norte` city term
  contribute effectively nothing to their queries. Hyphenated terms are fine
  (proven: `location:san-francisco` = `location:"san francisco"` = 88541, and
  the config's other 91 multi-word city terms are hyphenated and work), so
  affected countries still collect users through their city terms, but
  country-only locators are lost and the logged search totals are wrong.
- **Reproduction:** anonymous REST probes
  (`api.github.com/search/users`): `united_states` 1 vs `"united states"`
  295954; `hong_kong` 6 vs `"hong kong"` 27898; control
  `san-francisco` 88541 = `"san francisco"` 88541.
- **Root cause:** confirmed: underscore normalization is applied to the
  search term, and GitHub's search tokenizer does not map `_` to whitespace.
- **Evidence:** bugs/evidence/BUG-011-multiword-terms-dead-in-search.txt
- **Suggested fix:** in the query builder only (file slugs keep the
  underscore), replace `\s+` with `-` (proven equivalent to quoting) or
  quote multi-word phrases. Do not change `slugify`.

## BUG-012: bahrain config lists nassau, polluting the live ranking

- **Status:** FIXED in 8564f08 (PR #13); live bahrain data refreshes on the next bahrain collection
- **Severity:** medium
- **Description:** `config.json` bahrain cities are `['nassau', 'riffa',
  'muharraq']`; the capital is Manama and Nassau is in the Bahamas/New York.
  The live snapshot
  `data/bahrain.json` (collected 2026-11-02T02:44:42Z) contains 48 of 500
  users whose location mentions nassau but not bahrain ("Nassau, Bahamas",
  "Nassau County, NY").
- **Reproduction:** read the live JSON and count users with nassau and
  without bahrain: 48. Search counts: `location:nassau` 166 users worldwide,
  `location:manama` 215.
- **Root cause:** confirmed: a wrong city term in config feeds the user
  search directly.
- **Evidence:** bugs/evidence/BUG-012-bahrain-nassau-pollution.txt
- **Suggested fix:** replace `nassau` with `manama` in config.json (also
  worth a config-wide review of city terms against their countries).

## BUG-013: Duplicate city entries in config

- **Status:** FIXED in 8564f08 (PR #13)
- **Severity:** low
- **Description:** bhutan lists `phuntsholing` twice, ethiopia lists
  `dire-dawa` twice, germany lists `hamburg` twice. Duplicate search terms
  are sent every run; the snapshot `cities` array and the site's cityTerms
  stat count duplicates (the country page display dedupes in
  `site/src/pages/[slug].astro:36-38`).
- **Reproduction:** probe over config.json printing first-duplicate per
  location: the three entries above.
- **Root cause:** confirmed: config data entry duplication.
- **Evidence:** bugs/evidence/BUG-013-duplicate-city-entries.txt
- **Suggested fix:** dedupe the three city arrays.

## BUG-014: Missing snapshot silently drops a country from the built site

- **Status:** FIXED in f7d7830 (PR #13)
- **Severity:** low
- **Description:** `listSlugs` (`site/src/lib/data.ts`) derives routes only
  from the files in `data/current`; config.json is never read at build, and
  `copy-data.mjs` only fails when the directory has zero files. A single
  missing snapshot builds successfully and the country disappears from the
  published site with no warning.
- **Reproduction:** clean copy of HEAD, removed `data/current/bahrain.json`,
  `pnpm site:build`: exit 0, "Complete!", 140 pages (141 with the file),
  `dist/bahrain/index.html` and `dist/data/bahrain.json` absent.
- **Root cause:** confirmed: no cross-check between config locations and
  snapshot files at build time.
- **Evidence:** bugs/evidence/BUG-014-missing-snapshot-silently-dropped.txt
- **Suggested fix:** assert the snapshot count (or slugs) matches
  config.json during the site build and fail loudly on mismatch.

## BUG-015: san marino city term marino matches non-residents

- **Status:** FIXED in 8564f08 (PR #13)
- **Severity:** low
- **Description:** `config.json` san marino cities are `['marino']`; the
  token `marino` also matches the Italian town Marino (Lazio) and unrelated
  profiles. `location:marino -location:"san marino"` returns 12 users, so up
  to ~12 non-resident accounts can enter san marino's top-500 by followers
  when first collected. Mostly latent today because "san marino" contains
  "marino" and the country term is dead (BUG-011).
- **Reproduction:** anonymous search probe: 12 users match
  `location:marino -location:"san marino"`.
- **Root cause:** confirmed: ambiguous city term for a microstate whose
  capital shares its name with a larger foreign town.
- **Evidence:** bugs/evidence/BUG-015-marino-city-term-matches-foreigners.txt
- **Suggested fix:** use `san-marino` as the city term once BUG-011 is fixed,
  or drop the city entry.


## BUG-016: Chronically failing requeue head starves the countries behind it

- **Status:** FIXED in ca835e5 (PR #13)
- **Severity:** medium
- **Description:** `planBatch` picks retry candidates from the requeue in
  insertion order and stops at `maxRetries` (1 per run). With australia
  failing every run at the head of the queue, the countries behind it
  (belgium, then any newly failed country) were never retried: the queue
  order never rotated. Observed live: run 41433587915 had belgium in the
  requeue and retried only australia.
- **Reproduction:** code reading of the retry selection loop
  (checkpoint.ts:36-44: `for (const slug of requeue) { if (retries.length >=
  maxRetries) break; ... }` with a fixed insertion order) plus the run log
  above; starvation follows deterministically while the head keeps failing.
- **Root cause:** confirmed: the requeue behaves as a fixed-order FIFO with
  no rotation of failed attempts.
- **Evidence:** bugs/evidence/BUG-004-usercontributions-5xx.txt (run log),
  bugs/evidence/BUG-007-to-016-postfix-verification.txt
- **Fix:** on failure the country is deleted and re-added to the requeue
  (pipeline/src/cli.ts requeue maintenance), moving it to the back, so each
  run retries the oldest failed country and the queue rotates fairly.


## Discarded hypotheses (tested and rejected)

- "Heavier country fails more" (city count / search size): rejected.
  Brazil has 10 cities and a 456183-user search total and collects fine;
  australia has 9 cities and fails every time.
- "The australia search query 502s": rejected. The exact pipeline search
  query returned 200 with userCount 184909 locally.
- "The contribution batch is intrinsically too heavy": rejected. The same
  10-user batch returned 200 in 5/5 consecutive local calls; failures are
  sparse and load-dependent.
- "Audit slot analysis shows paired firing": that was a probe artifact
  (a +-60 minute matching window double-counted delayed runs). Corrected to
  nearest-slot matching: 9 real runs in 48h.
- Sweep re-probes that did NOT reproduce (2026-11-02, probes in
  /tmp/probe-verify-sweep.mjs and the sweep subagent's own scripts): cursor
  wrap at 138 and checkpoints beyond length; planBatch with 0 locations
  (loadConfig rejects empty); requeue dedupe/cap/stale-slug handling;
  double-collection; meta migration for legacy/invalid/missing files
  (writeMeta does mkdir; an ENOENT suspicion was disproven); GraphQL retry
  accounting off-by-one after the BUG-002 fix (exactly 5 attempts, 4 sleeps,
  correct backoff and retry-after handling); collector batch arithmetic
  (500 users, 50 batches, cap boundary, userCount 0, hasNextPage false,
  cross-page dedupe); UTC-only timestamps end to end; CLI parsing of
  negative/NaN/overflow `--countries` values.

## Observations (arithmetic, not reproduced)

- Chronic-failure cost per country is about 5.5 minutes (dry-run australia
  2026-11-02: collect started 14:04:41Z, failed 14:10:14Z). The collect job
  timeout is 30 minutes (rankings.yml:31), so a batch where roughly 6
  countries all failed chronically (~33 min) would be killed before
  `writeMeta`, losing that run's requeue update. Today only australia (and
  belgium once) fail chronically, so the realistic worst case is far below
  the limit. Recorded as a watch item, not a bug.
- `lastCollectedAt` is written once per batch (cli.ts:134-138), so the first
  country collected in a run gets a timestamp a few minutes after its actual
  collection. Cosmetic; all timestamps are UTC.

## Out of scope (not investigated)

- Consistency of `data/history/*.jsonl` snapshots.
- GitLab/YuGit mirror synchronization for this repository.
- Behavior of the requeue cap beyond `MAX_REQUEUE = 200` scenarios.
