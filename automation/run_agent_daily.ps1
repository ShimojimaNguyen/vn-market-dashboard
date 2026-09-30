# Backup/manual data pipeline using a local Claude Code CLI agent.
# Schedule via Windows Task Scheduler: 08:20 and 16:10 ICT.
#
# AUTH — đo lại 2026-09-30, và kết quả NGƯỢC với những gì file này từng ghi:
#   `claude -p` headless CHẠY ĐƯỢC bằng Pro/Max subscription login, KHÔNG cần
#   ANTHROPIC_API_KEY. Đã chứng minh bằng cách đặt tường minh một khoá API đã
#   hết credit (gọi thẳng API trả 400) rồi chạy `claude -p` — vẫn thành công,
#   tức CLI bỏ qua khoá và dùng subscription.
#
#   `--bare` MỚI là thứ làm hỏng: chạy kèm nó thì CLI trả "Not logged in ·
#   Please run /login". Bản trước ghi rằng `--bare` là để "tính phí tường minh
#   qua API key" — sai. `claude --help` nói `--bare` = "Minimal mode: skip
#   hooks". Nó mò đúng triệu chứng nhưng gán sai nguyên nhân, và cái giá là cả
#   đường chạy này bị coi là phải trả tiền suốt nhiều tháng.
#
# Requires: claude CLI (winget install Anthropic.ClaudeCode) đã đăng nhập, git
# credentials, python, và (tuỳ chọn) GitHub CLI `gh` để mở PR tự động.
#
# Role split: GitHub Actions (.github/workflows/data-update.yml) is the primary, scheduled
# pipeline and pushes straight to main. This script is a manual/backup tool — it NEVER pushes
# to main directly. It commits to a dated branch and opens a pull request instead, so a stale
# or bad local run can't silently race/overwrite the Actions pipeline.

$ErrorActionPreference = "Stop"

# Force UTF-8 everywhere before anything else runs. The repo path contains Japanese
# characters (OneDrive\ドキュメント\...) — without this, child processes (the `claude`
# CLI in particular) can inherit the system ANSI codepage, mis-decode the path when
# checking it against --allowedTools' write-path allowlist, and silently fail every
# Write/Edit with a mojibake'd "not in allowed paths" error (seen in agent-last-run.txt:
# Task 2 news.json curation completed but the write itself was rejected this way).
chcp 65001 | Out-Null
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONUTF8 = "1"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$LogDir = Join-Path $Root "automation"
$Log = Join-Path $LogDir "agent-daily.log"
function Write-Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $Log -Value $line -Encoding utf8
  Write-Host $line
}

Write-Log "=== agent daily start ==="

# 1) Free APIs + RSS news fetch FIRST — this is what produces public/data/news-raw.json,
#    which the agent (step 2) reads to curate public/data/news.json. Order matters: the
#    agent must run AFTER this so news-raw.json exists and is fresh, not yesterday's.
Write-Log "Running daily_update.py --no-grok (pre-agent: free APIs + news-raw.json)"
try {
  py (Join-Path $Root "automation\daily_update.py") --no-grok
  Write-Log "daily_update (pre-agent) OK"
} catch {
  Write-Log "daily_update (pre-agent) FAIL: $_"
  exit 1
}

# 2) Claude agent research → public/data/grok-fill.json + public/data/news.json
# (grok-fill.json keeps its historical name — daily_update.py's merge logic reads this one
# file regardless of whether the xAI Grok API, this local Claude agent, or a human wrote it)
$promptFile = Join-Path $Root "automation\agent_daily_prompt.md"
$claude = Get-Command claude -ErrorAction SilentlyContinue

if (-not $claude) {
  Write-Log "WARN: claude CLI not found — skip agent fill (only free APIs). Install: winget install Anthropic.ClaudeCode"
} else {
  Write-Log "Running Claude agent..."
  Write-Log "prompt-file: $promptFile"
  $promptText = Get-Content -Path $promptFile -Raw
  $outFile = Join-Path $LogDir "agent-last-run.txt"
  try {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    # KHÔNG dùng --bare: nó làm CLI mất đăng nhập subscription (xem đầu file).
    #
    # ToolSearch PHẢI nằm trong allowedTools. WebSearch/WebFetch là tool
    # "deferred" — agent phải nạp schema bằng `ToolSearch select:WebSearch,WebFetch`
    # trước khi gọi được. Đây là nguyên nhân THẬT của cái mà README gọi là
    # "known, unresolved gap": không phải web bị chặn, mà là chưa ai bảo agent
    # nạp công cụ. Quan sát được lúc đo: khi thiếu bước này agent trả lời bằng
    # trí nhớ rồi vẫn ghi "Sources:" — tỷ giá VCB 26.170 (sai); có bước này nó
    # tìm thật và ra 26.160, khớp đúng số thật.
    #
    # --permission-mode acceptEdits + --allowedTools tường minh: có phạm vi,
    # không dùng --dangerously-skip-permissions.
    & claude -p $promptText `
      --permission-mode acceptEdits `
      --allowedTools "ToolSearch,WebSearch,WebFetch,Read,Write" `
      --model sonnet `
      --output-format json *>&1 |
      Tee-Object -FilePath $outFile | Out-Null
    # Tee-Object above writes UTF-16 by PowerShell default; re-save as UTF-8 so the log is
    # readable by normal tools (this exact bug already happened once with the old grok CLI
    # invocation, and was re-introduced by accident when this block was rewritten for Claude).
    if (Test-Path $outFile) {
      $outContent = Get-Content -Path $outFile -Raw
      Set-Content -Path $outFile -Value $outContent -Encoding utf8
    }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($code -ne 0) {
      Write-Log "Claude agent exit code: $code (see automation/agent-last-run.txt)"
    } else {
      Write-Log "Claude agent finished OK"
    }
  } catch {
    Write-Log "Claude agent error: $_"
  }
}

# 3) Re-run to merge the grok-fill.json the agent just wrote (step 2) into live.json/history.
#    This is a second, cheap pass over the same free APIs — not wasteful in practice (a few
#    HTTP GETs) and the only way to get the agent's fresh output merged same-run, since it
#    didn't exist yet during step 1's pass. (do NOT call XAI_API_KEY)
Write-Log "Running daily_update.py --no-grok (post-agent: merge grok-fill.json)"
try {
  py (Join-Path $Root "automation\daily_update.py") --no-grok
  Write-Log "daily_update (post-agent) OK"
} catch {
  Write-Log "daily_update (post-agent) FAIL: $_"
  exit 1
}

# 4) Commit to a dated branch and open a PR — never push straight to main from a local run.
$today = Get-Date -Format "yyyy-MM-dd"
$branch = "agent/data-$today"
$dataFiles = @(
  "public/data/live.json",
  "public/data/last-run.json",
  "public/data/grok-fill.json",
  "public/data/news-raw.json",
  "public/data/news.json",
  "public/data/world-live.json",
  "public/data/history",
  "public/data/events.json"
)

Write-Log "Git commit to branch $branch"
$prevEap2 = $ErrorActionPreference
$ErrorActionPreference = "Continue"

# Stash any working-tree output from daily_update.py (or leftovers from a previous aborted
# run) before switching branches — otherwise `git checkout` can refuse to switch when the
# target branch has different content for the same files, which used to make this script
# silently commit to whatever branch was already checked out (see git history for the bug
# this fixed). Popped back onto the target branch below so the data still ends up committed.
$stashed = $false
if (git status --porcelain) {
  git stash push -u -m "run_agent_daily temp" *>$null
  if ($LASTEXITCODE -eq 0) { $stashed = $true }
}

git rev-parse --verify $branch *>$null
if ($LASTEXITCODE -eq 0) {
  git checkout $branch *>$null
} else {
  git checkout -b $branch *>$null
}
if ($LASTEXITCODE -ne 0) {
  Write-Log "Git checkout $branch FAILED (exit=$LASTEXITCODE) — aborting so we don't accidentally commit to whatever branch is currently checked out."
  if ($stashed) { Write-Log "Working-tree changes are preserved in 'git stash list' — resolve manually." }
  git checkout - *>$null
  $ErrorActionPreference = $prevEap2
  exit 1
}
$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($currentBranch -ne $branch) {
  Write-Log "SAFETY ABORT: expected to be on '$branch' but HEAD is on '$currentBranch' — refusing to commit (would land on the wrong branch, possibly main)."
  if ($stashed) { Write-Log "Working-tree changes are preserved in 'git stash list' — resolve manually." }
  $ErrorActionPreference = $prevEap2
  exit 1
}

if ($stashed) {
  git stash pop *>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Log "Git stash pop FAILED on branch $branch (conflict) — resolve manually, changes are in 'git stash list'."
    git checkout - *>$null
    $ErrorActionPreference = $prevEap2
    exit 1
  }
}

git add -- $dataFiles
$st = git status --porcelain -- $dataFiles
if ($st) {
  git -c core.safecrlf=false commit -m "data: agent daily market snapshot"
  if ($LASTEXITCODE -ne 0) {
    Write-Log "Git commit failed exit=$LASTEXITCODE"
    git checkout - *>$null
    $ErrorActionPreference = $prevEap2
    exit 1
  }
  git push -u origin $branch
  if ($LASTEXITCODE -ne 0) {
    Write-Log "Git push failed exit=$LASTEXITCODE"
    git checkout - *>$null
    $ErrorActionPreference = $prevEap2
    exit 1
  }
  Write-Log "Pushed branch $branch"

  $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
  if ($ghCmd) {
    gh pr create --title "data: agent daily market snapshot ($today)" `
      --body "Automated data snapshot from the local Claude CLI agent. Review before merging into main." `
      --base main --head $branch 2>&1 | ForEach-Object { Write-Log $_ }
  } else {
    Write-Log "gh CLI not found — open a PR manually: https://github.com/<owner>/<repo>/compare/main...$branch"
  }
} else {
  Write-Log "No data changes to commit"
}

git checkout - *>$null
$ErrorActionPreference = $prevEap2

Write-Log "=== agent daily done ==="
exit 0
