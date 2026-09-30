# Automation — data pipeline ops guide

This folder is the single source of truth for how `public/data/live.json` gets
filled in every day. It replaces the four separate runbooks that used to live
under `docs/` (`AGENT-AUTO.md`, `FULL-AUTO-SETUP.md`, `PROMPT-GROK-DAILY.md`,
`FIX-PAGES-404.md`) — the content below is their consolidated, updated version.

## Two pipelines, one clear role split

| | **GitHub Actions** (`.github/workflows/data-update.yml`) | **Local agent** (`run_agent_daily.ps1`) |
|--|--|--|
| Role | **Primary — system of record** | Manual / backup only |
| Runs where | GitHub cloud, on a schedule | Your PC, via Windows Task Scheduler |
| Writes to `main` | **Directly** (auto-commit) | **Never** — pushes a branch and opens a PR |
| Agent | Anthropic Messages API (`ANTHROPIC_API_KEY` secret, paid) | Local Claude Code CLI (`ANTHROPIC_API_KEY`, paid per-token — see below) |
| When to use | Always on, no setup after secrets are added | Run manually when Actions data looks stale, or as an extra source for margin/breadth/yields fields the free APIs can't supply |

This split exists because both scripts used to push straight to `main` and
would occasionally race each other (see `git log` history mixing "data: daily
market snapshot (auto)" and "data: agent daily market snapshot" commits). The
local agent no longer pushes directly — it commits to `agent/data-YYYY-MM-DD`
and opens a pull request (via `gh pr create` if the GitHub CLI is installed,
otherwise it prints a compare URL) so a bad or stale local run can't silently
overwrite the Actions pipeline.

## What `daily_update.py` does

`automation/daily_update.py` (stdlib-only Python 3, no dependencies to install):

1. **Free, no-key sources (always run):**
   - US Treasury daily yield curve (CSV)
   - VN-Index price via Yahoo Finance (`^VNINDEX.VN`, falls back to other symbols)
   - DXY (US Dollar Index) via Yahoo Finance
   - CNN Fear & Greed Index
2. **Optional LLM fill (Anthropic)** — only if `ANTHROPIC_API_KEY` is set — for fields the
   free sources can't provide: `margin`, `vnYields`, `breadth`, `usdVnd`, `foreign`,
   `proprietary` (tự doanh net flow — consumed by the Cashout page's own
   pipeline, see `automation/vn_cashout/README.md`).
3. **Merge `public/data/grok-fill.json`** — a human- or agent-edited file (see
   below) — into whatever the API calls produced.
4. **Writes `public/data/live.json`** (the file the React app fetches at
   runtime) and `public/data/last-run.json` (a small ok/asof/quality summary).

Run it locally:

```powershell
cd "C:\Users\shimo\OneDrive\ドキュメント\Private\Stock\vn-market-site"
py automation/daily_update.py            # free APIs + LLM fill if ANTHROPIC_API_KEY is set
py automation/daily_update.py --no-grok  # free APIs only, skip the xAI API call
py automation/apply_grok_fill.py         # merge public/data/grok-fill.json only, no network fetch
```

## Merge policy (why a field says "live" vs "proxy")

| Field | If the free API already marked it `live` | Otherwise |
|--|--|--|
| `usYields`, `vnIndex`, `dxy`, `fgUs` | **Never overwritten** by Grok | Grok fills it in, `quality=proxy` |
| `margin`, `vnYields`, `breadth`, `usdVnd`, `foreign`, `proprietary` | *(no free API exists for these)* | Grok fills it in, `quality=proxy` |

The dashboard UI reflects this directly — panels are labeled **Mẫu** (sample) /
**Proxy** / **Nội suy** (interpolated) so numbers are never presented as an
official live feed.

## Filling in `grok-fill.json` by hand

When you don't want to run the local agent, you can paste a prompt into any
Grok/LLM chat session and save the JSON it returns to `public/data/grok-fill.json`:

1. Ask for the latest HOSE session's VN-Index, breadth, margin debt, USD/VND
   central rate, VN government bond yields, and foreign net buy/sell — sourced,
   not invented — matching the schema in `public/data/grok-fill.example.json`.
   Require `quality` values of `proxy|live|stale|missing` only, and instruct it
   not to overwrite fields already `live` from the API context.
2. Save the returned JSON as `public/data/grok-fill.json`.
3. Run `py automation/daily_update.py` (merges it with fresh API data) or
   `py automation/apply_grok_fill.py` (merge-only, no network calls).
4. Commit and push (or let the local agent script do steps 3–4 via a PR).

## Local agent setup (Windows Task Scheduler)

**Local agent = Claude Code CLI**, run headlessly (`claude -p --bare`). This bills
per-token against a **Console API key**, not a Pro/Max/Team subscription —
subscription login is interactive-only and headless/`--bare` mode explicitly
doesn't use it. Get a key at https://console.anthropic.com/ and set it as the
`ANTHROPIC_API_KEY` environment variable (System Properties → Environment
Variables, so Task Scheduler picks it up — a variable set only in one PowerShell
session won't be visible to the scheduled task).

Prerequisites: `claude` CLI installed (`winget install Anthropic.ClaudeCode`),
`ANTHROPIC_API_KEY` set, `git` credentials configured, Python on PATH, optionally
`gh` (GitHub CLI) authenticated for auto-PR creation.

The agent runs scoped, not with full bypass: `--permission-mode acceptEdits`
plus an explicit `--allowedTools "WebSearch,WebFetch,Read,Write"` — deliberately
not `--dangerously-skip-permissions`/`bypassPermissions`, which would let it run
anything unattended. Without `ANTHROPIC_API_KEY` set, the script logs a warning
and skips straight to the free-API-only path — it never hard-fails the whole run.

**Known gap, confirmed by real testing, not yet resolved: `WebSearch`/`WebFetch`
don't actually work through this headless setup.** `--bare` mode's documented
toolset is Bash/Read/Edit only — `--allowedTools` pre-approves a tool if it's
offered, it doesn't add tools outside that set. Dropping `--bare` didn't fix it
either: a follow-up test asked Claude to fetch a live price it couldn't possibly
know from training data, and it replied with a specific, plausible, **fabricated**
number prefaced with "Based on the web search..." while the actual tool-use log
showed zero real `WebSearch`/`WebFetch` calls (`web_search_requests: 0`). This is
exactly the failure mode `automation/agent_daily_prompt.md` now explicitly warns
against — the real end-to-end run (see `automation/agent-daily.log`,
2026-08-09) behaved safely: it correctly noticed it had no working network tools
and left `grok-fill.json` untouched instead of guessing, but that's a much weaker
guarantee than the tool genuinely not being called at all. **Until this is root-
caused (possibly an account/plan-tier gate on server-side tool use in headless
`-p` mode — not something a CLI flag fixes), treat the local Claude agent as a
safety net that won't overwrite good data with guesses, not as a working research
replacement for the old Grok CLI flow.** For a market day where fresh proxy data
is actually needed, use the manual copy-paste flow into a regular Claude/Grok chat
session instead (interactive chat sessions do have working web search) — see
"Filling in `grok-fill.json` by hand" above.

```powershell
powershell -ExecutionPolicy Bypass -File automation\run_agent_daily.ps1
```

Then create two Task Scheduler triggers for 08:20 and 16:10 **ICT** — but set the
trigger times in **your machine's local clock**, not ICT, if they differ. This dev
machine's clock is set to Tokyo time (JST, UTC+9), two hours ahead of ICT (UTC+7),
so the actual Task Scheduler trigger times here are **10:20** and **18:10** local.
Check your own machine with `Get-TimeZone` before creating triggers — a task
created with the ICT numbers typed in literally on a non-ICT machine will silently
fire at the wrong time (this happened once already: the original task's morning
trigger was off by 5h20m and nobody noticed until the data just looked stale).

| Field | Value |
|-------|-------|
| Program | `powershell.exe` |
| Arguments | `-ExecutionPolicy Bypass -File "C:\Users\shimo\OneDrive\ドキュメント\Private\Stock\vn-market-site\automation\run_agent_daily.ps1"` |
| Start in | `C:\Users\shimo\OneDrive\ドキュメント\Private\Stock\vn-market-site` |

The live task on this machine is named **`VN Market Agent Daily`**. Sanity-check it
after any path change (moving the repo, renaming `scripts/`→`automation/`, etc. has
broken it before) with:

```powershell
Get-ScheduledTask -TaskName "VN Market Agent Daily" | Get-ScheduledTaskInfo
(Get-ScheduledTask -TaskName "VN Market Agent Daily").Actions | Format-List Execute, Arguments, WorkingDirectory
```

If the `Arguments`/`WorkingDirectory` don't point at the current repo path, or
`LastTaskResult` isn't `0`, fix it with `Set-ScheduledTask` (needs to be run from an
elevated/interactive PowerShell session that owns the task — an automated session
without that context will get `Access is denied` even just trying to disable or
delete it, not only edit it).

The script logs to `automation/agent-daily.log` (gitignored) and the last agent
run's output to `automation/agent-last-run.txt` (also gitignored, and written as
UTF-8 — earlier versions wrote UTF-16 via `Tee-Object`'s default encoding, which
made the log unreadable as plain text).

## Enabling the GitHub Actions xAI fill (optional)

1. Get an API key at https://console.x.ai/.
2. Repo → **Settings → Secrets and variables → Actions** → New repository
   secret → `ANTHROPIC_API_KEY`. Optionally add a repo variable `ANTHROPIC_MODEL`
   (default `grok-3-latest`).
3. **Settings → Actions → General → Workflow permissions** → **Read and write**.
4. **Actions → Daily market data update → Run workflow** to test.

Without a key, the Actions pipeline still auto-updates US yields, VN-Index,
DXY, and US Fear & Greed — everything else stays at its last known value
(sample/proxy) until filled via the local agent or a manual `grok-fill.json`.

## Historical data & event correlation ("Lịch sử & Tương quan" page)

Every `daily_update.py` run also appends (upserts, by date — safe to run twice a
day) a compact row to `public/data/history/<year>.jsonl` via `append_history()`.
This is the real time series the History page charts — it replaces the old
approach where every "history" chart on the dashboard was actually a seeded
PRNG fabricating a plausible-looking past around the latest real data point.

**Row schema** (one JSON object per line):

```json
{"date":"2026-08-07","vnIndex":1768.06,"vnIndexPct":0.19,"dxy":99.6,
 "usYields":{"1":4.11,"3":4.24,"5":4.33,"10":4.65,"30":5.17},
 "vnYields":{"10":4.54},"fgUs":63.7,"fgVn":null,
 "margin":446000,"marginNet":null,
 "breadth":{"a":164,"d":139,"u":62,"gtgd":18141},
 "usdVndCentral":25338,"foreignNet":null,
 "quality":{"vnIndex":"live","usYields":"live","dxy":"live","margin":"proxy", "...": "..."}}
```

`public/data/history/index.json` lists which year files exist (`{"years":[2025,2026]}`)
so the frontend doesn't need a hardcoded year list that goes stale every January.

**Backfill.** `automation/backfill_history.py` populates past years from free
historical sources — but only two fields actually have one:

| Field | Backfillable for free? | Source |
|--|--|--|
| `usYields` | **Yes** — full daily series | US Treasury yield-curve CSV (per year) |
| `dxy` | **Yes** — full daily series | Yahoo Finance (`DX-Y.NYB`, `range=Ny`) |
| `vnIndex` | **No** — Yahoo's `^VNINDEX.VN` only supports `1d`/`5d` ranges server-side (confirmed via its `validRanges` field; there's no free, scriptable, ToS-respecting source for VN-Index daily history) | — |
| `vnYields`, `margin`, `breadth`, `usdVndCentral`, `foreignNet`, `fgVn` | No free historical source at any granularity | — |

Everything in the "No" rows starts accumulating for real the day this shipped,
one row per `daily_update.py` run, same as every other proxy/sample field on
this site — there's no way around that without a paid data provider.

```powershell
py automation/backfill_history.py --years 2   # re-run anytime; upserts, never duplicates
```

Also available as a manual (never scheduled) `workflow_dispatch` job:
**Actions → Backfill historical data → Run workflow**.

**Events log.** `public/data/events.json` is a flat, append-only array of
sourced events (Fed decisions, US/VN macro releases, geopolitical shocks) that
the History page overlays as markers on the chart. It is **not** pre-seeded
with a guessed future FOMC/CPI/NFP calendar — `automation/events_prompt.md` is
a research prompt (same pattern as `agent_daily_prompt.md`) for the local Claude
agent to run periodically (weekly is plenty) to research and append real,
sourced entries:

```powershell
$prompt = Get-Content automation/events_prompt.md -Raw
claude --bare -p $prompt --permission-mode acceptEdits --allowedTools "WebSearch,WebFetch,Read,Write" --model sonnet
```

This is deliberately **not** wired into the twice-daily `run_agent_daily.ps1`
run — it's a separate, lower-frequency task so it doesn't double the Claude CLI
usage (and API cost) on every scheduled run.

## News feed ("Tin kinh tế" sidebar)

The dashboard's news rail used to be a hardcoded array in `dashboardEngine.js`
— real-looking cards that never updated because there was no pipeline behind
them at all. Fixed with a two-stage pipeline that deliberately avoids the
WebSearch/WebFetch gap documented above:

1. **`daily_update.py` → `public/data/news-raw.json`** (every run, both
   GitHub Actions and local — no LLM, just RSS). Fetches free, official feeds:
   - VnEconomy (`vn-macro`): `chung-khoan.rss`, `tieu-diem.rss`
   - Federal Reserve (`fed`/`us-macro`): `press_monetary.xml`, `press_all.xml`

   Each feed has its own age/item cap (`NEWS_FEEDS` in `daily_update.py`) —
   VnEconomy publishes dozens of articles a day, the Fed publishes a handful a
   month, so a single global cutoff would let VN volume crowd out every Fed
   item. Output is deduped by title and capped, written as
   `{generatedAtIct, count, items: [{title, link, description, publishedAt,
   category, source}]}`.

2. **Local agent → `public/data/news.json`** (only when the local agent runs
   — see `agent_daily_prompt.md`'s "Task 2"). Reads `news-raw.json`, picks the
   3–6 most market-relevant items, and writes the full card format: `{date,
   time, category, impact, title, stats, bullets, vnImpact, tags, source,
   sourceUrl}`. This step needs Read/Write only — it never calls
   WebSearch/WebFetch, since the raw facts are already on disk from step 1.
   That's the whole point of splitting fetch from synthesis: it routes around
   the confirmed-broken WebSearch/WebFetch gap instead of depending on it.

3. **Local agent → `public/data/econ-actuals.json`** (`agent_daily_prompt.md`'s
   "Task 3"). Separate from `news.json` on purpose — the dashboard's "Lịch sự
   kiện kinh tế Mỹ" table (`CAL` array in `src/dashboard/dashboardEngine.js`)
   is a hand-maintained schedule of future BLS/Fed release dates; this task
   only bridges it to real numbers *after* a release happens, by checking
   whether a raw news item explicitly states the actual/forecast/previous
   figure for one of the pending dates hardcoded in the prompt (kept in sync
   by hand with `CAL` — if one changes, update the other). Same
   Read-only-no-WebSearch constraint and anti-fabrication rule as Task 2:
   only copies numbers the raw text states outright, `null` for anything it
   doesn't, and upserts by date key rather than overwriting the whole file.
   Consumed by `useEconActuals()`, merged into `CAL` at render time in
   `dashboardEngine.js`. Like `grok-fill.json`, this file may also be edited
   by hand the moment you see a real release — you don't have to wait for
   the next agent run.

`run_agent_daily.ps1` runs `daily_update.py --no-grok` **twice** — once
*before* the agent (so `news-raw.json` is fresh for it to read) and once
*after* (to merge whatever `grok-fill.json` the agent just wrote). `news.json`
is only ever produced by the local agent, so it's committed via the PR flow,
not the GitHub Actions auto-commit — the frontend (`useNews()` hook) shows an
honest "chưa có tin" placeholder rather than stale/fake content if it's
missing, and a small "Agent tổng hợp lúc ..." timestamp (from
`generatedAtIct`) so it's clear how fresh the curated cards are, independent
of how fresh the raw feed underneath them is.

## Third pipeline: `vn-vnstock-update.yml` (sector flows + cashout + regime)

`public/data/sector-flows.json` (Dòng tiền ngành) and `public/data/cashout-vn.json`
(Dòng tiền & Cashout) both need `vnstock` (+`pandas`) — a real dependency,
unlike `daily_update.py`'s stdlib-only design — so they're deliberately kept
out of `data-update.yml`. Rather than two more separate workflows,
`.github/workflows/vn-vnstock-update.yml` installs `vnstock` once, runs
`automation/sector_flows/fetch_sector_flows.py` then
`automation/vn_cashout/fetch_cashout_data.py` back to back (with a `sleep`
between them — vnstock's free/guest tier caps at 20 requests/min, and both
scripts together sit close to that ceiling), then
`automation/vn_regime/compute_regime.py` (stdlib-only, reads the two JSON
files just written rather than fetching anything new — see below), and
commits everything in one go. Runs weekdays at 15:00 ICT / 17:00 JST
(08:00 UTC), right after HOSE closes. See `automation/sector_flows/README.md`
and `automation/vn_cashout/README.md` for what's real data vs. estimated
proxy vs. no-free-source-available in each.

### Regime engine (`automation/vn_regime/`)

Synthesizes `live.json` + `sector-flows.json` + `cashout-vn.json` into four
scores (Liquidity / Positioning / Momentum / Macro), one verdict, and
divergence flags when the scores disagree with each other — the Ray Dalio–
style reframing discussed with the user (see the `regime-architecture`
artifact published earlier in that conversation for the full rationale).
Two outputs:

- `public/data/regime.json` — the latest verdict, self-documenting (`method`
  field explains each score's formula in the file itself).
- `public/data/history/regime-<year>.jsonl` — one upserted row per session,
  same idempotent pattern as `history/<year>.jsonl`. This is both the input
  Liquidity Score's percentile calculation needs (thresholds are rolling/
  adaptive, not the fixed 20,000/12,000 tỷ VND numbers `dong-tien-cashout.html`
  currently hardcodes) and the future backtest log (join on `date` against
  `history/<year>.jsonl`'s `vnIndex` to check whether a given verdict
  actually predicted what happened next).

No dashboard page consumes `regime.json` yet — this is data-layer work only.
Scores degrade honestly when history is thin (`band: "insufficient_history"`,
`value: null`) rather than inventing numbers; see
`automation/vn_regime/README.md` for the exact thresholds and, importantly,
which formulas are still an uncalibrated v1 guess.

## Deploy pipeline

`.github/workflows/deploy.yml` builds the Vite app (`npm ci && npm run build`)
and publishes `dist/` to the `gh-pages` branch via `peaceiris/actions-gh-pages`
(`force_orphan: true`, so history on that branch is squashed on every deploy).
It's declared to trigger on every push to `main` — but in practice **that
push trigger does not fire for the data workflows' own auto-commits**:
`git-auto-commit-action` pushes using the default `GITHUB_TOKEN`, and GitHub
deliberately blocks `GITHUB_TOKEN`-authored pushes from triggering other
workflows (an anti-recursion guard). This was verified directly — past
auto-commits had no matching deploy run, so the live site only caught up
whenever an unrelated real (human-authored) push happened to follow. All
three data workflows (`data-update.yml`, `vn-vnstock-update.yml`) now close
that gap explicitly: after a successful `git-auto-commit-action` step
(guarded on its `changes_detected` output), a final step runs
`gh workflow run deploy.yml --ref main` to fire the rebuild+republish. If you
add a fourth data workflow, copy that pattern — don't assume the `push`
trigger alone is enough.

GitHub Pages must be configured once as **Settings → Pages → Source: Deploy
from a branch → `gh-pages` / `/(root)`**. Keeping data-fetch and
deploy as two separate workflows (rather than one Jekyll-processed `main`
branch deploy) avoids a prior incident where a Jekyll auto-deploy and the
Actions deploy raced each other and produced an intermittent 404 — if you ever
see that again, double check Pages isn't also set to deploy from `main`.
