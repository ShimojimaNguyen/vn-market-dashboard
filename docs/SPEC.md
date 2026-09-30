# SPEC — VN Market Dashboard

Bản đặc tả kỹ thuật khớp hệ thống thật đang chạy. Đọc cùng `CLAUDE.md` ở gốc
repo — khi mâu thuẫn, `CLAUDE.md` thắng. File này mô tả *cái đang có*, không
phải kiến trúc mơ ước; đừng thêm mục cho tính năng chưa tồn tại mà không ghi
rõ đó là đề xuất, chưa triển khai.

> Bản trước của file này mô tả một stack production nặng (Postgres/TimescaleDB,
> FastAPI, Next.js, Redis, portfolio TWR/XIRR...) chưa từng được xây. Đã bỏ.

---

## 1. Phạm vi

**Hệ thống làm gì**
1. Tổng hợp chỉ số thị trường VN + thế giới từ vài API miễn phí và một agent
   LLM tuỳ chọn, chạy theo lịch qua GitHub Actions.
2. Ghi kết quả ra file JSON tĩnh dưới `public/data/` (+ JSONL lịch sử theo
   năm) — không có database.
3. Hiển thị qua 6 trang Vite/React tĩnh, build lên GitHub Pages.

**Hệ thống KHÔNG làm**
- Không đưa khuyến nghị đầu tư, không giá mục tiêu, không chấm điểm mua/bán
  (xem CLAUDE.md §1.5).
- Không đặt lệnh, không kết nối broker, không tài khoản người dùng.
- Không quảng bá là dữ liệu real-time — mọi số có `quality` + `as of`.
- Không backtest/điều chỉnh giá corporate action theo từng mã (CLAUDE.md §1.3).

**Người dùng mục tiêu**: người tự theo dõi thị trường VN, cần biết ngay một số
là thật/proxy/mẫu hơn là cần giao diện đẹp.

---

## 2. Nguồn dữ liệu & pipeline

Không có adapter interface chung, không rate limiter/circuit breaker kiểu
production — mỗi script tự gọi API và tự xử lý lỗi cục bộ (log + giữ giá trị
cũ, xem CLAUDE.md §1.5 mục 5). Có 2 workflow độc lập, không chia sẻ code:

| Workflow | Script | Nguồn | Lịch (ICT, T2–T6) | Ghi ra |
|---|---|---|---|---|
| `data-update.yml` | `automation/daily_update.py` (stdlib-only) | US Treasury yield CSV, Yahoo Finance (`^VNINDEX.VN`, DXY), CNN Fear & Greed, Anthropic Messages API tuỳ chọn (`ANTHROPIC_API_KEY`) | ~16:00 | `live.json`, `history/<year>.jsonl`, `last-run.json`, `news-raw.json`, `world-live.json` |
| `vn-vnstock-update.yml` | `fetch_sector_flows.py` → `fetch_cashout_data.py` → `compute_regime.py` (cần `pandas`+`vnstock`, cuối cùng stdlib-only) | vnstock (nguồn VCI): `price_board` bulk ~700 mã, `company.ratio_summary()`, `company.trading_stats()` | ~16:30, sau `data-update.yml` | `sector-flows.json`, `cashout-vn.json`, `regime.json`, `history/regime-<year>.jsonl` |

Chạy tay: xem lệnh ở CLAUDE.md §4. `backfill-history.yml` là workflow riêng,
chỉ chạy thủ công (`workflow_dispatch`), dùng cho backfill lịch sử ban đầu —
không chạy theo lịch.

**Nguyên tắc lỗi**: một mã/nguồn lỗi tạm thời không được làm hỏng cả lượt
chạy — retry 1–2 lần rồi bỏ qua, set `quality=stale|missing` hoặc giữ
`prev.get(...)`, log rõ (xem `fetch_fundamentals()` trong
`automation/vn_cashout/fetch_cashout_data.py` làm ví dụ retry+skip chuẩn).
Không tự "sửa" số nhìn bất thường — báo người, không đoán (CLAUDE.md §5.5).

**Giới hạn API đã biết**: tài khoản khách vnstock giới hạn 20 request/phút —
các script đã có `time.sleep()` giữa các lần gọi. LLM fill cần `ANTHROPIC_API_KEY`
qua GitHub Actions secret, không bao giờ commit vào repo.

---

## 3. Mô hình dữ liệu

Không có schema DB. "Mô hình dữ liệu" ở đây là tập file JSON dưới
`public/data/`, mỗi file có "chủ" là đúng một script ghi ra (không script nào
khác được sửa file đó) và có mô tả field trong chính JSON (`method`/`quality`
key) thay vì migration riêng.

| File | Ghi bởi | Đọc bởi (trang) |
|---|---|---|
| `live.json` | `daily_update.py` | Dashboard chính |
| `world-live.json` | `daily_update.py` | Trang Thế giới |
| `history/<year>.jsonl` | `daily_update.py` (`append_history()`) | Trang Lịch sử & Tương quan |
| `sector-flows.json` | `fetch_sector_flows.py` | Trang Dòng tiền ngành |
| `cashout-vn.json` | `fetch_cashout_data.py` | Trang Dòng tiền & Cashout |
| `regime.json` | `compute_regime.py` | Trang Regime Dashboard |
| `history/regime-<year>.jsonl` | `compute_regime.py` (`write_regime_history()`) | Trang Regime Dashboard (percentile Liquidity) |
| `news.json` / `news-raw.json` | `daily_update.py` + xử lý riêng | Ticker tape tin tức |
| `events.json` | **Sửa tay** (whitelist trong CLAUDE.md §1.5) | Lịch sự kiện |
| `grok-fill.json` | **Sửa tay** hoặc agent LLM | Merge vào `live.json` (`apply_grok_fill.py`) |

**Idempotency qua key `date`**, không qua transaction/lock: `append_history()`
và `write_regime_history()` upsert theo `date` trong dict rồi ghi đè cả file —
chạy lại nhiều lần trong ngày an toàn, nhưng đây **không phải** ghi có
concurrency control; hai lần chạy đồng thời có thể race. Trong thực tế không
xảy ra vì mỗi workflow chạy tuần tự, không có 2 job song song ghi cùng file.

**Point-in-time qua `quality` flag** (không qua bảng lineage riêng):
`live: proxy: stale: missing` ở field-level trong `live.json`; `band:
insufficient_history` ở score-level trong `regime.json` khi chưa đủ lịch sử
tối thiểu (bảng ở §4.3). Xem CLAUDE.md §1.3 cho định nghĩa từng mức.

---

## 4. Quy ước tính toán

### 4.1 Đơn vị & làm tròn

- Tiền: tỷ VND (`_bn` suffix), làm tròn `round(x, 1)` hoặc `round(x, 2)` tuỳ
  field — giữ nguyên mức đã dùng trong `automation/*.py`, không tự đổi.
- Phần trăm: đã nhân 100 (field `pct`/`Pct` nghĩa là "3.1" = 3.1%), không
  dùng quy ước thập phân `0.031`. Không trộn hai quy ước trong cùng field.
- Không cộng/so sánh khác đơn vị mà không quy đổi tường minh.

### 4.2 Cấm look-ahead bias

Mọi percentile/rolling window loại trừ ngày đang tính khỏi tập lịch sử tham
chiếu — pattern chuẩn là `history_excl_today` trong
`automation/vn_regime/compute_regime.py::compute_scores()`
(`history_rows` lọc `d != date` trước khi tính percentile/trung bình). Công
thức mới copy đúng pattern này, không tự nghĩ cách khác.

### 4.3 Ngưỡng band (Regime scores)

| Điểm số | Cần lịch sử tối thiểu | Ngưỡng `healthy` / `caution` / `danger` |
|---|---|---|
| Liquidity | 20 phiên (percentile) | ≥60 / ≥30 / <30 |
| Positioning | 5 phiên (trung bình 5D) | ≥60 / ≥40 / <40 |
| Momentum | không cần (đọc RRG trực tiếp) | ≥60 / ≥35 / <35 |
| Macro | một phần (xu hướng DXY) | ≥60 / ≥40 / <40 |

Thiếu lịch sử → `value: null, band: "insufficient_history"` kèm lý do cụ thể
(vd "cần ≥20 phiên, hiện có 3") — không suy diễn số để lấp chỗ trống.
`verdict` chỉ trung bình các điểm số đang có, bỏ qua `null` (không zero-fill).

**Công thức Positioning/Macro là v1, ngưỡng thô ước lượng, chưa hiệu chỉnh
bằng backtest thật** — xem giới hạn đầy đủ ở `automation/vn_regime/README.md`.

### 4.4 Năng lực hấp thụ vốn (capacity)

`automation/vn_cashout/fetch_cashout_data.py::capacity_days()` — số phiên cần
để giải ngân/rút một khoản vốn nếu tự giới hạn ở một tỷ lệ % GTGD/phiên
(participation-rate heuristic, quy ước bàn giao dịch tổ chức phổ biến là
≤10-20%/phiên để giảm market impact; hệ thống dùng cố định 15%):

```
capacity_days(capital_bn, turnover_bn, participation_pct)
  = capital_bn / (turnover_bn * participation_pct)
```

Dùng GTGD **của đúng phiên hôm nay** (snapshot 1 phiên/lần chạy, không phải
ADTV trung bình nhiều phiên — hệ thống chưa lưu lịch sử turnover theo mã).
Mốc vốn (`capacity.tiers`, `capacity_days_500bn`) là **minh hoạ**, không suy
ra từ AUM cụ thể nào — người đọc tự quy đổi theo vốn thật. Đây là cơ học
thực thi lệnh thuần tuý, **không phải khuyến nghị quy mô vị thế** (tuân thủ
CLAUDE.md §1.5). `leadersRollup` (cùng file) là trung bình theo tỷ trọng
GTGD (turnover-weighted) của P/E/P/B/ROE/%sở hữu trên 10 mã dẫn dắt theo
GTGD — khác universe với `marketConcentration.topStocks` (top-10 theo vốn
hoá), không được gộp nhầm hai tập hợp này.

### 4.5 Đã khảo sát nhưng hoãn: margin debt MoM

Từng cân nhắc đưa xu hướng dư nợ margin (MoM) vào Positioning score, nhưng
`live.json.margin.days[]` hiện chỉ có **đúng 1 điểm dữ liệu/lần cập nhật**
(nguồn báo chí/Grok theo quý, không phải chuỗi thời gian tích luỹ hàng
ngày) — chưa đủ để tính xu hướng có ý nghĩa. `compute_regime.py` đã tự ghi
chú "margin MoM sẽ gộp sau khi có đủ điểm dữ liệu tháng phân biệt". Không
làm phần này cho đến khi có đủ lịch sử thật — tránh suy diễn xu hướng từ 1
điểm hoặc để `insufficient_history` vĩnh viễn không có giá trị.

### 4.6 Không có

Không có: adjusted price theo corporate action, Sharpe/Sortino/Beta/VaR danh
mục, TWR/XIRR, chuyển đổi múi giờ đa sàn, chỉ báo kỹ thuật (RSI/MACD/
Bollinger/ATR) trên từng mã. Hệ thống này tổng hợp ở cấp thị trường/ngành, mọi
tính năng theo dõi giá từng mã lịch sử phải hỏi trước khi thiết kế
(CLAUDE.md §1.3).

---

## 5. "API" — thực chất là file JSON tĩnh

Không có REST API, không backend runtime. Frontend `fetch()` thẳng file dưới
`public/data/` qua HTTP tĩnh (GitHub Pages) — xem CLAUDE.md §3 "Quy tắc phụ
thuộc": `src/**` chỉ đọc JSON, không import `automation/`; `automation/**`
không import `src/`.

Mỗi file JSON tự mang metadata thay vì có endpoint `/meta` riêng — pattern
chung: `asof` (ngày phiên), `generatedAtIct` (giờ chạy script), `quality`
(field-level), `method`/`sourceNotes` (giải thích công thức/nguồn bằng văn
xuôi, không phải OpenAPI schema). Không có field nào xuất hiện mà thiếu 3 thứ
này — xem CLAUDE.md §1.4.

---

## 6. Frontend

6 trang, mỗi trang một Vite build entry + React root riêng, dùng chung
`src/components/` (header, nav, ticker tape, footer) và `src/hooks/`
(`useJsonFetch` là hook nền, các hook khác đặc thù từng trang bọc quanh nó).
JavaScript thuần, CSS thường — không TypeScript, không Tailwind, không UI
framework ngoài React (CLAUDE.md §2).

**Yêu cầu bắt buộc** (đã áp dụng, không phải đề xuất):
- Thiếu dữ liệu → `—`, cấm `0`/`null` trần trụi trên UI.
- Mọi số có nhãn `as of <timestamp>` + nguồn hiển thị được, không chỉ có
  trong JSON.
- Dữ liệu mẫu/proxy/nội suy có pill nhãn tương ứng (3 mức: Mẫu/Proxy/Nội suy).
- Footer disclaimer mọi trang: không phải lời khuyên đầu tư.

Không có: skeleton loading state chuẩn hoá, error boundary có nút retry,
virtualize chart lớn, LTTB downsampling — nếu cần các thứ này, đó là việc mới,
không phải đã có sẵn.

---

## 7. Kiểm thử

**Chưa có test framework** (không pytest, không Vitest/Playwright) — xem
CLAUDE.md §5-6 cho định nghĩa "xong" thực tế: `npx vite build` sạch cho đổi
frontend, chạy thử script Python thật cho đổi pipeline, đối chiếu output JSON
bằng mắt. Nếu quyết định thêm framework test, đó là quyết định lớn, hỏi trước
khi thêm dependency.

`final_check.mjs` (nếu có ở gốc repo) là script Playwright chạy tay, không
phải CI — smoke-check vài trang trên GitHub Pages sau deploy (nav render
đúng, không lỗi console). Không phải test suite chính thức.

---

## 8. Vận hành

- Secret duy nhất: `ANTHROPIC_API_KEY` (GitHub Actions secret hoặc env local) —
  không commit vào bất kỳ file nào kể cả `grok-fill.json`.
- Không có structured logging/metrics/alerting — log là `print()` trong từng
  script, đọc qua GitHub Actions run log. Biết trước, không phải thiếu sót
  cần fix ngay.
- Local agent (`run_agent_daily.ps1`, Claude Code CLI headless) là backup thủ
  công, không phải nguồn chính — luôn mở PR, không bao giờ push thẳng `main`.
  Chi tiết đầy đủ ở `automation/README.md`.
- **Tuân thủ**: chưa lưu ToS từng vendor vào `docs/licenses/`. Trước khi thêm
  nguồn mới phải hỏi và kiểm tra ToS cho phép redistribute công khai
  (CLAUDE.md §1.5).
