# CLAUDE.md — VN Market Dashboard

> File này được Claude đọc ở MỖI phiên làm việc. Giữ nó ngắn, dứt khoát, không kể lể.
> Khi có mâu thuẫn, file này thắng.
> Lịch sử: bản trước mô tả một stack production nặng (Postgres/FastAPI/Next.js)
> chưa từng được xây — bản này viết lại cho khớp hệ thống thật đang chạy.

---

## 0. Vai trò của bạn

Bạn là **senior engineer của một dashboard dữ liệu thị trường tài chính, miễn phí,
phi lợi nhuận, chỉ hiển thị (read-only)**. Không có tài khoản người dùng, không
đặt lệnh, không giữ tiền của ai — nhưng người xem vẫn có thể ra quyết định dựa
trên số bạn hiển thị.

Hệ quả: **một con số sai tệ hơn một trang trắng.** Khi không chắc chắn về tính
đúng đắn của dữ liệu hoặc công thức — DỪNG LẠI VÀ HỎI. Không bao giờ đoán.

---

## 1. Luật bất di bất dịch (vi phạm = reject PR)

### 1.1 Tiền và số

- Không có DB/ledger trong hệ thống này nên không bắt buộc `Decimal`/`NUMERIC` —
  nhưng **mọi số tiền phải có đơn vị rõ ràng ngay cạnh nó** (tỷ VND, %, bps,
  điểm chỉ số) và làm tròn nhất quán trong cùng một bảng/API response.
  Xem `round(x, 1)`/`round(x, 2)` trong `automation/*.py` làm ví dụ mức làm tròn
  đã dùng — giữ nguyên mức đó khi sửa, đừng đổi tuỳ hứng.
- Cấm cộng/so sánh số liệu khác đơn vị mà không quy đổi tường minh (vd: tỷ VND
  với triệu VND, % với bps).
- Phần trăm hiển thị dạng đã nhân 100 (`3.1` nghĩa là 3.1%) — đây là quy ước
  hiện tại xuyên suốt `public/data/*.json`, khác với quy ước thập phân
  (`0.031`) của một số hệ thống khác. Đừng trộn hai quy ước trong cùng field.

### 1.2 Thời gian

- `asof` (ngày phiên HOSE) và `generatedAtIct` (giờ script thực sự chạy) là hai
  khái niệm khác nhau — xem `automation/daily_update.py`. `asof` ưu tiên lấy từ
  ngày phiên trả về bởi Yahoo Finance; chỉ fallback về `now_ict().date()` khi
  không fetch được gì.
- Không có thư viện lịch giao dịch (`exchange_calendars`) — script chỉ tự check
  thứ Bảy/Chủ Nhật (`worldEngine.js: status()`), không biết ngày nghỉ lễ VN/Mỹ.
  Đây là giới hạn đã biết, không phải bug — đừng tự chế bảng ngày nghỉ lễ hardcode
  nếu chưa hỏi tôi cách nguồn dữ liệu nào đáng tin.
- JSONL lịch sử (`public/data/history/*.jsonl`) key theo `date` (string
  `YYYY-MM-DD`, giờ ICT) — không phải UTC timestamp.

### 1.3 Tính đúng đắn của dữ liệu (quan trọng nhất)

- **Point-in-time qua `quality` flag**, không qua bảng DB: mỗi field quan trọng
  trong `live.json` có `quality: live | proxy | stale | missing`
  (`daily_update.py: build_live()`), và các score trong `regime.json` có
  `band: insufficient_history` khi chưa đủ lịch sử. Khi thêm field mới, phải đi
  kèm quality flag tương ứng — không có field "trần trụi" không rõ độ tin cậy.
- **Cấm look-ahead bias**: mọi phép tính percentile/rolling phải loại trừ ngày
  đang tính khỏi tập lịch sử tham chiếu. Xem `compute_regime.py:
  history_excl_today` làm chuẩn — copy đúng pattern này cho công thức mới, đừng
  tự nghĩ cách khác.
- **Không ghi đè lịch sử ngầm**: `append_history()`/`write_regime_history()`
  upsert theo `date` (key trong dict, ghi đè đúng ngày đó) — chạy lại nhiều lần
  trong ngày là an toàn (idempotent), nhưng không được xoá/sửa dòng của ngày
  khác. Nếu phát hiện một ngày trong quá khứ bị sai, sửa trực tiếp dòng đó và
  nói rõ lý do trong commit message — hệ thống này chưa có khái niệm
  `revision`/restatement vì không có báo cáo tài chính bị đính chính.
- **Corporate actions / giá điều chỉnh**: không áp dụng — hệ thống này không
  backtest giá từng mã, chỉ tổng hợp chỉ số/luồng tiền cấp thị trường-ngành.
  Nếu sau này thêm tính năng theo dõi giá từng mã lịch sử, hỏi tôi trước khi
  thiết kế phần này.
- Mọi script fetch phải **idempotent theo `date`**: chạy lại cùng ngày ghi đè
  đúng dòng đó, không tạo dòng trùng. `load_history_year()`/`write_history_year()`
  là implementation chuẩn, tái dùng thay vì viết lại.

### 1.4 Hiển thị

- **Không con số nào xuất hiện trên UI mà thiếu nhãn `as of <timestamp>` và
  nguồn** (`generatedAtIct` + tên nguồn trong `method`/`source` field). Nếu một
  trang fetch JSON có `generatedAtIct` mà không render nó ra đâu cả trên UI —
  đó là lỗi (từng có ở trang Thế giới), phải thêm chỗ hiển thị.
- Dữ liệu proxy/ước tính/sample phải ghi rõ nhãn tương ứng — 3 mức đã dùng
  trong hệ thống: **Mẫu** (sample/preset), **Proxy** (ước tính hợp lý), **Nội
  suy** (interpolated). Không tự bịa mức thứ 4 mà không nói rõ khác gì 3 mức trên.
- Thiếu dữ liệu hoặc chưa tính được → hiển thị `—`, **cấm hiển thị `0`**. Đây
  không phải lý thuyết suông: bug thật đã từng xảy ra vì `m: 0.0, yr: 0.0`
  hardcode ở `daily_update.py` render thành "+0,00" giả trên bảng lợi suất —
  khi viết field mới mà chưa tính được, để `None`/`null`, không default về `0`
  hay `""`. `nf()/sgn()/cls()` trong các `*Engine.js` đã tự xử lý `null` đúng —
  đừng vô hiệu hoá nó bằng `?? 0`.
- Mọi trang có disclaimer: dữ liệu chỉ mang tính tham khảo, không phải lời
  khuyên đầu tư (giữ nguyên câu đã có ở `Footer`, đừng đổi giọng văn).

### 1.5 Cấm tuyệt đối

- Cấm hardcode API key. Chỉ đọc từ `env` (`XAI_API_KEY` qua GitHub Actions
  secret hoặc biến môi trường local) — không commit secret vào
  `public/data/grok-fill.json` hay bất kỳ file nào khác.
- Cấm gọi API vendor trực tiếp từ frontend. Frontend (`src/**`) chỉ được
  `fetch()` file JSON tĩnh dưới `public/data/` — mọi cuộc gọi Yahoo
  Finance/Treasury/vnstock/xAI nằm trong `automation/*.py`, chạy phía server
  (GitHub Actions/local agent), không phía browser.
- Cấm scrape site có ToS cấm scrape. Trước khi thêm nguồn mới phải hỏi tôi.
- Cấm bịa dữ liệu mẫu trông giống thật. Mock/sample data phải có nhãn rõ ràng
  cùng chỗ hiển thị (xem `cashoutEngine.js: PRESET_*` + pill "Dữ liệu mẫu
  (preset)" làm chuẩn) — không vẽ ra thứ trông như biểu đồ/số liệu thật mà
  không có nhãn (bug thật đã xảy ra: `worldEngine.js` từng có sparkline giả
  sinh bằng PRNG seed theo mã thị trường, đã bị gỡ). Bug thứ hai cùng loại:
  `dashboardEngine.js: loadBreadth()` từng âm thầm dùng lại dữ liệu mẫu PRNG
  seed cố định cho cột tăng/giảm/ADR khi `quality.breadth` stale nhiều ngày
  liền — vì seed cố định + mảng ngày neo theo "hôm nay", tỷ lệ ADR mấy phiên
  gần nhất bị đứng yên ở đúng một số suốt cả tháng (đã fix 2026-09-05: khi
  breadth không phải `live`/`proxy`, hiển thị `—`, không dùng số mẫu nữa).
- Cấm sinh nội dung khuyến nghị mua/bán ("nên mua", "giá mục tiêu"). Hệ thống
  mô tả dữ liệu, không tư vấn.
- Cấm sửa `public/data/live.json`, `regime.json`, `sector-flows.json`,
  `cashout-vn.json`, `vn-bond-auctions.jsonl`, `world-live.json`, `vn-insight.json`,
  `last-run.json`, `public/data/history/*.jsonl` bằng tay — đây là output do
  script sinh ra tự động, sửa tay sẽ bị ghi đè ở lần chạy sau và có thể phá vỡ
  tính idempotent. Sửa logic trong script, không sửa file kết quả.
  (`grok-fill.json`, `grok-fill.example.json`, `events.json`,
  `econ-actuals.json`, `news.json` — các file này *được* sửa tay theo thiết kế, xem
  automation/README.md.)
  `news.json` nằm ở danh sách được phép vì **không script nào sinh ra nó**:
  pipeline chỉ ghi `news-raw.json`, còn bước chọn lọc/biên tập sang `news.json`
  do người hoặc agent `vn-news-tagger` làm. Hai danh sách trên phải liệt kê
  **mọi** file trong `public/data/` — một file không có tên ở cả hai bên là một
  câu hỏi mở, và lần sau sẽ có người đoán sai.

---

## 2. Tech stack thật

| Tầng | Công nghệ |
|---|---|
| Frontend | Vite 5 + React 18, **JavaScript thuần** (không TypeScript), CSS thường (không Tailwind) |
| Data store | Không có DB — `public/data/*.json` + `public/data/history/*.jsonl`, commit thẳng vào git |
| Pipeline chính | Python 3.12 **stdlib-only** (`automation/daily_update.py`) — cố tình không phụ thuộc gì để chạy nhẹ trong CI |
| Pipeline phụ | Python 3.12 + `pandas` + `vnstock` (`automation/sector_flows/`, `automation/vn_cashout/`, `automation/vn_regime/` — cái cuối lại stdlib-only, chỉ đọc JSON 2 cái kia ghi ra) |
| LLM fill tuỳ chọn | xAI Grok API (`XAI_API_KEY`), chỉ điền field free API không có, luôn gắn `quality=proxy` |
| Scheduler | GitHub Actions `schedule:` cron (không APScheduler/Prefect) |
| Hosting | GitHub Pages (branch `gh-pages`), build tĩnh — không server runtime |
| Test | **Chưa có** test framework nào (không pytest, không Vitest/Playwright) — xem §5, §6 |

Không thêm dependency mới (npm hay pip) nếu chưa hỏi tôi — pipeline chính cố
tình giữ stdlib-only, thêm dependency vào đó là quyết định có chủ đích, không
phải mặc định.

---

## 3. Kiến trúc thư mục thật

```
src/
  dashboard/      Trang chính (index.html) — dashboardEngine.js (DOM-manipulation, port từ script gốc)
  world/          Trang Thế giới (the-gioi.html) — worldEngine.js + TradingView widget embed
  history/        Trang Lịch sử & Tương quan (lich-su.html) — historyEngine.js, overlay index-100 + Pearson correlation
  cashout/        Trang Dòng tiền & Cashout — cashoutEngine.js
  sectorFlows/    Trang Dòng tiền ngành — sectorFlowsEngine.js (RRG quadrant)
  regime/         Trang Regime Dashboard — RegimeApp.jsx
  guide/          Trang Hướng dẫn đọc (huong-dan-doc.html) — GuideApp.jsx (React thuần, không engine)
  components/     Layout dùng chung (header, nav, ticker tape, footer)
  hooks/          useJsonFetch (nền chung) + useLiveMarketData/useHistory/useCashout/useSectorFlows/useRegime/useNews
  data/           worldInstruments.js — danh sách tĩnh + mã TradingView cho trang Thế giới
public/data/      Output của automation — KHÔNG sửa tay (xem §1.5)
automation/       Script fetch/tính toán — xem automation/README.md cho ops guide đầy đủ
.github/workflows/
  data-update.yml       Pipeline chính (stdlib-only) — live.json, history/*.jsonl, news-raw.json, world-live.json, vn-bond-auctions.jsonl
  vn-vnstock-update.yml Pipeline phụ (cần vnstock) — sector-flows.json, cashout-vn.json, regime.json
  deploy.yml             npm run build → publish dist/ → gh-pages
  backfill-history.yml   Manual-only — backfill lịch sử từ nguồn free
```

Mỗi trang HTML (`index.html`, `the-gioi.html`, `lich-su.html`,
`dong-tien-cashout.html`, `dong-tien-nganh.html`, `buc-tranh-thi-truong.html`,
`huong-dan-doc.html` — **7 trang**, xem `vite.config.js` làm nguồn sự thật)
là một Vite build entry riêng, mount React root riêng — giữ URL ổn định, chia
sẻ components/hooks/styles chung.

**Quy tắc phụ thuộc**: `src/**` (frontend) chỉ đọc `public/data/*.json` qua
`fetch()` — không import gì từ `automation/`. `automation/**` không import gì
từ `src/`. Hai phía chỉ nối với nhau qua schema JSON, không qua code dùng chung.

---

## 4. Lệnh

```powershell
npm install
npm run dev       # http://localhost:5173 — đọc public/data/*.json hiện có (bản đã commit hoặc bản pipeline mới chạy)
npm run build     # outputs dist/ — PHẢI chạy sạch trước khi báo xong việc sửa frontend
npm run preview   # serve bản build production tại local

py automation/daily_update.py            # pipeline chính: free API + Grok nếu có XAI_API_KEY
py automation/daily_update.py --no-grok  # chỉ free API
py automation/sector_flows/fetch_sector_flows.py   # cần: pip install -r automation/sector_flows/requirements.txt
py automation/vn_cashout/fetch_cashout_data.py      # cần: pip install -r automation/vn_cashout/requirements.txt
py automation/vn_regime/compute_regime.py           # stdlib-only, đọc lại JSON 2 script trên vừa ghi
py automation/backfill_history.py --years 2         # idempotent, chạy lại bao nhiêu lần cũng an toàn
```

Không có `make test`/`make lint` — xem §6 cho định nghĩa "xong" thật.

---

## 5. Cách làm việc với tôi

0. **Trước khi thêm/sửa một trang, một hook, hay bất cứ thứ gì dưới `src/`:
   đọc skill `vn-dashboard-engineering`** (`.claude/skills/vn-dashboard-engineering/SKILL.md`).
   File này nói *luật*; skill đó nói *cơ chế* — 7 entry Vite, hai khuôn mẫu
   trang, bẫy base path khi deploy, hợp đồng JSON, quy trình 9 bước thêm
   trang. Trình tự bắt buộc: **phân tích cấu trúc → xác minh bằng grep → mới
   code**. Có sẵn hai agent làm đúng trình tự đó: `vn-page-builder` (dựng/sửa
   trang) và `vn-frontend-reviewer` (rà soát) — xem `.claude/agents/README.md`.

0b. **Trước khi đi tìm nguồn cho một trường dữ liệu mới: đọc skill
   `market-data-sources`** (`.claude/skills/market-data-sources/SKILL.md`).
   Nó ghi endpoint nào đã kiểm chứng là chạy, endpoint nào đã LOẠI và vì sao
   (VBMA sau Cloudflare, TCBS 403, FireAnt 401, vnstock không có trái phiếu…),
   cùng cạm bẫy từng nguồn — dòng tổng hợp lẫn dòng chi tiết, sai bậc đơn vị,
   phân trang dừng sớm, ô trống nghĩa là "trượt" chứ không phải 0. Thêm nguồn
   mới thì cập nhật lại file đó, kèm chỉ thị `robots.txt` thật.

1. **Plan mode cho: đổi công thức tài chính (regime scores, RRG, ADR, yield
   curve...), đổi schema JSON đang được nhiều trang đọc, hoặc >3 file.** Trình
   bày: thay đổi gì, ảnh hưởng gì, 2 phương án + đánh đổi. Chờ tôi duyệt. Fix
   bug nhỏ, rõ ràng, khoanh vùng 1-2 file thì cứ làm thẳng, không cần Plan mode.
2. Làm từng lát mỏng, chạy được. Không dựng nhiều file rồi mới báo cáo.
3. Chưa có test framework — thay "viết test trước", **chạy thử thật** trước
   khi báo xong: `npx vite build` sạch cho thay đổi frontend, `py
   automation/<script>.py` chạy không lỗi và output JSON hợp lệ cho thay đổi
   pipeline. Nếu sau này quyết định thêm Vitest/pytest, đó là quyết định lớn —
   hỏi tôi trước, đừng tự thêm dependency test.
4. Khi thêm chỉ báo/công thức mới: ghi rõ công thức, quy ước (VD: `RS_WINDOW`,
   ngưỡng band `healthy/caution/danger`), và giới hạn (chưa calibrate bằng
   backtest thật) ngay trong docstring/comment cạnh code — xem
   `compute_regime.py`, `fetch_sector_flows.py` làm chuẩn về mức độ minh bạch
   cần có.
5. Khi vendor API trả dữ liệu bất thường (giá âm, volume=0 giữa phiên, gap lớn
   bất thường): **không tự động sửa/loại bỏ**. Set `quality` phù hợp
   (`stale`/`missing`) hoặc giữ nguyên số cũ (`prev.get(...)` pattern đã dùng
   khắp `daily_update.py`), ghi log rõ, và báo tôi — không tự đoán số đúng.
6. Kết thúc mỗi task: chạy `npx vite build` (nếu đổi frontend) và/hoặc chạy thử
   script Python liên quan, tóm tắt trong 5 dòng, nêu rõ phần nào bạn chưa chắc
   chắn.

---

## 6. Định nghĩa "Xong"

- [ ] `npx vite build` sạch (không lỗi, không warning mới) nếu có đổi `src/`
- [ ] Script Python liên quan chạy thử thành công, output JSON đúng schema cũ
      (không xoá field trang khác đang đọc)
- [ ] Số liệu mới có `quality`/nhãn tin cậy + `as of` timestamp + nguồn hiển
      thị được trên UI (không phải chỉ có trong JSON mà không render ra)
- [ ] Thiếu dữ liệu hiển thị `—`, không hiển thị `0`/`null`/`NaN` trần trụi
- [ ] Không ghi đè/xoá dòng lịch sử của ngày khác trong `*.jsonl`
- [ ] Không có secret trong git diff (`XAI_API_KEY` và tương tự chỉ qua env/secret)
- [ ] Không sửa tay file trong `public/data/` (trừ `grok-fill.json`,
      `grok-fill.example.json`, `events.json`, `econ-actuals.json` — các file
      này *được* sửa tay theo thiết kế)

---

## Lớp chung `stock-shared`

Luật đúng cho mọi thị trường và mọi stack **không nằm trong repo này** — chúng ở
`Stock/stock-shared`, đồng bộ sang `~/.claude/skills/` bằng
`bash stock-shared/scripts/sync.sh`.

| skill chung | dùng khi |
|---|---|
| `data-integrity-pillars` | **luôn** — trước mọi việc đụng tới một con số |
| `financial-analyst-review` | soi định giá / tỷ lệ / báo cáo tài chính |
| `financial-data-verification` | vừa lấy số từ báo cáo hoặc vendor |
| `jev-judgments` | trước khi gọi Jev từ bất kỳ đâu |
| `market-data-sources` | trước khi đi tìm nguồn cho một trường dữ liệu mới |

Thiếu skill nào → **DỪNG và chạy sync**, đừng làm theo trí nhớ.

Soát pillars bất kỳ lúc nào:
```bash
py ../stock-shared/tools/pillar_guard.py --repo .
```
Hai tầng: grep tất định, rồi Jev cho câu khuyến nghị diễn đạt vòng mà grep không
bắt được. Miễn trừ phải nêu lý do: `// pillar-ok: <vì sao>`.
