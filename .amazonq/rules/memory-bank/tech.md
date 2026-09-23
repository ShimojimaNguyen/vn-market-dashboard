# Technology Stack — VN Market Dashboard

## Frontend

| Technology | Version | Role |
|---|---|---|
| React | ^18.3.1 | UI framework (shell components only) |
| Vite | ^5.4.11 | Build tool, dev server, MPA bundler |
| @vitejs/plugin-react | ^4.3.4 | JSX transform |
| Vanilla JS (ES modules) | — | Chart/DOM engines (no React) |
| CSS Custom Properties | — | Design tokens in `tokens.css` |

## Build System

- **Vite MPA**: 7 HTML entry points configured via `rollupOptions.input`
- **ES modules**: `"type": "module"` in package.json
- **Base path**: `/vn-market-dashboard/` (production) / `/` (dev)
- **Output**: `dist/` — plain static site, no server required

## Development Commands

```powershell
npm install          # Install dependencies
npm run dev          # Dev server at http://localhost:5173
npm run build        # Production build → dist/
npm run preview      # Serve production build locally
```

## Data Pipeline (Python)

- **Python scripts** in `automation/` — no shared requirements.txt at root; each subfolder has its own
- **Sub-module requirements**: `automation/vn_cashout/requirements.txt`, `automation/sector_flows/requirements.txt`, `automation/vn_insight/requirements.txt`
- **Key libraries**: `requests`, `vnstock` (VN stock data), `pandas` (data processing)
- **Virtual env**: `crewai_env/` (pip-based, Python 3.13)

## CI/CD (GitHub Actions)

| Workflow | Trigger | Action |
|---|---|---|
| `data-update.yml` | Schedule: 08:15 + 16:00 ICT weekdays | Fetch data → commit `public/data/` to main |
| `deploy.yml` | Push to main | `npm run build` → publish `dist/` to `gh-pages` |
| `backfill-history.yml` | Manual dispatch | Backfill `public/data/history/` |
| `vn-vnstock-update.yml` | Schedule | VN stock data via vnstock |

## Hosting

- **GitHub Pages** — `gh-pages` branch, project page at `/vn-market-dashboard/`
- Compatible with Cloudflare Pages / Netlify (static build, `npm run build`, output `dist/`)

## Data Formats

- `public/data/live.json` — JSON snapshot of latest market data
- `public/data/history/*.jsonl` — newline-delimited JSON, one record per trading day
- `public/data/history/index.json` — `{ years: [2025, 2026, ...] }` manifest
- `public/data/events.json` — flat array of macro events for history chart annotation
- `public/data/grok-fill.json` — AI-filled fields merged over live.json

## No External Chart Library

Charts are rendered with **custom SVG/Canvas or DOM manipulation** inside the engine modules (`dashboardEngine.js`, `historyEngine.js`, etc.) — no Chart.js, D3, or Recharts dependency. TradingView embedded widgets are used only on the world-indices page.
