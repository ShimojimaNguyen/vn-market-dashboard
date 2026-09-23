# Development Guidelines — VN Market Dashboard

## Core Principles (from CLAUDE.md)

**A wrong number is worse than a blank page.** When uncertain about data correctness or a formula — STOP AND ASK. Never guess.

---

## Data Integrity Rules

### Null vs Zero
- Missing data → display `—`, **never display `0`**
- In Python: use `None`, never default to `0` or `""`
- In JS: `nf()/sgn()/cls()` in engine files handle `null` correctly — never override with `?? 0`
- Example: `L.pct = vi.pct != null ? vi.pct : null;` (not `?? 0`)

### Quality Flags
Every data field in `live.json` must have a corresponding `quality` flag:
```json
{ "quality": { "breadth": "live" | "proxy" | "stale" | "missing" } }
```
- `live` — real-time or same-session data
- `proxy` — reasonable estimate (AI-filled, derived)
- `stale` — carried over from a previous session
- `missing` — no source available

### No Look-Ahead Bias
Percentile/rolling calculations must exclude the current day from the reference history:
```python
history_excl_today = {d: r for d, r in history_rows.items() if d != date}
```

### Idempotency
All fetch scripts must be idempotent by `date` — re-running the same day overwrites that row, never creates duplicates. Use `load_history_year()`/`write_history_year()` pattern.

### No Carry-Forward
Never carry forward stale data under a "proxy" label across days:
```python
if live.get("asof") != today_ict:
    return None, "missing"  # not the previous day's value
```

---

## Frontend Patterns

### React Shell + Imperative Engine Pattern
Every feature page uses this two-layer architecture:

**Layer 1 — React App** (`*App.jsx`):
- Renders static DOM skeleton with `id` attributes
- Wires data hooks, waits for all to reach `"ready"` status
- Calls engine's `init*()` exactly once, guarded by `useRef(false)`

```jsx
const initedRef = useRef(false);
useEffect(() => {
  if (status !== "ready" || historyStatus !== "ready" || initedRef.current) return;
  initedRef.current = true;
  initMarketDashboard(live, history);
}, [status, live, historyStatus, history]);
```

**Layer 2 — Engine module** (`*Engine.js`):
- Pure imperative JS, no React
- Reads data, mutates DOM by `id`
- Uses `document.getElementById`, `innerHTML`, `style`

### Data Hooks Pattern
All hooks follow the `useJsonFetch` base pattern:

```js
export function useJsonFetch(url) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) { if (!cancelled) setStatus("error"); return; }
        const json = await res.json();
        if (cancelled) return;
        setData(json); setStatus("ready");
      } catch { if (!cancelled) setStatus("error"); }
    }
    load();
    return () => { cancelled = true; };
  }, [url]);
  return { data, status };
}
```

Key points:
- Always use `cancelled` guard to prevent state updates after unmount
- `cache: "no-store"` on all fetches
- Status machine: `"loading"` → `"ready"` | `"error"`
- Specific hooks may remap `"error"` to `"ready"` with null data (see `useLiveMarketData`)

### Data Quality Labels in UI
Labels are set dynamically by the engine based on actual data quality — never hardcoded in JSX:

```js
function setTag(id, text, kind) {
  const n = el(id);
  if (!n) return;
  n.textContent = text;
  n.className = "dtag dtag-" + kind;
}
// kind: "live" | "proxy" | "sample" | "est"
setTag("boardTag", LAST.breadthReal ? "Dữ liệu thật" : "Chưa có số thật",
  LAST.breadthReal ? "live" : "sample");
```

### Number Formatting Utilities (Engine)
```js
const nf = (v, d = 2) => {
  if (v == null || v === "" || (typeof v === "number" && Number.isNaN(v))) return "—";
  return Number(v).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const sgn = (v, d = 2) => { /* returns "+x.xx" / "−x.xx" / "—" */ };
const cls = v => v > 0 ? "up" : v < 0 ? "down" : "flat";  // null → "flat"
```

### SVG Charts
Charts are hand-rolled SVG — no external chart library. Pattern:
```js
function drawCurve() {
  const host = el("curveChart"), W = Math.max(360, host.clientWidth), H = 330;
  const m = { t: 18, r: 22, b: 38, l: 48 };
  // ... build SVG string
  host.querySelector("svg")?.remove();
  host.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="...">${g}</svg>`);
}
```
- Always filter null values before computing min/max (prevents NaN axes)
- Always include `role="img"` and `aria-label` on SVG elements
- Responsive: re-draw on `window.resize` with debounce (`clearTimeout`/`setTimeout`)

### HTML Escaping
Always escape user-facing strings in innerHTML:
```js
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
```

---

## Python Pipeline Patterns

### Script Structure
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Module docstring explaining: purpose, dependencies, data sources, limitations."""
from __future__ import annotations
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "data" / "output.json"

def log(msg: str) -> None:
    print(f"[script_name] {msg}", flush=True)

def main() -> int:
    # ... logic
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"wrote {OUT.relative_to(ROOT)}")
    return 0

if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
```

### JSON Output Schema
Every output JSON must include:
```python
payload = {
    "schemaVersion": "1.0",
    "generatedAtIct": generated_at.isoformat(timespec="seconds"),
    "source": "description of data source",
    "method": { "fieldName": "explanation of how it was computed" },
    "quality": { "fieldName": "live" | "proxy" | "missing" },
    # ... actual data fields
}
```

### Error Handling
- Retry once on API failures, then skip gracefully (don't crash the whole run)
- Log clearly with `[script_name]` prefix
- Return `None` for missing data, never fabricate values
- Rate limiting: `time.sleep(3.2)` between vnstock API calls

```python
for attempt in range(2):
    try:
        time.sleep(3.2)
        result = api_call()
        break
    except Exception as e:
        log(f"fail {sym} (attempt {attempt}): {e!r}")
        time.sleep(15)
```

### JSONL History Files
```python
# Read
for line in path.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line: continue
    try:
        row = json.loads(line)
        if row.get("date"): rows[row["date"]] = row
    except json.JSONDecodeError: continue

# Write (sorted by date, upsert by date key)
with path.open("w", encoding="utf-8") as f:
    for d in sorted(rows):
        f.write(json.dumps(rows[d], ensure_ascii=False) + "\n")
```

### Stdlib-Only Constraint
`automation/daily_update.py` and `automation/vn_regime/compute_regime.py` are intentionally stdlib-only. Do not add `pandas`/`requests`/`vnstock` imports to these files. Sub-modules (`vn_cashout/`, `sector_flows/`, `vn_insight/`) may use pandas + vnstock.

---

## CSS Design System

### Design Tokens (`tokens.css`)
```css
:root {
  --bg: #F5F5F7;          /* page background */
  --surface: #FFFFFF;     /* card/panel background */
  --text: #1D1D1F;        --muted: #6E6E73;  --dim: #8E8E93;
  --blue: #0071E3;
  --tang: #1DA95B;        /* up/green */
  --giam: #E0342B;        /* down/red */
  --tc: #E08A00;          /* reference/amber */
  --tran: #9B4DE0;        /* ceiling/purple */
  --san: #0A93C8;         /* floor/cyan */
  --us: #0071E3;          --vn: #E08A00;     /* US/VN series colors */
  --mono: "IBM Plex Mono", ui-monospace, ...;
  --sans: -apple-system, BlinkMacSystemFont, ...;
  --r: 18px;  --r-sm: 12px;  /* border radii */
}
```

### CSS Class Conventions
- `.up` / `.down` / `.flat` — directional color classes
- `.dtag.dtag-live` / `.dtag.dtag-proxy` / `.dtag.dtag-sample` / `.dtag.dtag-est` — data quality badges
- `.panel` — card container
- `.p-hd` — panel header
- `.num` — monospace number cell
- `.wrap` — max-width content container

---

## Naming Conventions

### JavaScript
- camelCase for variables and functions: `loadBreadth`, `drawCurve`, `buildTape`
- SCREAMING_SNAKE_CASE for module-level constants: `WINDOWS`, `TOP_TICKERS_N`, `VN_HOLIDAYS`
- `el(id)` shorthand for `document.getElementById(id)`

### Python
- snake_case throughout: `load_json`, `compute_regime`, `fetch_cashout_data`
- SCREAMING_SNAKE_CASE for module constants: `ROOT`, `OUT`, `SECTOR_DEFS`, `TOP_TICKERS_N`
- `log()` function in every script for prefixed console output

### React Components
- PascalCase: `MarketDashboardApp`, `SiteHeader`, `NavTabs`
- Props: `active` (string key matching page name), `subtitle`, `children`

---

## Forbidden Patterns

1. **No API keys in frontend** — `src/**` only fetches static JSON from `public/data/`
2. **No hardcoded sample data that looks real** — must have visible label (Mẫu/Proxy/Nội suy)
3. **No `?? 0` on financial values** — use `null` and let `nf()`/`sgn()` render `—`
4. **No carry-forward of stale data** — check `asof` matches today before using
5. **No manual edits to pipeline output files** — `live.json`, `regime.json`, `sector-flows.json`, `cashout-vn.json`, `history/*.jsonl` are script outputs
6. **No new npm/pip dependencies** without discussion — `daily_update.py` is intentionally stdlib-only
7. **No buy/sell recommendations** — display-only dashboard

## "Done" Checklist

- [ ] `npx vite build` passes cleanly (no new errors/warnings)
- [ ] Python scripts run without error, output valid JSON matching existing schema
- [ ] New data fields have `quality` flag + `as of` timestamp + visible source label
- [ ] Missing data shows `—`, not `0`/`null`/`NaN`
- [ ] No history rows from other dates overwritten in `*.jsonl`
- [ ] No secrets in git diff
- [ ] No manual edits to pipeline output files
