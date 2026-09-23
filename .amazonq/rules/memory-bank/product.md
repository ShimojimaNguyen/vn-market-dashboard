# Product Overview — VN Market Dashboard

## Purpose
A free, non-profit static web dashboard tracking the Vietnam stock market. Provides breadth indicators, margin debt, sentiment, VN↔US bond yields, world markets, and historical data with event correlation. Live at: https://tarzanjp.github.io/vn-market-dashboard/

## Pages & Features

| Page (HTML) | Route | Description |
|---|---|---|
| `index.html` | Dashboard | VN market breadth (ADR), margin debt, Fear & Greed, bond yield curves |
| `the-gioi.html` | World | World indices, FX, commodities, crypto via TradingView widgets |
| `lich-su.html` | History | Overlay chart (rebased index-100), Pearson correlation table, macro events |
| `buc-tranh-thi-truong.html` | Regime | Market regime classification |
| `dong-tien-nganh.html` | Sector Flows | Sector money flow tracking |
| `dong-tien-cashout.html` | Cashout | VN cashout/distribution data |
| `huong-dan-doc.html` | Guide | How-to reading guide |

## Key Capabilities
- **ADR (Advance/Decline Ratio)**: 6/10/15/25-session windows for VN30 and VN100 baskets
- **Market breadth**: Board composition (ceiling/floor/up/down), overbought/oversold gauge
- **Margin debt**: Daily tracking with broker breakdown, risk box
- **Bond yields**: US Treasury (live) + VN Government bonds (interpolated), spread chart
- **Fear & Greed**: US (CNN) + VN sentiment panels
- **History & Correlation**: Multi-year overlay chart with sourced macro events, Pearson correlation
- **Sector flows**: Money flow by sector
- **Data quality labeling**: Every panel labeled **Mẫu** (sample), **Proxy**, or **Nội suy** (interpolated) — deliberate product decision

## Target Users
Vietnamese retail investors and market analysts who want a free, transparent dashboard for Vietnam stock market context alongside global macro data.

## Data Pipeline
- GitHub Actions runs daily (08:15 and 16:00 ICT, weekdays) fetching free sources (US Treasury, VN-Index, DXY, CNN Fear & Greed)
- Optional paid xAI Grok fill for fields with no free API (margin debt, VN bond yields, breadth, USD/VND, foreign flows)
- Local Windows agent (`automation/run_agent_daily.ps1`) available as manual backup — opens PRs rather than pushing to main
- All data served as static JSON from `public/data/`
