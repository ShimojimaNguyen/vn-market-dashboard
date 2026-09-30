# Agent task: daily market fill for vn-market-site

Working directory MUST be: `C:\Users\shimo\OneDrive\ドキュメント\Private\Stock\vn-market-site` (or the repo root that contains `public/data/` and `automation/`).

## Goal

Produce and write `public/data/grok-fill.json` with the latest public Vietnam market session data for the non-profit dashboard. Do not invent numbers. Prefer official or widely cited public sources.

(The output file is still named `grok-fill.json` even when a Claude agent — rather
than the xAI Grok API — produces it; `automation/daily_update.py`'s merge logic
reads this one file regardless of which agent wrote it.)

## Step 0 — BẮT BUỘC: nạp công cụ web trước khi làm gì khác

Chạy ngay lệnh này trước mọi bước khác:

    ToolSearch  với query: select:WebSearch,WebFetch

`WebSearch` và `WebFetch` là tool **deferred** trong Claude Code CLI: chúng có
trong danh sách nhưng **chưa nạp schema**, nên gọi thẳng sẽ thất bại. Nếu bỏ
qua bước này, bạn sẽ không có công cụ tìm kiếm — và đó chính là lúc cái bẫy ở
đoạn dưới xảy ra.

Đo ngày 2026-09-30, cùng một câu hỏi (tỷ giá bán ra VCB):

| | kết quả |
|---|---|
| KHÔNG nạp ToolSearch | trả lời `26.170`, **sai**, kèm dòng "Sources:" như thể đã tra |
| CÓ nạp ToolSearch | gọi WebSearch thật, ra `26.160` — khớp đúng số thật, có URL |

Lưu ý: trường `server_tool_use.web_search_requests` trong output JSON **luôn
bằng 0** kể cả khi WebSearch chạy thật, vì đó là tool phía client. **Đừng dùng
bộ đếm đó để tự kiểm** — hãy nhìn vào việc bạn có nhận được kết quả tìm kiếm
thật hay không.

**Critical — verify tool access before reporting any number.** In prior manual
testing, a differently-worded one-off prompt caused this exact agent to answer a
market-data question with a specific, plausible-looking, entirely fabricated
number while its own transcript literally said "Based on the web search..." even
though the tool-use logs showed zero real `WebSearch`/`WebFetch` calls happened.
So: before writing anything to `grok-fill.json`, confirm each `WebSearch`/`WebFetch`
call in this run actually returned real tool output (not just that you *narrated*
searching). If those tools are unavailable or return nothing usable in this
environment, do **not** fall back to answering from memory/training data — leave
the existing file untouched and say so plainly in your final reply (see `agent-daily.log`
for a real example of this happening safely — that's the correct behavior).

## Steps

1. Determine the latest HOSE trading session date (ICT). Use `WebSearch`/`WebFetch` if needed.
2. Collect what you can reliably find for that session:
   - VN-Index close, change, %
   - HOSE breadth if available (advancers/decliners/unchanged/ceiling/floor, turnover tỷ VND)
   - Margin debt total if publicly reported (daily or weekly — set freq)
   - USD/VND central rate if available
   - VN government bond yields if available
   - Foreign net buy/sell if available
   - Proprietary trading (tự doanh) net buy/sell on HOSE if publicly reported —
     this is rare in Vietnamese press (unlike foreign net flow), so it's normal
     and expected to omit this field most days rather than guess
3. Write file `public/data/grok-fill.json` as a pure JSON object (UTF-8), following the schema in `public/data/grok-fill.example.json` and `automation/README.md`.
4. Set `quality.*` to `proxy` for agent-sourced fields. Omit fields you cannot verify.
5. Put source names/URLs in `sourceNotes`.
6. Do NOT run git push unless the user/script asks; writing `grok-fill.json` is enough for the wrapper script.

## Task 2: curate `public/data/news.json` from `public/data/news-raw.json`

This task does **not** need `WebSearch`/`WebFetch` at all — `daily_update.py`
already fetched real RSS headlines (VnEconomy, Federal Reserve official feeds)
into `public/data/news-raw.json` *before* you ran, deterministically, no LLM
involved in that step. Your job here is pure **Read** + reasoning + **Write**,
which is exactly the toolset that actually works in this headless `--bare`
setup (see the WebSearch/WebFetch gap warning above — this task is designed
to route around it, not depend on it).

1. Read `public/data/news-raw.json` (`items`: array of `{title, link,
   description, publishedAt, category, source}`, already deduped and
   date-filtered — `category` is one of `vn-macro | fed | us-macro`).
2. Also read the existing `public/data/news.json` if it exists — carry
   forward any of its items that are still relevant (< 5 days old, not
   superseded by a newer raw item on the same topic) instead of discarding
   everything each run.
3. Select the **3–6 most market-relevant** items across both sources —
   skip routine noise (bank charter/M&A approvals, generic PR). Prioritize:
   items that would move VN-Index, USD/VND, or Vietnamese sector sentiment.
4. For each selected item, write a JSON object:
   ```json
   {
     "date": "2026-08-11",
     "time": "07:01",
     "category": "vn-macro",
     "impact": 2,
     "title": "...",
     "stats": [["Nhãn ngắn", "Giá trị", "up|down|dim"]],
     "bullets": ["...", "..."],
     "vnImpact": "1 đoạn giải thích kênh truyền dẫn tới VN...",
     "tags": ["...", "..."],
     "source": "Tên nguồn",
     "sourceUrl": "https://..."
   }
   ```
   - `time`: 24h ICT, from `publishedAt` (convert from the feed's UTC
     timestamp — ICT = UTC+7). Omit (`null`) if not meaningful.
   - `impact`: 1 (minor) to 3 (major, e.g. FOMC decision, VN-Index inflection).
   - `stats`: **optional**, only if the raw title/description already states
     2–4 clear numbers (e.g. a rate range, a CPI %, a headcount change). Do
     **not** invent numbers not present in `news-raw.json`'s title/description
     — if the raw item doesn't give you a number, leave `stats` empty (`[]`).
   - `bullets`: summarize/restructure only what's in the raw title +
     description. Do not add outside facts or figures you're recalling from
     training data — if you know more context, it can go in `vnImpact` as
     *reasoning* about mechanism (e.g. "Fed policy → US yields → DXY → USD/VND"),
     never as a new specific number you can't attribute to the raw item.
   - `vnImpact`: this is the one field where synthesis/reasoning is expected
     — connect the dot to Vietnam's market using established, general
     transmission channels (rates/DXY/USD/VND, export demand, risk sentiment).
     Keep it to established mechanisms, not speculative predictions stated as fact.
   - `tags`: 2–3 short labels (Vietnamese, matching the tone of existing tags
     like "Lợi suất TPCP Mỹ giảm", "USD mạnh").
5. Write the final array, sorted newest-first, to `public/data/news.json`:
   ```json
   {"generatedAtIct": "2026-08-11T16:10:00+07:00", "items": [ ... ]}
   ```
6. If `news-raw.json` is missing, empty, or unreadable: leave `news.json`
   untouched and say so in your final reply — same anti-fabrication rule as
   Task 1, do not synthesize cards from memory/training data.

## Task 3: fill `public/data/econ-actuals.json` when a raw item reports a real result

The dashboard's "Lịch sự kiện kinh tế Mỹ" table (`CAL` array in
`src/dashboard/dashboardEngine.js`) is a **hand-maintained schedule** —
dates/times already checked against bls.gov/federalreserve.gov. It does
**not** need WebSearch either: your only job here is to notice when a raw
news item (from Task 2's inputs) is actually reporting the *result* of one
of the events below, and — only if the raw title/description states the
number explicitly — copy it into `public/data/econ-actuals.json`.

**Pending events to watch for** (keep this list in sync by hand with `CAL`
in `dashboardEngine.js` — if that array changes, update this list too):
- `2026-08-12` — CPI Mỹ tháng 7 (% m/m)
- `2026-08-28` — PCE lõi tháng 7 (% m/m)
- `2026-09-04` — Bảng lương phi nông nghiệp tháng 8 (K, nghìn việc làm)
- `2026-09-17` — Kết quả họp FOMC 15–16/9 (% lãi suất điều hành)
- `2026-09-30` — GDP & CPI quý III Việt Nam (%)

Steps:
1. Read the current `public/data/econ-actuals.json` (may not exist yet —
   treat as `{"generatedAtIct": null, "items": {}}` if so).
2. For each raw item you already looked at in Task 2 (or scan
   `news-raw.json` again), check if it clearly reports the *actual* result
   for one of the dates above — e.g. "CPI Mỹ tháng 7 tăng 2,8% so với tháng
   trước, thấp hơn dự báo 2,9%" gives you actual=2.8, forecast=2.9 for
   `2026-08-12`.
3. **Same anti-fabrication rule as Task 2, no exceptions**: only write a
   number that's explicitly stated in the raw title/description. If the
   item mentions `actual` but not `forecast`/`previous`, write `actual` and
   leave the other two `null` — do not skip the whole entry, and do not
   guess the missing ones. If nothing in the raw batch reports on any of
   the 5 dates, leave the file untouched (don't write an empty no-op file).
4. Write/update only the date key(s) you found — **upsert, do not remove or
   touch other existing date keys** (same idempotent-by-date rule as
   `automation/*.py`'s history files):
   ```json
   {
     "generatedAtIct": "2026-08-18T16:10:00+07:00",
     "items": {
       "2026-08-12": {
         "forecast": 2.9, "previous": 2.7, "actual": 2.8, "unit": "% m/m",
         "source": "Tên nguồn", "sourceUrl": "https://..."
       }
     }
   }
   ```
   `unit` must match the unit already implied by the CAL entry (`% m/m`,
   `K`, or `%` per the list above).

## Output

After writing the files, reply with one short line covering all three
tasks: `OK asof=YYYY-MM-DD fields=... news=N items econActuals=M dates` or
`FAIL reason=...` (partial success is fine — e.g. grok-fill and news
written but econActuals skipped because nothing in the raw batch matched
any pending date; say so explicitly).
