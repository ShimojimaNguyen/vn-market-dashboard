---
name: vn-dashboard-engineering
description: Chuẩn kỹ thuật phần mềm và kiến trúc hệ thống của VN Market Dashboard. Bắt buộc đọc TRƯỚC khi thêm/sửa một trang, một hook, một file JSON dữ liệu, hoặc bất cứ thứ gì dưới src/ và automation/. Trả lời "trang này gắn vào đâu", "hợp đồng dữ liệu là gì", "cái bẫy nào đã sập rồi".
---

# VN Market Dashboard — kiến trúc & chuẩn xây trang

> **Đọc `data-integrity-pillars` trước file này.** Đó là luật chung cho mọi repo
> thị trường trong `Stock/` — `—` chứ không `0`, kỳ dữ liệu + nguồn, nhãn tin
> cậy, chống look-ahead, ghi idempotent. File bạn đang đọc chỉ nói **cơ chế thực
> thi những luật đó trên stack này**. Skill chung nằm ở repo `stock-shared`;
> thiếu thì chạy `bash stock-shared/scripts/sync.sh`.

CLAUDE.md nói **luật** (cấm gì, phải có gì). File này nói **cơ chế** — hệ thống
thật nối với nhau bằng cách nào, và chỗ nào đã từng gãy. Khi hai file mâu thuẫn,
CLAUDE.md thắng về luật; file này thắng về mô tả hiện trạng code.

**Trình tự bắt buộc: đọc cấu trúc → xác minh bằng grep → rồi mới code.**
Không viết dòng nào trước khi trả lời được 4 câu ở §7.

---

## 1. Hình dạng thật của hệ thống

Không có server runtime. Không có DB. Không có API. Chỉ có ba tầng nối bằng
**file JSON tĩnh**:

```
automation/*.py          →  public/data/*.json      →  src/**  (browser)
(GitHub Actions cron)       (commit thẳng vào git)      (fetch tương đối)
     ghi                          hợp đồng                   đọc
```

Ranh giới cứng: `src/**` không import gì từ `automation/`, và ngược lại. Hai bên
chỉ biết nhau qua **khoá JSON**. Đổi tên một khoá = đổi hợp đồng giữa hai hệ
thống không cùng ngôn ngữ, không có compiler nào bắt lỗi giúp — grep cả hai phía.

### Deploy
`vite build` → `dist/` → branch `gh-pages` → `https://tarzanjp.github.io/vn-market-dashboard/`.
Đây là **project page**, không phải root page. Hệ quả nằm ở §3, và là cái bẫy
số 1 của cả hệ thống.

---

## 2. Bảy entry, hai khuôn mẫu trang

`vite.config.js` khai báo **7** entry (CLAUDE.md §3 vẫn ghi 6 — thiếu
`huong-dan-doc.html`; tin `vite.config.js`, không tin CLAUDE.md ở điểm này):

| HTML | main-*.jsx | thư mục | khuôn mẫu | nav key |
|---|---|---|---|---|
| `buc-tranh-thi-truong.html` | `main-regime.jsx` | `src/regime/` | **A** React thuần | `regime` |
| `index.html` | `main-dashboard.jsx` | `src/dashboard/` | **B** vỏ + engine | `dashboard` |
| `the-gioi.html` | `main-world.jsx` | `src/world/` | **B** | `world` |
| `lich-su.html` | `main-history.jsx` | `src/history/` | **B** | `history` |
| `dong-tien-nganh.html` | `main-sector-flows.jsx` | `src/sectorFlows/` | **B** | `sectorFlows` |
| `dong-tien-cashout.html` | `main-cashout.jsx` | `src/cashout/` | **B** | `cashout` |
| `huong-dan-doc.html` | `main-guide.jsx` | `src/guide/` | **A** | `guide` |

Mỗi entry là một React root độc lập mount vào `#root`. Không có router. URL ổn
định vì mỗi trang là một file HTML thật.

### Khuôn mẫu A — React thuần (`regime`, `guide`)
Component render toàn bộ. Dùng khi nội dung là bảng/thẻ/chữ, state đơn giản.
**Đây là mặc định cho trang mới.**

### Khuôn mẫu B — vỏ React + engine mệnh lệnh (5 trang còn lại)
`XxxApp.jsx` render **khung DOM rỗng có `id`**, rồi `useEffect` gọi
`initXxx(data)` từ `xxxEngine.js`, engine tự `document.getElementById` và vẽ
SVG bằng tay. Đây là di sản port từ script gốc, **không phải kiểu mẫu để bắt
chước**. Chỉ dùng khuôn B khi cần vẽ SVG chart thủ công (không có thư viện
chart trong dự án này, và không được thêm nếu chưa hỏi).

Ràng buộc sống còn của khuôn B — engine **chỉ chạy đúng một lần**:

```js
const initedRef = useRef(false);
useEffect(() => {
  if (status !== "ready" || initedRef.current) return;   // HistoryApp.jsx:15
  initedRef.current = true;
  initHistory(rows, events);
}, [status, rows, events]);
```

Nghĩa là: dữ liệu về **sau** lần init đầu tiên sẽ **không** được vẽ lại. Nếu
trang mới của bạn cần cập nhật khi dữ liệu đổi (nhiều nguồn về lệch nhịp,
polling, người dùng đổi bộ lọc từ React) → **dùng khuôn A**, đừng cố sửa engine.

Lưu ý bất nhất đã có: `WorldIndicesApp.jsx:13` init mà **không chờ** `status`,
khác 4 trang kia. Đừng copy trang world làm mẫu.

---

## 3. Bẫy số 1: đường dẫn fetch phải TƯƠNG ĐỐI

```js
// ĐÚNG — chạy cả dev lẫn prod
const { data } = useJsonFetch("data/regime.json");
fetch(`data/history/regime-${year}.jsonl`, { cache: "no-store" });

// SAI — dev chạy ngon, prod 404 câm lặng
useJsonFetch("/data/regime.json");
```

`vite.config.js` đặt `base: "/vn-market-dashboard/"` khi build và `"/"` khi dev.
Đường dẫn tuyệt đối `/data/...` giải ra `tarzanjp.github.io/data/...` — sai gốc,
404, và `useJsonFetch` biến nó thành `status: "error"`, trang hiện trắng. Bug này
**không thể phát hiện bằng `npm run dev`**; chỉ `npm run build && npm run preview`
mới lộ.

Hiện tại toàn bộ `src/` đang sạch bẫy này (đã grep). Giữ nguyên như vậy:

```bash
grep -rn 'fetch("/data\|fetch(`/data\|"/data/' src/     # phải trả về rỗng
```

Tương tự với `href` trong `NavTabs.jsx`: dùng `href="the-gioi.html"`, không dùng
`href="/the-gioi.html"`.

---

## 4. Tầng dữ liệu: `useJsonFetch` và hợp đồng JSON

`src/hooks/useJsonFetch.js` là nền duy nhất. 44 dòng, `status: "loading" | "ready" | "error"`,
có `cancelled` guard, `cache: "no-store"`.

**Nó cố tình không quyết định thay bạn** khi fetch hỏng. Hook bọc ngoài phải
quyết định rõ ràng, và hai kiểu đều đã tồn tại:
- `useNews.js` — coi lỗi là "ready với dữ liệu rỗng" (tin tức thiếu không chặn trang)
- `useLiveMarketData.js` — giữ nguyên `"error"` (không có giá thì không có trang)

Trang mới **phải chọn một** và ghi lý do vào docstring của hook. Không để mặc định.

Hook cho một trang mới đặt tại `src/hooks/useXxx.js`, mỏng:

```js
import { useJsonFetch } from "./useJsonFetch.js";
/** Fetch public/data/xxx.json — <sinh bởi automation/nào>. Lỗi fetch coi là
    <ready-rỗng | error> vì <lý do hiển thị>. */
export function useXxx() {
  const { data, status } = useJsonFetch("data/xxx.json");
  return { xxx: data, status };
}
```

Nếu cần đọc thêm JSONL lịch sử: xem `useRegime.js:17-49` làm mẫu — nó là effect
riêng vì `useJsonFetch` không diễn đạt được JSONL, và **thiếu file lịch sử không
bị coi là lỗi** (engine mới bắt đầu tích luỹ).

### Hợp đồng phía ghi
Nếu trang mới cần field mới, field đó phải do `automation/*.py` sinh ra, kèm
`quality` flag (`daily_update.py:710-742` là mẫu chuẩn), và **không được xoá
field trang khác đang đọc**. Trước khi đổi khoá JSON:

```bash
grep -rn "<tenKhoa>" src/ automation/ public/data/*.json | head -30
```

---

## 5. Hiển thị: ba thứ không được quên

### 5.1 `—`, không bao giờ `0`
Đây là luật CLAUDE.md §1.4 và đã sập thật hai lần (`m: 0.0` render "+0,00";
`loadBreadth()` dùng lại số mẫu PRNG seed cố định). Cơ chế: helper `nf()`.

**Cảnh báo — `nf()` bị định nghĩa lại 3 lần, không đồng nghĩa nhau:**

| Nơi | Chặn `null` | Chặn `NaN` |
|---|---|---|
| `historyEngine.js:36` | có | **có** |
| `dashboardEngine.js:336` | có | có |
| `worldEngine.js:19` | có | **không** — `NaN.toLocaleString()` ra `"NaN"` |

Trang mới: copy bản `historyEngine.js:36`, **đừng** copy bản world. Và đừng viết
bản thứ tư khác nghĩa nữa.

Cạm bẫy JS đi kèm: `null < 80` là `true`. Mọi so sánh ngưỡng phải chặn null
trước, theo mẫu đã có trong `dashboardEngine.js: buildTape()`:
`mbr == null ? "—" : ...`. Và `?? 0` là cách vô hiệu hoá `nf()` — cấm.

### 5.2 `as of` + nguồn, hiển thị được trên UI
Mọi con số phải kèm `generatedAtIct` render ra màn hình. Mẫu ngắn nhất —
`RegimeApp.jsx:187`:

```jsx
<p className="rg-quality">{regime.dataQuality?.note} Sinh lúc {regime.generatedAtIct} ICT.</p>
```

Có `generatedAtIct` trong JSON mà không render ở đâu = lỗi (đã từng xảy ra ở
trang Thế giới).

### 5.3 Nhãn độ tin cậy `dtag`
Bốn class, ứng với `quality` flag:

| class | chữ hiển thị | ứng với |
|---|---|---|
| `dtag-live` | (không nhãn / Live) | `quality: live` |
| `dtag-proxy` | `Proxy` | `quality: proxy` |
| `dtag-sample` | `Dữ liệu mẫu (preset)` | preset/sample |
| `dtag-est` | `Nội suy (e)` | nội suy |

**Bẫy CSS**: `.dtag` được định nghĩa **hai lần** — `dashboard.css:251-259` (đủ 4
class) và `history.css:56-60` (chỉ có `dtag-proxy`). Không nằm trong
`styles/tokens.css` hay `layout.css`. Trang mới dùng `dtag` mà chỉ import 2 file
style chung sẽ ra **nhãn không có style**. Hoặc tự khai trong `src/<trang>/<trang>.css`,
hoặc (tốt hơn, nếu đang sửa nhiều trang) đề xuất nâng `.dtag` lên `layout.css` —
nhưng đó là đổi >3 file, cần Plan mode.

### 5.4 Disclaimer
Mỗi trang có `<Footer>` với câu "dữ liệu tham khảo, không phải khuyến nghị đầu tư".
Giữ nguyên giọng văn đã có (`HistoryApp.jsx:82`, `SectorFlowsApp.jsx:130`).

---

## 6. Style

- `src/styles/tokens.css` — biến CSS (`--tang`, `--giam`, `--dim`, `--fill`,
  `--blue`, `--us`, `--vn`…). Dùng biến, **đừng hardcode mã màu**.
- `src/styles/layout.css` — khung chung (`.wrap`, `.panel`, `.p-hd`, `.p-body`,
  `.pill`, `.seg`, `.nav`).
- `src/<trang>/<trang>.css` — riêng của trang.

Thứ tự import trong App component, cố định:
```js
import "../styles/tokens.css";
import "../styles/layout.css";
import "./<trang>.css";
```

Không Tailwind. Không CSS-in-JS. Không TypeScript.

---

## 7. Bốn câu phải trả lời trước khi gõ dòng code đầu tiên

Nằm ở `data-integrity-pillars` § "Trước khi gõ dòng code đầu tiên" — giống hệt
cho mọi repo, nên giữ một bản duy nhất ở đó.

Riêng repo này có thêm câu thứ năm: **khuôn A hay B?** Mặc định A. Chọn B chỉ
khi cần vẽ SVG thủ công, và chấp nhận "chỉ vẽ một lần" (xem §2).

---

## 8. Quy trình thêm một TRANG mới (9 bước, đủ và đúng thứ tự)

Bỏ sót bước 2 hoặc 8 là kiểu lỗi hay gặp nhất: trang build ra nhưng không ai tới
được, hoặc tới được mà trắng trang trên prod.

1. **Dữ liệu trước.** Xác nhận `public/data/<x>.json` tồn tại và có `generatedAtIct`
   + `quality`. Chưa có thì làm phía `automation/` trước, đừng làm UI trước.
2. **`vite.config.js`** — thêm entry vào `build.rollupOptions.input`. Quên bước
   này thì file HTML không vào `dist/`, deploy xong ra 404.
3. **`<ten-trang>.html`** ở gốc repo — copy `buc-tranh-thi-truong.html`, đổi
   `<title>`, `<meta name="description">`, và `src="/src/main-<x>.jsx"`.
   (Đường dẫn script trong HTML *phải* là tuyệt đối `/src/...` — Vite viết lại
   nó lúc build; chỉ đường dẫn **runtime fetch/href** mới phải tương đối.)
4. **`src/main-<x>.jsx`** — 3 dòng, y hệt `main-regime.jsx`.
5. **`src/hooks/use<X>.js`** — bọc `useJsonFetch`, quyết định cách xử lỗi (§4).
6. **`src/<x>/<X>App.jsx`** — `SiteHeader active="<navKey>"` + `<main className="wrap">`
   + `<Footer>` disclaimer. Import style theo thứ tự §6.
7. **`src/<x>/<x>.css`**.
8. **`src/components/layout/NavTabs.jsx`** — thêm `<a href="<ten-trang>.html"
   aria-current={active === "<navKey>" ? "page" : undefined}>` + icon SVG 15×15
   `viewBox="0 0 16 16"`, `stroke="currentColor"`, `aria-hidden="true"`.
   `<navKey>` phải khớp chính xác prop `active` ở bước 6.
9. **Kiểm chứng** — §9. Không báo xong trước khi chạy.

---

## 9. Định nghĩa "xong" cho thay đổi frontend

```bash
npm run build          # phải sạch, không warning mới
npm run preview        # BẮT BUỘC — dev server không lộ bẫy base path
grep -rn 'fetch("/data\|fetch(`/data' src/     # phải rỗng
```

Trên bản preview, tự kiểm bằng mắt:
- [ ] Trang mới mở được từ nav của **mọi** trang khác, và nav của nó tự sáng
- [ ] Có `as of` / `generatedAtIct` hiển thị được, không chỉ nằm trong JSON
- [ ] Field thiếu ra `—`, không ra `0` / `null` / `NaN` / `undefined`
- [ ] Console không lỗi
- [ ] 6 trang cũ vẫn chạy (sửa `NavTabs.jsx` là đụng cả 7)

Với thay đổi `automation/`: chạy thật script đó, mở JSON ra xem, và xác nhận
không mất field nào trang khác đang đọc.

**Chưa có test framework** (không pytest/Vitest/Playwright). "Chạy thử thật"
thay cho test. Muốn thêm framework test → quyết định lớn, phải hỏi.

---

## 10. Ranh giới không được vượt

- Không thêm dependency npm/pip nếu chưa hỏi. `automation/daily_update.py` cố ý
  stdlib-only.
- Không gọi API vendor từ `src/**`. Frontend chỉ `fetch()` file tĩnh.
- Không sửa tay `public/data/live.json`, `regime.json`, `sector-flows.json`,
  `cashout-vn.json`, `history/*.jsonl`. (Được sửa tay: `grok-fill.json`,
  `grok-fill.example.json`, `events.json`, `econ-actuals.json`.)
- Không sinh nội dung khuyến nghị mua/bán.
- Không đụng `.claude/agents/*jp*` hay `jp_value_screen_graph/` — đó là hệ thống
  nghiên cứu cổ phiếu Nhật ở nhờ repo này, không liên quan dashboard.

---

## 11. Sai lầm đã xảy ra thật trong repo này

Ghi lại để nhận diện nhanh, không phải để trách:

| Đã xảy ra | Dấu hiệu | Cách chặn |
|---|---|---|
| Sparkline giả sinh bằng PRNG seed theo mã (`worldEngine.js`) | biểu đồ trông thật, không có nhãn | đã gỡ; cấm mọi số sinh ngẫu nhiên hiển thị như thật |
| `loadBreadth()` dùng lại số mẫu seed cố định `20260807` khi breadth stale | cột ADR 6 phiên đứng yên đúng một số suốt tháng | fix 2026-09-05: không `live`/`proxy` thì hiện `—` |
| `m: 0.0, yr: 0.0` hardcode | bảng lợi suất hiện "+0,00" giả | field chưa tính được để `None`, không `0` |
| `generatedAtIct` có trong JSON nhưng không render (trang Thế giới) | không ai biết số cũ bao lâu | §5.2 |

Điểm chung của cả bốn: **giá trị giả trông hợp lý hơn ô trống**, nên không ai
soi ra. Đó là lý do CLAUDE.md nói "một con số sai tệ hơn một trang trắng".

---

## 12. Nợ kỹ thuật đã biết (đừng nhân bản thêm)

- `nf()` 3 bản, `.dtag` CSS 2 bản, `initedRef` 5 bản (1 bản lệch chuẩn ở world).
- CLAUDE.md §3 liệt kê 6 trang, thực tế 7.
- 5 engine mệnh lệnh ~3.200 dòng thao tác DOM trực tiếp bên trong app React.
- Không có test, không có lint, không có type.

Gặp những thứ này khi làm việc khác: **ghi nhận, báo, đừng tiện tay dọn** — dọn
là đổi >3 file, cần Plan mode và sự đồng ý.
