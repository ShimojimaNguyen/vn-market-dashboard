# Project Structure — VN Market Dashboard

## Directory Layout

```
vn-market-site/
├── src/                        # React source code
│   ├── components/layout/      # Shared layout components
│   │   ├── SiteHeader.jsx      # Header with brand, NavTabs, slot for pills
│   │   ├── NavTabs.jsx         # Page navigation tabs
│   │   ├── TickerTape.jsx      # Scrolling ticker tape
│   │   └── Footer.jsx
│   ├── hooks/                  # Data-fetching hooks
│   │   ├── useJsonFetch.js     # Base fetch hook (status: loading|ready|error)
│   │   ├── useLiveMarketData.js→ public/data/live.json
│   │   ├── useHistory.js       → public/data/history/*.jsonl + events.json
│   │   ├── useNews.js          → public/data/news.json
│   │   ├── useEconActuals.js   → public/data/econ-actuals.json
│   │   ├── useRegime.js        → public/data/regime.json
│   │   ├── useSectorFlows.js   → public/data/sector-flows.json
│   │   ├── useCashout.js       → public/data/cashout-vn.json
│   │   └── useMarketInsight.js → public/data/vn-insight.json
│   ├── styles/
│   │   ├── tokens.css          # Design tokens (CSS custom properties)
│   │   └── layout.css          # Shared base layout
│   ├── data/
│   │   └── worldInstruments.js # Static instrument list for world page
│   ├── dashboard/              # VN Market Dashboard page
│   │   ├── MarketDashboardApp.jsx  # React shell (DOM skeleton + hook wiring)
│   │   ├── dashboardEngine.js      # Imperative chart/DOM rendering engine
│   │   └── dashboard.css
│   ├── world/                  # World Indices page
│   │   ├── WorldIndicesApp.jsx
│   │   ├── worldEngine.js
│   │   └── world.css
│   ├── history/                # History & Correlation page
│   │   ├── HistoryApp.jsx
│   │   ├── historyEngine.js
│   │   └── history.css
│   ├── regime/                 # Market Regime page
│   │   ├── RegimeApp.jsx
│   │   └── regime.css
│   ├── sectorFlows/            # Sector Flows page
│   │   ├── SectorFlowsApp.jsx
│   │   ├── sectorFlowsEngine.js
│   │   └── sectorFlows.css
│   ├── cashout/                # Cashout page
│   │   ├── CashoutApp.jsx
│   │   ├── cashoutEngine.js
│   │   └── cashout.css
│   ├── guide/                  # Reading guide page
│   │   ├── GuideApp.jsx
│   │   └── guide.css
│   └── main-*.jsx              # Entry points (one per page)
├── public/data/                # Pipeline output — served as static JSON
│   ├── live.json               # Latest market snapshot
│   ├── history/                # JSONL files per year + index.json
│   ├── events.json             # Macro events for history chart
│   ├── grok-fill.json          # AI-filled fields (margin, VN bonds, etc.)
│   ├── regime.json             # Market regime data
│   ├── sector-flows.json       # Sector flow data
│   ├── cashout-vn.json         # Cashout distribution data
│   ├── news.json               # Macro news items
│   ├── econ-actuals.json       # US economic actuals
│   └── world-live.json         # World markets snapshot
├── automation/                 # Data pipeline scripts (Python)
│   ├── daily_update.py         # Main pipeline: fetches free sources
│   ├── apply_grok_fill.py      # Merges Grok AI fill into live.json
│   ├── backfill_history.py     # Backfills history JSONL files
│   ├── backfill_breadth.py     # Backfills breadth data
│   ├── run_agent_daily.ps1     # Local Windows agent (opens PRs)
│   ├── vn_regime/              # Regime computation scripts
│   ├── vn_cashout/             # Cashout data fetcher
│   ├── vn_insight/             # Market insight fetcher
│   └── sector_flows/           # Sector flows fetcher
├── .github/workflows/
│   ├── data-update.yml         # Scheduled data fetch → commit to main
│   ├── deploy.yml              # Build → publish dist/ to gh-pages
│   ├── backfill-history.yml    # Manual: backfill history files
│   └── vn-vnstock-update.yml   # VN stock data update
├── *.html                      # One HTML entry per page (Vite MPA)
├── vite.config.js
└── package.json
```

## Architectural Pattern: React Shell + Imperative Engine

Each feature page follows a consistent two-layer pattern:

1. **React App component** (`*App.jsx`): Renders the static DOM skeleton (panels, chart containers, tables with `id` attributes). Wires data hooks, waits for all hooks to reach `"ready"` status, then calls the engine's `init*()` function exactly once (guarded by `useRef(false)`).

2. **Engine module** (`*Engine.js`): Pure imperative JavaScript that reads data and mutates DOM elements by `id`. No React — uses `document.getElementById`, `innerHTML`, `style`, etc. This pattern ports the original inline-script chart engine into a module without rewriting to a React-managed render cycle.

## Multi-Page Application (MPA)

- 7 separate HTML entry points, each mounting its own React root
- Vite `rollupOptions.input` maps all HTML files
- Base path: `/vn-market-dashboard/` in production, `/` in dev
- Pages share components, styles, and hooks but have independent bundles

## Data Flow

```
GitHub Actions (scheduled)
  → automation/daily_update.py
  → public/data/live.json + history/*.jsonl
  → commit to main → triggers deploy.yml
  → dist/ → gh-pages branch → GitHub Pages

Browser
  → fetch("data/live.json")  [via hooks]
  → React hook returns { data, status }
  → App waits for status === "ready"
  → calls initEngine(data)
  → Engine mutates DOM by id
```
