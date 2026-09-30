import { attachStaleTag } from "../lib/freshness.js";

/* ============================================================
   Market Dashboard engine — ported near-verbatim from the legacy
   index.html inline <script>. Kept as plain DOM-manipulating code
   (hand-rolled SVG charts, tooltips, crosshairs) rather than
   rewritten as idiomatic React state, to avoid introducing visual
   or behavioral regressions in logic that already works.
   MarketDashboardApp.jsx renders the static shell (ids below) and
   calls initMarketDashboard(LIVE) once after the shell is mounted
   and live data has been fetched.
   ============================================================ */
export function initMarketDashboard(LIVE, HISTORY, NEWS_DATA, ECON_ACTUALS) {
  let ASOF = (LIVE && LIVE.asof) ? LIVE.asof : "2026-08-07";
  const WINDOWS = [25, 15, 10, 6]; // các chu kỳ tính hệ số ADR (phiên)

  /* Khung KỲ HẠN, không phải số liệu. Chỉ giữ t/x để mọi kỳ hạn luôn có một
     dòng trong bảng và VN[3] không undefined; giá trị để null → nf() render "—".

     Trước đây hai bảng này chứa lợi suất cứng (VN: 3,08 / 3,79 / 4,08 / 4,54 /
     4,84). Vì quality.vnYields = "missing" suốt 161/170 ngày và chưa từng
     "live", cả bảng lợi suất VN, nửa VN của đường cong và phần spread VN−Mỹ
     thực chất vẽ từ 5 hằng số nướng lúc viết file — người xem đọc 4,54% như
     lợi suất 10 năm hiện hành. Thiếu số thì để trống (CLAUDE.md §0, §1.4). */
  const YIELD_TENORS = [
    { t: "1 năm", x: 1 }, { t: "3 năm", x: 3 }, { t: "5 năm", x: 5 },
    { t: "10 năm", x: 10 }, { t: "30 năm", x: 30 },
  ];
  const EMPTY_TENOR = { y: null, d: null, m: null, yr: null, est: false, src: "missing" };
  const US_YIELD_FALLBACK = YIELD_TENORS.map(t => ({ ...t, ...EMPTY_TENOR }));
  const VN_YIELD_FALLBACK = YIELD_TENORS.map(t => ({ ...t, ...EMPTY_TENOR }));

  function normalizeYields(partial, fallback, srcLabel) {
    const byX = {};
    (partial || []).forEach(r => {
      if (r && r.x != null && r.y != null && !Number.isNaN(+r.y))
        byX[+r.x] = {
          t: r.t, y: +r.y,
          d: r.d == null ? null : +r.d,
          m: r.m == null ? null : +r.m,
          yr: r.yr == null ? null : +r.yr,
          x: +r.x, est: !!r.est,
          asof: r.asof || null, auction: r.auction || null,
        };
    });
    return fallback.map(fb => {
      if (byX[fb.x]) return Object.assign({}, fb, byX[fb.x], { t: fb.t, src: srcLabel || "live" });
      // Thiếu kỳ hạn → KHÔNG thay bằng số nào. Dòng vẫn tồn tại để giữ khung
      // bảng, nhưng mọi giá trị là null và render thành "—".
      return Object.assign({}, fb, EMPTY_TENOR);
    });
  }

  /* --- Lợi suất Kho bạc Mỹ (%) --- */
  function loadUSYields() {
    const raw = (LIVE && Array.isArray(LIVE.usYields) && LIVE.usYields.length)
      ? LIVE.usYields.map(r => ({ t: r.t, y: r.y, d: r.d ?? null, m: r.m ?? null, yr: r.yr ?? null, x: r.x, est: !!r.est }))
      : null;
    return normalizeYields(raw, US_YIELD_FALLBACK);
  }

  /* --- Lợi suất TPCP Việt Nam (%) --- */
  function loadVNYields() {
    // Nguồn là lãi suất TRÚNG THẦU sơ cấp của Kho bạc Nhà nước (đấu thầu HNX),
    // không phải đường cong thứ cấp từng phiên: nó chỉ đổi vào ngày có đấu
    // thầu, và mỗi kỳ hạn mang ngày riêng của nó. Vì thế src = "proxy" chứ
    // không phải "live", và mỗi dòng giữ asof riêng để bảng nói được kỳ hạn này
    // chốt từ bao giờ — dùng chung một ngày cho cả bảng là sai.
    const q = (LIVE && LIVE.quality) ? LIVE.quality.vnYields : null;
    const src = q === "live" ? "live" : q === "proxy" ? "proxy" : null;
    const raw = (LIVE && Array.isArray(LIVE.vnYields) && LIVE.vnYields.length)
      ? LIVE.vnYields.map(r => ({
          t: r.t, y: r.y, d: r.d ?? null, m: r.m ?? null, yr: r.yr ?? null,
          x: r.x, est: !!r.est, asof: r.asof || null, auction: r.auction || null,
        }))
      : null;
    return normalizeYields(raw, VN_YIELD_FALLBACK, src);
  }

  /* Ngày nghỉ lễ HOSE — CHỈ dùng để dựng bộ khung ngày phiên cho chuỗi mẫu,
     không tham gia bất kỳ phép tính tài chính nào. Trước đây bảng này được
     chép cứng ở HAI hàm, dễ lệch nhau khi sửa một chỗ.

     GIỚI HẠN ĐÃ BIẾT — chỉ có 2026. Dự án không có thư viện lịch giao dịch
     (CLAUDE.md §1.2) và bảng này chưa được đối chiếu với nguồn chính thức nào.
     Rủi ro thật: bộ khung ngày của loadBreadth() là nơi lịch sử thật được merge
     vào (byDate.get(h.date)); nếu bảng đánh dấu nhầm một ngày HOSE có giao dịch
     là nghỉ lễ, dòng lịch sử của ngày đó KHÔNG có chỗ để gắn và bị bỏ im lặng.
     Vì thế loadBreadth() đếm số dòng lịch sử không gắn được và cảnh báo. */
  const VN_HOLIDAYS = new Set(["2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
    "2026-04-27", "2026-04-30", "2026-05-01", "2026-09-02"]);
  const HOLIDAY_YEARS = new Set(["2026"]);

  /* --- Dư nợ margin toàn thị trường (tỷ đồng) — CHUỖI HÀNG NGÀY --- */
  function loadMargin() {
    if (LIVE && LIVE.margin && Array.isArray(LIVE.margin.days) && LIVE.margin.days.length) {
      const days = LIVE.margin.days.map((d, i, arr) => {
        const debt = +d.debt || 0;
        let net = d.net;
        if (net == null && i > 0) net = debt - (+arr[i - 1].debt || 0);
        return { date: d.date, debt, net: +(net || 0) };
      });
      const brokers = (LIVE.margin.brokers || []).map(b => {
        const debt = +b.debt || 0;
        return {
          code: b.code || "?", name: b.name || b.code || "?",
          debt, d: b.d != null ? +b.d : null, room: b.room != null ? +b.room : null,
          share: b.share != null ? +b.share : null
        };
      });
      // nếu chỉ 1 điểm — nhân rộng chuỗi giả lập nhẹ để chart không trống (đánh dấu note)
      let daysOut = days.slice();
      if (daysOut.length === 1) {
        const last = daysOut[0];
        const seed = [];
        let v = last.debt * 0.92;
        for (let i = 0; i < 30; i++) {
          v = v + (last.debt - v) / Math.max(1, 30 - i) + (i === 29 ? 0 : 0);
          const dt = new Date(last.date + "T00:00:00Z");
          dt.setUTCDate(dt.getUTCDate() - (29 - i));
          while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) dt.setUTCDate(dt.getUTCDate() - 1);
          seed.push({ date: dt.toISOString().slice(0, 10), debt: Math.round(v), net: 0 });
        }
        seed[seed.length - 1] = last;
        for (let i = 1; i < seed.length; i++) seed[i].net = seed[i].debt - seed[i - 1].debt;
        daysOut = seed;
      }
      return {
        days: daysOut,
        brokers,
        asof: LIVE.margin.asof || LIVE.asof,
        freq: LIVE.margin.freq || "daily",
        sample: false,
        note: (LIVE.margin.note || "Snapshot auto (LIVE.margin).") + (days.length === 1 ? " · chuỗi chart nội suy từ 1 điểm as-of." : "")
      };
    }
    // Dùng lịch phiên giao dịch (khớp ROWS) — sinh mẫu nếu chưa có API
    let s = 20260807 >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };

    const dates = []; const cur = new Date(ASOF + "T00:00:00Z");
    while (dates.length < 260) {
      const k = cur.toISOString().slice(0, 10), w = cur.getUTCDay();
      if (w !== 0 && w !== 6 && !VN_HOLIDAYS.has(k)) dates.push(k);
      cur.setUTCDate(cur.getUTCDate() - 1);
    }
    dates.reverse();

    let level = 198200; // tỷ đồng, ~1 năm trước
    const days = [];
    for (let i = 0; i < dates.length; i++) {
      const shock = i === 40 ? -1800 : i === 95 ? -1200 : i === 180 ? -900 : 0;
      level = Math.max(155000, level + 95 + (rnd() - 0.48) * 420 + shock);
      days.push({ date: dates[i], debt: Math.round(level), net: 0 });
    }
    days[days.length - 1].debt = 247800;
    for (let i = 1; i < days.length; i++) days[i].net = days[i].debt - days[i - 1].debt;
    days[0].net = 0;

    const brokers = [
      { code: "SSI", name: "SSI", debt: 31200, d: 120, room: 18 },
      { code: "TCBS", name: "Techcom Securities", debt: 28900, d: 185, room: 12 },
      { code: "VND", name: "VNDirect", debt: 24100, d: -65, room: 22 },
      { code: "VPS", name: "VPS", debt: 21800, d: 95, room: 15 },
      { code: "HSC", name: "HSC", debt: 17600, d: 40, room: 28 },
      { code: "MBS", name: "MB Securities", debt: 15200, d: 70, room: 25 },
      { code: "FPTS", name: "FPT Securities", debt: 12800, d: -25, room: 31 },
      { code: "SHS", name: "Saigon–Hanoi Sec.", debt: 9800, d: 35, room: 35 },
      { code: "VCI", name: "Vietcap", debt: 9100, d: 20, room: 40 },
      { code: "CTS", name: "VietinBank Sec.", debt: 7600, d: -15, room: 38 }
    ];
    const last = days[days.length - 1].debt;
    brokers.forEach(b => { b.share = b.debt / last * 100; });

    return {
      days,
      brokers,
      asof: days[days.length - 1].date,
      freq: "daily",
      sample: true,
      note: "Số liệu MẪU, tần suất thiết kế hàng ngày. Nguồn thật có thể là báo cáo tuần — luôn hiển thị as-of. Thay loadMargin() bằng API sau ATC / báo cáo ngày/tuần."
    };
  }

  /* --- Cơ cấu cung cầu theo từng phiên (mới nhất ở cuối mảng) --- */
  function loadBreadth() {
    const N = 420;

    const dates = []; const cur = new Date(ASOF + "T00:00:00Z");
    while (dates.length < N) {
      const k = cur.toISOString().slice(0, 10), w = cur.getUTCDay();
      if (w !== 0 && w !== 6 && !VN_HOLIDAYS.has(k)) dates.push(k);
      cur.setUTCDate(cur.getUTCDate() - 1);
    }
    dates.reverse();

    let s = 20260807 >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const rets = []; let vol = 0.0088;
    for (let i = 0; i < N; i++) {
      vol = 0.90 * vol + 0.10 * 0.0088 + 0.0012 * Math.abs(g());
      const cyc = 0.0011 * Math.sin(i / 26) + 0.0007 * Math.sin(i / 61 + 1.2);
      rets.push(0.00075 + cyc + g() * vol);
    }
    rets[N - 1] = 0.0019; // phiên 07/08 thực tế +0,19%

    const px = [100]; for (let i = 1; i < N; i++) px.push(px[i - 1] * (1 + rets[i]));
    const scale = 1768.06 / px[N - 1];

    const rows = [];
    for (let i = 0; i < N; i++) {
      const r = rets[i], close = px[i] * scale;
      const total = Math.round(360 + g() * 9);
      const active = Math.round(total * clamp(0.80 + g() * 0.05, 0.66, 0.93));
      const share = clamp(0.50 + 18 * r + g() * 0.055, 0.06, 0.94);
      let adv = Math.round(active * share), dec = active - adv;
      let unch = total - adv - dec;
      const ceil = clamp(Math.round(2 + 520 * r + Math.abs(g()) * 2.2), 0, 42);
      const floor = clamp(Math.round(2 - 520 * r + Math.abs(g()) * 2.2), 0, 42);
      const s100 = clamp(share + g() * 0.05, 0.03, 0.97);
      const a100 = Math.round(92 * s100), d100 = Math.max(0, 92 - a100), u100 = 100 - a100 - d100;
      const s30 = clamp(share + g() * 0.075, 0.02, 0.98);
      const a30 = Math.round(28 * s30), d30 = Math.max(0, 28 - a30), u30 = 30 - a30 - d30;
      const gtgd = Math.round((15200 + Math.abs(r) * 230000 + g() * 2600) * clamp(1 + i / 900, 1, 1.4));

      rows.push({
        date: dates[i], close, chg: close * r / (1 + r), pct: r * 100,
        all: { a: adv, d: dec, u: unch, ceil, floor, total },
        vn100: { a: a100, d: d100, u: u100, total: 100 },
        vn30: { a: a30, d: d30, u: u30, total: 30 },
        gtgd: Math.max(6800, gtgd),
        real: false
      });
    }

    /* Ghép dữ liệu thật đã tích luỹ từ public/data/history/*.jsonl (xem useHistory()).
       Chỉ những phiên có sẵn số liệu thật mới được ghép đè lên chuỗi mẫu — các phiên
       trước khi hệ thống bắt đầu ghi nhận (trước 2026-08-07) vẫn giữ nguyên mẫu để
       biểu đồ không bị trống, và luôn được đánh dấu real:false để không hiển thị
       nhầm là số liệu thật. */
    const byDate = new Map(rows.map(r => [r.date, r]));
    // Đếm dòng lịch sử không gắn được vào bộ khung ngày. Nguyên nhân hầu
    // như luôn là VN_HOLIDAYS đánh dấu nhầm một ngày HOSE có giao dịch, hoặc
    // ASOF nằm ngoài năm mà bảng lễ phủ. Không cảnh báo thì phiên thật biến
    // mất khỏi mọi biểu đồ mà không ai biết.
    let unplaced = 0;
    (HISTORY || []).forEach(h => {
      if (h.vnIndex == null) return;
      const row = byDate.get(h.date);
      if (!row) { if (h.date >= dates[0]) unplaced++; return; }
      const pct = h.vnIndexPct != null ? h.vnIndexPct : 0;
      row.close = h.vnIndex;
      row.pct = pct;
      row.chg = row.close * (pct / 100) / (1 + pct / 100);
      row.real = true;
      const breadthReal = h.breadth && h.quality &&
        (h.quality.breadth === "live" || h.quality.breadth === "proxy");
      row.breadthReal = !!breadthReal;
      if (breadthReal) {
        const a = h.breadth.a || 0, d = h.breadth.d || 0, u = h.breadth.u || 0;
        const total = a + d + u || row.all.total;
        // ceil/floor: giữ số của chính phiên đó nếu nguồn có, còn KHÔNG thì để
        // null. Trước đây dòng này giữ lại ceil/floor của hàng mẫu PRNG cho một
        // phiên đã là thật — không dòng nào trong history/*.jsonl có hai trường
        // này (0/162 khi kiểm), nên cấu phần "Sức mạnh giá" của chỉ số Sợ hãi &
        // Tham lam thực chất đang chấm trên số ngẫu nhiên.
        row.all = {
          a, d, u, total,
          ceil: h.breadth.ceil != null ? h.breadth.ceil : null,
          floor: h.breadth.floor != null ? h.breadth.floor : null,
        };
        if (h.breadth.gtgd != null) row.gtgd = h.breadth.gtgd;
        // Chưa có nguồn thật cho riêng rổ VN100/VN30 — suy tỷ lệ từ tổng thị trường thật.
        const a100 = Math.round(a / total * 100), d100 = Math.round(d / total * 100);
        row.vn100 = { a: a100, d: d100, u: Math.max(0, 100 - a100 - d100), total: 100 };
        const a30 = Math.round(a / total * 30), d30 = Math.round(d / total * 30);
        row.vn30 = { a: a30, d: d30, u: Math.max(0, 30 - a30 - d30), total: 30 };
      }
    });

    if (unplaced) {
      console.warn(`[breadth] ${unplaced} phiên trong history/*.jsonl nằm trong khoảng `
        + `${dates[0]}…${dates[dates.length - 1]} nhưng không có chỗ trong bộ khung ngày `
        + `— kiểm tra VN_HOLIDAYS (hiện chỉ phủ ${[...HOLIDAY_YEARS].join(", ")}).`);
    }
    if (!HOLIDAY_YEARS.has(String(ASOF).slice(0, 4))) {
      console.warn(`[breadth] ASOF ${ASOF} nằm ngoài các năm VN_HOLIDAYS phủ `
        + `(${[...HOLIDAY_YEARS].join(", ")}) — ngày nghỉ lễ sẽ bị tính là phiên giao dịch.`);
    }

    const L = rows[N - 1];
    const liveBreadthQ = (LIVE && LIVE.quality) ? LIVE.quality.breadth : null;
    // Chỉ tin LIVE.breadth khi pipeline đánh dấu live/proxy (số mới) — "stale"
    // nghĩa là daily_update.py chỉ đang mang theo số của phiên trước vì chưa
    // có nguồn mới, không phải số liệu thật của hôm nay (xem merge_grok_fill).
    const br = (LIVE && LIVE.breadth && (liveBreadthQ === "live" || liveBreadthQ === "proxy")) ? LIVE.breadth : null;
    if (LIVE && LIVE.vnIndex && LIVE.vnIndex.price != null) {
      const vi = LIVE.vnIndex;
      L.date = vi.date || (br && br.date) || L.date;
      L.close = vi.price;
      // Thiếu % / thay đổi thì để null, KHÔNG mặc định 0: sgn()/cls() đã render
      // null thành "—" đúng cách, còn 0 render thành "+0,00" — một con số sai
      // trông như phiên đứng giá (đúng bug CLAUDE.md §1.4 lấy làm ví dụ).
      L.pct = vi.pct != null ? vi.pct : null;
      L.chg = vi.chg != null ? vi.chg : (vi.prev != null ? vi.price - vi.prev : null);
      L.real = true;
    } else if (!L.real) {
      // Trước đây gán cứng 1768,06 / +0,19% — một mức VN-Index trông thật, không
      // nhãn, hiện ở hero và bảng điện y như số thật. Không có giá thật thì
      // hiển thị "—" (CLAUDE.md §1.4/§1.5).
      L.close = null; L.pct = null; L.chg = null;
    }
    L.breadthReal = !!br;
    if (br) {
      // Không dùng br.date đè lên L.date nữa: breadth có thể là dữ liệu cũ
      // được mang theo nhiều ngày (xem daily_update.py merge_grok_fill) nên
      // ngày trong đó không đáng tin bằng ngày phiên thật lấy từ vi.date/ASOF
      // ở trên — nếu không, phiên hôm nay sẽ bị hiển thị trùng ngày với phiên
      // cũ mà breadth được lấy từ đó.
      if (br.gtgd != null) L.gtgd = br.gtgd;
      if (br.all) {
        // ceil/floor thiếu thì để null, không về 0: "0 mã trần / 0 mã sàn"
        // là một tuyên bố về phiên, khác hẳn "không biết".
        L.all = Object.assign({ a: 0, d: 0, u: 0, ceil: null, floor: null, total: 0 }, br.all);
        if (L.all.ceil == null) L.all.ceil = null;
        if (L.all.floor == null) L.all.floor = null;
        if (!L.all.total) L.all.total = (L.all.a || 0) + (L.all.d || 0) + (L.all.u || 0);
      }
      if (br.vn100) L.vn100 = Object.assign({ a: 0, d: 0, u: 0, total: 100 }, br.vn100);
      if (br.vn30) L.vn30 = Object.assign({ a: 0, d: 0, u: 0, total: 30 }, br.vn30);
      if (!br.vn100 && br.all) {
        const tot = Math.min(100, L.all.total || 100);
        const a = Math.round((L.all.a || 0) / (L.all.total || 1) * tot);
        const d = Math.round((L.all.d || 0) / (L.all.total || 1) * tot);
        L.vn100 = { a, d, u: Math.max(0, tot - a - d), total: 100 };
      }
    }
    // Không tự bịa số khi thiếu breadth thật (cấm theo CLAUDE.md §1.4/1.5) —
    // để null thay vì một bộ số "trông hợp lý" như trước đây.
    if (!L.all) L.all = { a: null, d: null, u: null, ceil: null, floor: null, total: null };
    else { if (L.all.ceil === undefined) L.all.ceil = null; if (L.all.floor === undefined) L.all.floor = null; }
    if (!L.vn100) L.vn100 = { a: null, d: null, u: null, total: null };
    if (!L.vn30) L.vn30 = { a: null, d: null, u: null, total: null };
    // Không gán cứng 18.100 tỷ khi thiếu GTGD — nf() render null thành "—".
    if (!L.gtgd) L.gtgd = null;
    if (Number.isNaN(+L.close)) L.close = null;
    if (Number.isNaN(+L.pct)) L.pct = null;
    if (Number.isNaN(+L.chg)) L.chg = null;

    /* Mọi phiên có giá thật (real:true) nhưng breadth không phải live/proxy
       (breadthReal:false) không được phép giữ lại bộ số mẫu (PRNG seed cố
       định ở trên) — vì seed cố định + mảng ngày luôn neo theo "hôm nay" khiến
       vài phiên gần nhất luôn ra đúng cùng một con số mỗi ngày (bug thật đã
       xảy ra: tỷ lệ ADR 6 phiên luôn = 148,3). Chỉ phiên "thuần mẫu" trước khi
       hệ thống ghi nhận (real:false, đã gắn nhãn "Mẫu" ở UI) mới được giữ số
       PRNG. */
    const hasBreadthData = row => !row.real || row.breadthReal;
    for (const row of rows) {
      if (!hasBreadthData(row)) {
        row.all = { a: null, d: null, u: null, ceil: null, floor: null, total: null };
        row.vn100 = { a: null, d: null, u: null, total: null };
        row.vn30 = { a: null, d: null, u: null, total: null };
      }
    }

    for (let i = 0; i < N; i++) {
      for (const k of ["vn30", "vn100", "all"]) {
        const o = {};
        for (const W of WINDOWS) {
          if (i < W - 1) { o[W] = null; continue; }
          let A = 0, D = 0, ok = true;
          for (let j = i - W + 1; j <= i; j++) {
            const rj = rows[j][k];
            if (rj.a == null || rj.d == null) { ok = false; break; }
            A += rj.a; D += rj.d;
          }
          o[W] = ok ? (D > 0 ? A / D * 100 : 200) : null;
        }
        rows[i][k].r = o;
        rows[i][k].ratio = o[25];
      }
    }
    return rows;
  }

  /* ============================================================
     2. TIỆN ÍCH
     ============================================================ */
  const US = loadUSYields(), VN = loadVNYields(), ROWS = loadBreadth(), MARGIN = loadMargin();
  const LAST = ROWS[ROWS.length - 1];
  const MG_LAST = (MARGIN.days && MARGIN.days.length) ? MARGIN.days[MARGIN.days.length - 1] : { date: ASOF, debt: 0, net: 0 };

  const nf = (v, d = 2) => {
    if (v == null || v === "" || (typeof v === "number" && Number.isNaN(v))) return "—";
    const n = Number(v);
    if (Number.isNaN(n)) return "—";
    return n.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const sgn = (v, d = 2) => {
    if (v == null || (typeof v === "number" && Number.isNaN(v))) return "—";
    const n = Number(v);
    if (Number.isNaN(n)) return "—";
    return (n > 0 ? "+" : n < 0 ? "−" : "") + nf(Math.abs(n), d);
  };
  const cls = v => {
    if (v == null || (typeof v === "number" && Number.isNaN(v))) return "flat";
    return v > 0 ? "up" : v < 0 ? "down" : "flat";
  };
  const dmy = iso => !iso ? "—" : String(iso).slice(5).replace("-", "/");
  const dmyF = iso => !iso ? "—" : String(iso).replace(/-/g, "/");
  const el = id => document.getElementById(id);
  const yieldAt = (arr, x) => {
    const hit = (arr || []).find(r => +r.x === +x);
    return hit && hit.y != null ? +hit.y : null;
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ============================================================
     3. ĐỒNG HỒ & TRẠNG THÁI PHIÊN
     ============================================================ */
  function sessionState() {
    const now = new Date();
    const ict = new Date(now.getTime() + (now.getTimezoneOffset() + 420) * 60000);
    const hh = ict.getHours(), mm = ict.getMinutes(), t = hh * 60 + mm, w = ict.getDay();
    const clock = String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":" + String(ict.getSeconds()).padStart(2, "0");
    let label = "Ngoài giờ giao dịch", live = false;
    if (w === 0 || w === 6) label = "Ngày nghỉ, không giao dịch";
    else if (t < 540) label = "Trước giờ giao dịch";
    else if (t < 555) { label = "Khớp lệnh định kỳ mở cửa (ATO)"; live = true; }
    else if (t < 690) { label = "Khớp lệnh liên tục đợt 1"; live = true; }
    else if (t < 780) label = "Nghỉ giữa phiên";
    else if (t < 870) { label = "Khớp lệnh liên tục đợt 2"; live = true; }
    else if (t < 885) { label = "Khớp lệnh định kỳ đóng cửa (ATC)"; live = true; }
    else if (t < 900) label = "Chờ dữ liệu chốt phiên";
    else label = "Đã đóng cửa · dữ liệu chốt phiên";
    return { clock, label, live };
  }
  function tickClock() {
    const s = sessionState();
    el("clock").textContent = s.clock;
    el("mkStatus").textContent = s.label;
    el("mkDot").className = "dot" + (s.live ? " live" : "");
  }
  tickClock(); setInterval(tickClock, 1000);
  el("asof").textContent = dmyF(ASOF);
  // Độ tươi, nói thành lời. as-of đúng mà không nói cũ bao nhiêu thì người xem
  // không phân biệt được dữ liệu hôm qua với dữ liệu ba tuần trước — cả hai
  // đều chỉ là một ngày tháng trông bình thường.
  attachStaleTag(el("asof").parentElement, LIVE && LIVE.asof);
  el("boardDate").textContent = "Phiên " + dmyF(LAST.date) + " · HOSE";

  /* ============================================================
     4. TICKER TAPE
     ============================================================ */
  /* Nhãn độ tin cậy đặt theo dữ liệu thật, không nướng cứng trong JSX.
     Trước đây 4 panel đều mang sẵn <span class="dtag dtag-sample">Mẫu</span>
     bất kể nguồn: bảng điện gắn "Mẫu" cả khi breadth là live, còn panel margin
     sẽ vẫn nói "Mẫu" kể cả sau khi nối được API. Nhãn sai làm người đọc học
     cách bỏ qua nhãn. */
  function setTag(id, text, kind) {
    const n = el(id);
    if (!n) return;
    n.textContent = text;
    n.className = "dtag dtag-" + kind;
  }
  (function dataTags() {
    setTag("boardTag", LAST.breadthReal ? "Dữ liệu thật" : "Chưa có số thật",
      LAST.breadthReal ? "live" : "sample");
    // Không có nguồn riêng cho rổ VN100/VN30 — suy theo tỷ lệ từ breadth toàn
    // thị trường, nên mức đúng là Proxy chứ không phải Mẫu.
    const adrKind = LAST.breadthReal ? "proxy" : "sample";
    const adrText = LAST.breadthReal ? "Proxy" : "Chưa có số thật";
    setTag("gaugeTag", adrText, adrKind);
    setTag("adrTag", adrText, adrKind);
    setTag("mgTag", MARGIN.sample ? "Mẫu" : "Dữ liệu thật",
      MARGIN.sample ? "sample" : "live");
    // Đường cong lợi suất: đếm thật/mẫu trên cả hai nửa US và VN.
    const yAll = [...US, ...VN];
    const yLive = yAll.filter(r => r.src === "live").length;
    const yProxy = yAll.filter(r => r.src === "proxy").length;
    setTag("curveTag",
      yLive === yAll.length ? "Tham chiếu chốt"
        : (yLive + yProxy) === 0 ? "Chưa có nguồn"
        : `${yLive} thật + ${yProxy} sơ cấp / ${yAll.length} kỳ hạn`,
      yLive === yAll.length ? "live" : (yLive + yProxy) === 0 ? "sample" : "proxy");
  })();

  function buildTape() {
    const mbr = window.__mbrScore, mbrZ = window.__mbrZone || "";
    const items = [
      { k: "VN-INDEX", v: nf(LAST.close), c: LAST.pct == null ? "—" : sgn(LAST.pct) + "%", cl: cls(LAST.pct) },
      { k: "GTGD HOSE", v: LAST.gtgd == null ? "—" : nf(LAST.gtgd, 0) + " tỷ", c: "", cl: "flat" },
      { k: "ADR 25 VN100", v: nf(LAST.vn100.ratio, 1), c: LAST.vn100.ratio == null ? "chưa có dữ liệu thật" : LAST.vn100.ratio > 120 ? "quá mua" : LAST.vn100.ratio < 80 ? "quá bán" : "cân bằng", cl: LAST.vn100.ratio == null ? "flat" : LAST.vn100.ratio > 120 ? "down" : LAST.vn100.ratio < 80 ? "up" : "flat" },
      { k: "ADR 25 VN30", v: nf(LAST.vn30.ratio, 1), c: "", cl: LAST.vn30.ratio == null ? "flat" : LAST.vn30.ratio > 120 ? "down" : LAST.vn30.ratio < 80 ? "up" : "flat" },
      { k: "DƯ NỢ MARGIN", v: nf(MG_LAST.debt / 1000, 1) + " nghìn tỷ", c: sgn(MG_LAST.net, 0) + " tỷ · mẫu", cl: cls(MG_LAST.net) },
      { k: "RR ĐÒN BẨY", v: mbr == null ? "—" : String(Math.round(mbr)), c: (mbrZ || "") + " · proxy", cl: mbr == null ? "flat" : mbr >= 70 ? "down" : mbr < 40 ? "up" : "flat" },
      // Có số thật từ 2026-09-12 (daily_update.py: fetch_foreign, cộng từ
      // từng mã HOSE). Trước đó ô này luôn "— chờ API".
      { k: "KHỐI NGOẠI", ...(() => {
        const f = LIVE && LIVE.foreign;
        const q = (LIVE && LIVE.quality) ? LIVE.quality.foreign : null;
        if (!f || f.net == null || q === "missing") return { v: "—", c: "chưa có dữ liệu", cl: "flat" };
        return { v: sgn(f.net, 0) + " tỷ",
                 c: (q === "live" ? "HOSE" : q) + (f.net < 0 ? " · bán ròng" : " · mua ròng"),
                 cl: cls(f.net) };
      })() },
      // 25.338 từng là số cứng hiển thị như tỷ giá hiện hành, trong khi
      // live.json ghi usdVnd = null / quality = missing. Thiếu thì "—".
      // Hai ô riêng: tỷ giá trung tâm NHNN vẫn chưa có nguồn nên để "—", còn ô
      // Vietcombank có số thật. Gộp hai thứ này vào một ô mang nhãn "trung tâm"
      // là nói sai đại lượng — chúng lệch nhau 1–2,5%.
      // Cả hai ô đều là Vietcombank và đều ghi rõ là Vietcombank. Ô "USD/VND TT
      // · trung tâm" trước đây luôn "—" vì tỷ giá trung tâm NHNN chưa có nguồn;
      // thay bằng giá bán ra của VCB thì có số thật, nhưng phải đổi cả nhãn —
      // dán chữ "trung tâm" lên một tỷ giá NHTM là nói sai đại lượng.
      ...(() => {
        const v = LIVE && LIVE.usdVndVcb;
        const q = (LIVE && LIVE.quality) ? LIVE.quality.usdVndVcb : null;
        const suffix = q === "live" ? "" : " · bảng phiên trước";
        const cell = (label, val, what) => ({
          k: label,
          v: val == null ? "—" : nf(val, 0),
          c: val == null ? "chưa có dữ liệu" : "VCB " + what + suffix,
          cl: "flat",
        });
        return [cell("USD/VND MUA", v && v.buyTransfer, "mua CK"),
                cell("USD/VND BÁN", v && v.sell, "bán ra")];
      })(),
      { k: "DXY", v: (LIVE && LIVE.dxy != null) ? String(LIVE.dxy) : "—", c: (LIVE && LIVE.quality && LIVE.quality.dxy === "live") ? "auto" : "", cl: "flat" },
      { k: "FED FUNDS", v: "3,50–3,75%", c: "giữ 9–3", cl: "flat" },
      { k: "NFP T7", v: "−23K", c: "dự báo +80K", cl: "down" },
      { k: "CPI VN 7T", v: "+4,39%", c: "T7 −0,12% m/m", cl: "flat" },
      ...US.map(r => ({ k: "US " + r.t.replace(" năm", "Y"), v: r.y == null ? "—" : nf(r.y) + "%", c: r.d == null ? "" : sgn(r.d) + "pp", cl: cls(r.d) })),
      ...VN.map(r => ({ k: "VN " + r.t.replace(" năm", "Y"), v: r.y == null ? "—" : nf(r.y) + (r.est ? "% e" : "%"), c: r.d == null ? "" : sgn(r.d) + "pp", cl: cls(r.d) }))
    ];
    const html = items.map(i => `<div class="tk"><b>${esc(i.k)}</b><span class="v">${esc(i.v)}</span><span class="c ${i.cl}">${esc(i.c)}</span></div>`).join("");
    el("tape").innerHTML = html + html;
  }
  buildTape();

  /* ============================================================
     5. BẢNG LỢI SUẤT
     ============================================================ */
  function yieldRows(data, tbody, color) {
    tbody.innerHTML = data.map(r => `
      <tr>
        <td class="tenor">${r.t}${
          r.src === "sample" ? '<span class="est" title="Số mẫu tĩnh, chưa có nguồn thật cho kỳ hạn này">mẫu</span>'
          : r.src === "proxy" ? `<span class="est" title="${esc(
              "Lãi suất trúng thầu sơ cấp (Kho bạc Nhà nước, đấu thầu HNX" +
              (r.auction ? " đợt " + r.auction : "") + ")" +
              (r.asof ? ", phát hành " + r.asof : "") +
              ". Chỉ đổi vào ngày có đấu thầu, không phải lợi suất thứ cấp từng phiên.")}">${r.asof ? r.asof.slice(5).replace("-", "/") : "p"}</span>`
          : r.est ? '<span class="est">e</span>' : ''}</td>
        <td class="num" style="font-weight:600;color:${color}">${r.y == null ? "—" : nf(r.y) + "%"}</td>
        <td class="num ${cls(r.d)}">${sgn(r.d)}</td>
        <td class="num ${cls(r.m)}">${sgn(r.m)}</td>
        <td class="num ${cls(r.yr)}">${sgn(r.yr)}</td>
      </tr>`).join("");
  }
  yieldRows(US, el("usBody"), "var(--us)");
  yieldRows(VN, el("vnBody"), "var(--vn)");

  /* ============================================================
     6. ĐƯỜNG CONG LỢI SUẤT
     ============================================================ */
  const curveOn = { us: true, vn: true };
  let curveScale = "log";

  el("curveLegend").innerHTML = [
    { k: "us", n: "Kho bạc Mỹ (USD)", c: "var(--us)" },
    { k: "vn", n: "TPCP Việt Nam (VND)", c: "var(--vn)" }
  ].map(s => `<button class="lg" data-k="${s.k}" aria-pressed="true"><i class="sw" style="background:${s.c}"></i>${s.n}</button>`).join("");
  el("curveLegend").addEventListener("click", e => {
    const b = e.target.closest(".lg"); if (!b) return;
    const k = b.dataset.k; curveOn[k] = !curveOn[k];
    b.setAttribute("aria-pressed", String(curveOn[k]));
    drawCurve();
  });
  el("curveScale").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    curveScale = b.dataset.s;
    [...e.currentTarget.children].forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    drawCurve();
  });

  function drawCurve() {
    const host = el("curveChart"), W = Math.max(360, host.clientWidth), H = 330;
    const m = { t: 18, r: 22, b: 38, l: 48 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const xs = [1, 3, 5, 10, 30];
    const fx = v => curveScale === "log" ? Math.log(v) : v;
    const x0 = fx(1), x1 = fx(30);
    const X = v => m.l + (fx(v) - x0) / (x1 - x0) * iw;

    // Lọc null: một kỳ hạn thiếu số làm cả trục thành NaN và biểu đồ biến mất.
    const all = [...US, ...VN].map(r => r.y).filter(v => v != null);
    let lo = all.length ? Math.floor(Math.min(...all) * 2) / 2 - 0.25 : 0;
    let hi = all.length ? Math.ceil(Math.max(...all) * 2) / 2 + 0.25 : 1;
    const Y = v => m.t + ih - (v - lo) / (hi - lo) * ih;

    let g = "";
    for (let v = Math.ceil(lo * 2) / 2; v <= hi; v += 0.5) {
      g += `<line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${W - m.r}" y2="${Y(v).toFixed(1)}" stroke="var(--line-soft)"/>
          <text x="${m.l - 9}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" fill="var(--dim)" font-size="10.5" font-family="IBM Plex Mono, ui-monospace, monospace">${nf(v, 1)}</text>`;
    }
    xs.forEach(v => {
      g += `<line x1="${X(v).toFixed(1)}" y1="${m.t}" x2="${X(v).toFixed(1)}" y2="${m.t + ih}" stroke="var(--line-soft)" stroke-dasharray="2 4"/>
          <text x="${X(v).toFixed(1)}" y="${H - 14}" text-anchor="middle" fill="var(--dim)" font-size="10.5" font-family="IBM Plex Mono, ui-monospace, monospace">${v}N</text>`;
    });

    const series = [{ k: "us", d: US, c: "var(--us)" }, { k: "vn", d: VN, c: "var(--vn)" }];
    let paths = "";
    series.forEach(s => {
      if (!curveOn[s.k]) return;
      // Chỉ vẽ những kỳ hạn có số thật; hết sạch thì không vẽ đường nào.
      const pts = s.d.filter(r => r.y != null).map(r => [X(r.x), Y(r.y)]);
      if (!pts.length) return;
      const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      const area = line + ` L ${pts[pts.length - 1][0].toFixed(1)} ${m.t + ih} L ${pts[0][0].toFixed(1)} ${m.t + ih} Z`;
      paths += `<path d="${area}" fill="${s.c}" opacity=".07"/>
              <path class="draw" pathLength="1" d="${line}" fill="none" stroke="${s.c}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
      pts.forEach((p, i) => {
        const r = s.d[i];
        paths += `<circle class="pop" style="animation-delay:${(i * 90)}ms" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="5" fill="var(--surface)" stroke="${s.c}" stroke-width="2.4"/>
                <text x="${p[0].toFixed(1)}" y="${(p[1] - 13).toFixed(1)}" text-anchor="middle" fill="${s.c}" font-size="11" font-weight="600" font-family="IBM Plex Mono, ui-monospace, monospace">${nf(r.y)}</text>`;
      });
    });

    host.querySelector("svg")?.remove();
    host.insertAdjacentHTML("afterbegin",
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Đường cong lợi suất trái phiếu Mỹ và Việt Nam">
        <text x="${m.l - 9}" y="${m.t - 4}" text-anchor="end" fill="var(--dim)" font-size="9.5" font-family="IBM Plex Mono, ui-monospace, monospace">%</text>
        ${g}${paths}
       </svg>`);
  }

  /* ============================================================
     7. CHÊNH LỆCH VN − MỸ
     ============================================================ */
  function drawSpread() {
    const host = el("spreadChart"); if (!host) return;
    const W = Math.max(280, host.clientWidth), H = 330;
    const m = { t: 16, r: 14, b: 34, l: 44 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const data = US.map(u => {
      const vy = yieldAt(VN, u.x);
      return { t: u.t.replace(" năm", "N"), v: vy == null ? null : (vy - u.y) * 100 };
    }).filter(d => d.v != null);
    if (!data.length) {
      host.innerHTML = `<p class="note" style="padding:12px">Chưa đủ dữ liệu spread (thiếu cặp US/VN theo kỳ hạn).</p>`;
      return;
    }
    const mx = Math.max(...data.map(d => Math.abs(d.v)), 1) * 1.18;
    const Y = v => m.t + ih / 2 - (v / mx) * (ih / 2);
    const bw = iw / data.length * 0.52;

    let g = "";
    [-mx * 0.66, -mx * 0.33, 0, mx * 0.33, mx * 0.66].forEach(v => {
      g += `<line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${W - m.r}" y2="${Y(v).toFixed(1)}" stroke="${Math.abs(v) < 1 ? 'var(--line)' : 'var(--line-soft)'}"/>
          <text x="${m.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" fill="var(--dim)" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${Math.round(v)}</text>`;
    });
    data.forEach((d, i) => {
      const cx = m.l + iw * (i + 0.5) / data.length;
      const y0 = Y(0), y1 = Y(d.v);
      const c = d.v >= 0 ? "var(--tang)" : "var(--giam)";
      g += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, Math.abs(y1 - y0)).toFixed(1)}" class="bar" fill="${c}" opacity=".8" rx="3"/>
          <text x="${cx.toFixed(1)}" y="${(y1 + (d.v >= 0 ? -8 : 15)).toFixed(1)}" text-anchor="middle" fill="${c}" font-size="11" font-weight="600" font-family="IBM Plex Mono, ui-monospace, monospace">${sgn(d.v, 0)}</text>
          <text x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle" fill="var(--dim)" font-size="10.5" font-family="IBM Plex Mono, ui-monospace, monospace">${d.t}</text>`;
    });

    host.querySelector("svg")?.remove();
    host.insertAdjacentHTML("afterbegin",
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Chênh lệch lợi suất Việt Nam trừ Mỹ theo kỳ hạn"><text x="${m.l - 8}" y="${m.t - 3}" text-anchor="end" fill="var(--dim)" font-size="9.5" font-family="IBM Plex Mono, ui-monospace, monospace">bps</text>${g}</svg>`);

    const yU10 = yieldAt(US, 10), yV10 = yieldAt(VN, 10), yU30 = yieldAt(US, 30), yV30 = yieldAt(VN, 30);
    const s10 = (yU10 != null && yV10 != null) ? (yV10 - yU10) * 100 : null;
    const s30 = (yU30 != null && yV30 != null) ? (yV30 - yU30) * 100 : null;
    if (s10 == null) {
      el("spreadNote").innerHTML = `Chưa đủ cặp kỳ hạn để tính spread đầy đủ (cần US+VN 10Y/30Y). Kiểm tra LIVE.vnYields / loadVNYields.`;
    } else {
      el("spreadNote").innerHTML = `Ở kỳ hạn 10 năm, chênh VND − USD ≈ <b>${sgn(s10, 0)} điểm cơ bản</b>${
        s30 != null ? `; 30 năm ≈ <b>${sgn(s30, 0)} bps</b>` : ""
      }. Chênh lệch âm kéo dài làm suy giảm sức hấp dẫn carry vào VND và tạo áp lực tỷ giá — theo dõi cùng DXY.`;
    }
  }

  /* ============================================================
     8. BẢNG ĐIỆN PHIÊN GẦN NHẤT
     ============================================================ */
  (function board() {
    const breadthOk = LAST.breadthReal;
    const a = breadthOk ? LAST.all : null;
    // `+x || 0` biến null thành 0 — với trần/sàn thì "0 mã trần" là một
    // tuyên bố về phiên, không phải "không biết". Giữ null nguyên vẹn.
    const num = v => (v == null || Number.isNaN(+v) ? null : +v);
    const ceil = a ? num(a.ceil) : null, floor = a ? num(a.floor) : null,
      aa = a ? num(a.a) : null, dd = a ? num(a.d) : null, uu = a ? num(a.u) : null;
    const cfOk = ceil != null && floor != null;

    if (!breadthOk) {
      el("boardBar").innerHTML = `<div style="flex:1;background:var(--line)" title="Chưa có dữ liệu tăng/giảm thật cho phiên này">Chưa có dữ liệu tăng/giảm thật</div>`;
    } else {
      // Không có trần/sàn thì vẽ 3 dải (Tăng/TC/Giảm) thay vì bịa dải
      // "Trần 0 mã" — thiếu số khác với số bằng không.
      const segs = cfOk ? [
        { n: "Trần", v: ceil, c: "var(--tran)" },
        { n: "Tăng", v: Math.max(0, aa - ceil), c: "var(--tang)" },
        { n: "TC", v: uu, c: "var(--tc)" },
        { n: "Giảm", v: Math.max(0, dd - floor), c: "var(--giam)" },
        { n: "Sàn", v: floor, c: "var(--san)" }
      ] : [
        { n: "Tăng", v: aa, c: "var(--tang)" },
        { n: "TC", v: uu, c: "var(--tc)" },
        { n: "Giảm", v: dd, c: "var(--giam)" }
      ];
      // Trần/sàn ở thị trường CÓ BIÊN ĐỘ không phải "tăng mạnh" mà là **cầu bị
      // cắt ngang**: lệnh mua còn đó nhưng không còn giá nào cao hơn để khớp.
      // Nên ADR đánh giá THẤP một phiên nhiều mã trần — mỗi mã một phiếu, dù
      // tăng 0,2% hay bị chặn ở 7%. Xem skill `vn-market-mechanics` §1.
      const BAND_NOTE =
        "Biên độ HOSE ±7% (QĐ 352/QĐ-SGDHCM). Trần/sàn nghĩa là cầu/cung bị "
        + "chặn, không chỉ là tăng/giảm mạnh — nên ADR đánh giá thấp phiên "
        + "nhiều mã trần. LƯU Ý: mã ngày đầu niêm yết và ngày không hưởng "
        + "quyền cổ tức cổ phiếu có biên độ ±20%; hệ thống chưa tách hai loại "
        + "này nên chúng đang được đếm chung ô Trần/Sàn.";
      el("boardBar").innerHTML = segs.map(s =>
        `<div style="flex:${Math.max(0.001, s.v)};background:${s.c}" title="${s.n}: ${s.v} mã${
          s.n === "Trần" || s.n === "Sàn" ? " — " + BAND_NOTE : ""}">${s.v >= 14 ? s.v : ""}</div>`).join("");
    }

    el("boardStats").innerHTML = `
      <div class="stat"><div class="k">VN-Index</div><div class="v ${cls(LAST.pct)}">${nf(LAST.close)}</div><div class="m ${cls(LAST.pct)}">${sgn(LAST.chg)} (${sgn(LAST.pct)}%)</div></div>
      <div class="stat"><div class="k">Mã tăng / giảm</div><div class="v">${breadthOk ? `<span class="up">${aa}</span><span style="color:var(--dim)">/</span><span class="down">${dd}</span>` : "—"}</div><div class="m">${breadthOk ? uu + " mã tham chiếu" : "chưa có dữ liệu thật"}</div></div>
      <div class="stat"><div class="k">Mã trần / sàn</div><div class="v">${cfOk ? `<span class="ceil">${ceil}</span><span style="color:var(--dim)">/</span><span class="floorc">${floor}</span>` : "—"}</div><div class="m">${cfOk ? "biên độ dao động HOSE ±7%" : "nguồn breadth chưa có trần/sàn"}</div></div>
      <div class="stat"><div class="k">GTGD khớp lệnh</div><div class="v">${nf(LAST.gtgd, 0)}</div><div class="m">${LAST.gtgd == null ? "chưa có dữ liệu" : "tỷ đồng"}</div></div>
      <div class="stat"><div class="k">ADR 25 · rổ VN100</div><div class="v">${nf(LAST.vn100.ratio, 1)}</div><div class="m">Rổ VN30: ${nf(LAST.vn30.ratio, 1)}</div></div>`;

    const r = LAST.vn100.r[25];
    const gm = el("gaugeMark");
    if (r == null) {
      gm.style.left = "50%"; delete gm.dataset.v;
      el("gaugeNote").innerHTML = `<b class="flat">Chưa đủ 25 phiên liên tục có dữ liệu tăng/giảm thật</b> để tính ADR 25 phiên — nguồn breadth đang <b>stale</b>, xem bảng 90 phiên bên dưới để biết từ phiên nào.`;
    } else {
      const pos = Math.max(0, Math.min(100, (r - 40) / 140 * 100));
      gm.style.left = pos + "%"; gm.dataset.v = nf(r, 1);
      const verdict = r > 120 ? `<b class="down">Vùng quá mua (&gt;120).</b> Bên cầu áp đảo trong 25 phiên gần nhất, xác suất rung lắc ngắn hạn tăng lên.`
        : r < 70 ? `<b class="up">Vùng quá bán sâu (&lt;70).</b> Áp lực cung lan rộng mạnh — hiếm hơn ngưỡng 80; thường sau đợt xả.`
        : r < 80 ? `<b class="up">Vùng quá bán (&lt;80).</b> Ngưỡng chuẩn; độ tin cậy thường cao hơn quá mua khi canh giải ngân ngược xu hướng.`
        : `<b class="flat">Vùng cân bằng (80–120).</b> Cung cầu chưa lệch hẳn về phía nào đủ để phát tín hiệu.`;
      el("gaugeNote").innerHTML = verdict + ` ADR 25 phiên <b>rổ VN100</b> = <b>${nf(r, 1)}</b>; rổ VN30 = <b>${nf(LAST.vn30.r[25], 1)}</b>. Lệch hai rổ cho biết dòng tiền đang co về vốn hoá lớn hay lan toả. <span class="dtag dtag-proxy">Proxy</span>`;
      // Nhãn trước đây là "Mẫu" và gắn vô điều kiện, kể cả khi ADR tính từ
      // breadth thật. Đúng mức là Proxy: không có nguồn riêng cho rổ
      // VN100/VN30, hai chuỗi này suy ra theo tỷ lệ từ breadth toàn thị
      // trường thật (xem chỗ dựng row.vn100/row.vn30).
    }
  })();

  /* ============================================================
     8b. CHỈ SỐ SỢ HÃI & THAM LAM
     ============================================================ */
  const FG_ZONES = [
    { max: 25, n: "Sợ hãi tột độ", c: "var(--fg-extreme-fear)" },
    { max: 45, n: "Sợ hãi", c: "var(--tc)" },
    { max: 55, n: "Trung tính", c: "var(--dim)" },
    { max: 75, n: "Tham lam", c: "var(--fg-greed)" },
    { max: 101, n: "Tham lam tột độ", c: "var(--fg-extreme-greed)" }
  ];
  const fgZone = v => v == null ? { n: "—", c: "var(--dim)" } : FG_ZONES.find(z => v < z.max) || FG_ZONES[4];

  function gaugeSVG(val) {
    const W = 380, H = 232, cx = W / 2, cy = 176, R = 150, th = 32;
    const ang = v => Math.PI * (1 - Math.max(0, Math.min(100, v)) / 100);
    const P = (v, r) => [cx + r * Math.cos(ang(v)), cy - r * Math.sin(ang(v))];
    let g = "";
    let from = 0;
    FG_ZONES.forEach(z => {
      const to = Math.min(100, z.max), gap = 0.6;
      const [ax, ay] = P(from + gap, R), [bx, by] = P(to - gap, R);
      const [cx2, cy2] = P(to - gap, R - th), [dx, dy] = P(from + gap, R - th);
      const active = val != null && val >= from && val < z.max;
      g += `<path d="M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${R} ${R} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)}
          L ${cx2.toFixed(1)} ${cy2.toFixed(1)} A ${R - th} ${R - th} 0 0 0 ${dx.toFixed(1)} ${dy.toFixed(1)} Z"
          fill="${z.c}" opacity="${active ? 1 : .22}"/>`;
      from = to;
    });
    [0, 25, 50, 75, 100].forEach(v => {
      const [x, y] = P(v, R - th - 17);
      g += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="var(--dim)"
           font-size="12" font-family="IBM Plex Mono, ui-monospace, monospace">${v}</text>`;
    });
    if (val != null) {
      const [nx, ny] = P(val, R - th - 30);
      g += `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}"
           stroke="var(--text)" stroke-width="4.5" stroke-linecap="round"/>`;
    }
    g += `<circle cx="${cx}" cy="${cy}" r="9" fill="var(--surface)" stroke="var(--text)" stroke-width="3.5"/>`;
    g += `<text x="${cx}" y="${cy + 46}" text-anchor="middle" fill="var(--text)" font-size="38" font-weight="600"
         letter-spacing="-1.5" font-family="IBM Plex Mono, ui-monospace, monospace">${val == null ? "—" : Math.round(val)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Đồng hồ đo mức ${fgZone(val).n}, giá trị ${val == null ? "chưa có" : Math.round(val)} trên 100">${g}</svg>`;
  }

  function fgVietnam() {
    const N = ROWS.length, closes = ROWS.map(r => r.close);
    const cl = v => Math.max(0, Math.min(100, v));
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    /* Bình quân NGHIÊM NGẶT: thiếu một phần tử thì không có kết quả.
       mean() thường sẽ để JS ép null thành 0 (`s + null === s`), cho ra một con
       số thấp hơn thực tế mà không cấu phần nào báo là thiếu dữ liệu — đúng
       kiểu lỗi âm thầm CLAUDE.md §1.4 cấm. Công thức không đổi; chỉ là khi
       thiếu đầu vào thì cấu phần trả null và tự loại khỏi bình quân bảy cấu
       phần (cơ chế `ok = c.filter(...)` bên dưới đã có sẵn). */
    const meanN = a => (a.some(x => x == null || Number.isNaN(+x)) ? null : mean(a));

    function at(i) {
      if (i < 130) return null;
      const c = [];
      const ma125 = meanN(closes.slice(i - 124, i + 1));
      c.push({ k: "Đà thị trường", v: (ma125 == null || closes[i] == null) ? null : cl(50 + (closes[i] / ma125 - 1) * 500), d: "VN-Index so với trung bình 125 phiên" });
      const adr = ROWS[i].all.r[25];
      c.push({ k: "Độ rộng (ADR 25)", v: adr == null ? null : cl((adr - 70) / 60 * 100), d: "Tương quan mã tăng / mã giảm" });
      const rets = []; for (let j = i - 19; j <= i; j++) rets.push(closes[j] == null || closes[j - 1] == null ? null : closes[j] / closes[j - 1] - 1);
      const mu = meanN(rets);
      const sd = mu == null ? null : Math.sqrt(mean(rets.map(r => (r - mu) ** 2))) * Math.sqrt(252);
      c.push({ k: "Biến động 20 phiên", v: sd == null ? null : cl((0.30 - sd) / (0.30 - 0.09) * 100), d: "Độ lệch chuẩn quy năm, thay cho VIX" });
      const g5 = meanN(ROWS.slice(i - 4, i + 1).map(r => r.gtgd)), g60 = meanN(ROWS.slice(i - 59, i + 1).map(r => r.gtgd));
      c.push({ k: "Thanh khoản", v: (g5 == null || g60 == null) ? null : cl((g5 / g60 - 0.75) / 0.55 * 100), d: "GTGD 5 phiên so với bình quân 60 phiên" });
      let ce = 0, fl = 0, cfOk = true;
      for (let j = i - 19; j <= i; j++) {
        const a = ROWS[j].all;
        if (a.ceil == null || a.floor == null) { cfOk = false; break; }
        ce += a.ceil; fl += a.floor;
      }
      c.push({ k: "Sức mạnh giá", v: !cfOk ? null : (ce + fl) === 0 ? 50 : cl(ce / (ce + fl) * 100), d: "Số mã trần so với số mã sàn, 20 phiên" });
      const r20 = (closes[i] == null || closes[i - 20] == null) ? null : closes[i] / closes[i - 20] - 1;
      // Không thay lợi suất 10 năm thiếu bằng 4,5% nữa: đó là một con số bịa
      // đi thẳng vào điểm số hiển thị. Thiếu thì cấu phần này không tính.
      const y10 = yieldAt(VN, 10); const bond = y10 == null ? null : (y10 / 100) / 12;
      c.push({ k: "Nhu cầu trú ẩn", v: (r20 == null || bond == null) ? null : cl(50 + (r20 - bond) * 700), d: "Cổ phiếu so với trái phiếu Chính phủ 10 năm" });
      c.push({ k: "Dòng vốn ngoại", v: null, d: "Mua/bán ròng khối ngoại 20 phiên — chưa nối API, loại khỏi bình quân" });

      const ok = c.filter(x => x.v != null);
      return { score: ok.length ? mean(ok.map(x => x.v)) : null, comps: c };
    }
    const idx = N - 1;
    return {
      now: at(idx), prev: at(idx - 1), week: at(idx - 5), month: at(idx - 21), year: at(idx - 250),
      date: ROWS[idx].date
    };
  }

  function fgCard(host, cfg) {
    const z = fgZone(cfg.score);
    const rows = cfg.hist.map(h => {
      const hz = fgZone(h.v);
      return `<div class="fg-row">
        <span class="lb">${h.k}<b style="color:${hz.c}">${hz.n}</b></span>
        <span class="fg-dot" style="background:${hz.c}1F;color:${hz.c}">${h.v == null ? "—" : Math.round(h.v)}</span>
      </div>`;
    }).join("");
    const comps = cfg.comps ? `<div class="fg-comp">
        <h4>Bảy cấu phần cấu thành chỉ số</h4>
        ${cfg.comps.map(c => {
          const cz = fgZone(c.v);
          return `<div class="fg-c ${c.v == null ? "na" : ""}" title="${c.d}">
            <span class="n">${c.k}</span>
            <span class="bar">${c.v == null ? "" : `<i style="width:${c.v.toFixed(0)}%;background:${cz.c}"></i>`}</span>
            <span class="v">${c.v == null ? "—" : Math.round(c.v)}</span>
          </div>`;
        }).join("")}
        <p class="note" style="margin-top:10px">${cfg.foot}</p>
      </div>` : `<div class="fg-comp"><p class="note" style="margin-top:0">${cfg.foot}</p></div>`;

    host.innerHTML = `
      <div class="p-hd"><h2 style="display:flex;align-items:center;flex-wrap:wrap;gap:6px">${cfg.title}</h2><span class="sub">${cfg.sub}</span></div>
      <div class="fg-wrap">
        <div class="fg-gauge">
          ${gaugeSVG(cfg.score)}
          <span class="fg-zone" style="background:${z.c}1A;color:${z.c}">${z.n}</span>
        </div>
        <div class="fg-side">${rows}</div>
      </div>
      ${comps}`;
  }

  (function fearGreed() {
    const vn = fgVietnam();
    fgCard(el("fgVN"), {
      title: 'Sợ hãi &amp; Tham lam — Việt Nam <span class="dtag dtag-proxy">Proxy nội bộ</span>',
      sub: "phiên " + dmyF(vn.date) + " · không phải chỉ số chính thức",
      score: vn.now ? vn.now.score : null,
      comps: vn.now ? vn.now.comps : null,
      hist: [
        { k: "Phiên trước", v: vn.prev ? vn.prev.score : null },
        { k: "1 tuần trước", v: vn.week ? vn.week.score : null },
        { k: "1 tháng trước", v: vn.month ? vn.month.score : null },
        { k: "1 năm trước", v: vn.year ? vn.year.score : null }
      ],
      foot: "<b>Proxy nghiên cứu</b> — Việt Nam chưa có chỉ số tâm lý chính thức. Tự dựng theo khung CNN: bình quân các cấu phần có dữ liệu (0–100). Khác bản gốc: vol 20 phiên thay VIX; có cấu phần dòng vốn ngoại (quan trọng với EM VN) nhưng <b>chưa nối API</b> nên bị loại khỏi bình quân. Dùng để so hướng, không dùng một mình để chốt lệnh."
    });

    const fgLive = (LIVE && LIVE.fgUs) ? LIVE.fgUs : null;
    const fgScore = fgLive && fgLive.score != null ? fgLive.score : 64;
    const fgHist = fgLive && fgLive.hist ? fgLive.hist : { prev: 59, week: 45, month: 39, year: 54 };
    const fgSub = fgLive
      ? (`CNN auto · asof ${fgLive.asofEt || (LIVE && LIVE.asof) || ASOF}`)
      : "CNN · mẫu (chờ daily_update)";
    const fgTag = fgLive ? "Tham chiếu CNN · auto" : "Mẫu / stale";
    fgCard(el("fgUS"), {
      title: `Sợ hãi &amp; Tham lam — Hoa Kỳ <span class="dtag dtag-live">${fgTag}</span>`,
      sub: fgSub,
      score: fgScore,
      comps: null,
      hist: [
        { k: "Phiên trước", v: fgHist.prev },
        { k: "1 tuần trước", v: fgHist.week },
        { k: "1 tháng trước", v: fgHist.month },
        { k: "1 năm trước", v: fgHist.year }
      ],
      foot: `Chỉ số CNN Fear & Greed. Cập nhật tự động qua <code>automation/daily_update.py</code> khi nguồn CNN phản hồi.
        <a href="https://edition.cnn.com/markets/fear-and-greed" target="_blank" rel="noopener">Xem CNN</a>.`
    });
  })();

  /* ============================================================
     8c. DƯ NỢ MARGIN — cập nhật hàng ngày + chỉ số rủi ro banking
     ============================================================ */
  let mgN = 132;
  const mgOn = { debt: true, net: true, vni: true };

  const MBR_ZONES = [
    { max: 40, id: "safe", n: "An toàn / lạnh", c: "var(--tang)", act: "Đòn bẩy hệ thống ôn hòa. Duy trì giám sát định kỳ; chưa cần siết thêm." },
    { max: 70, id: "watch", n: "Theo dõi", c: "var(--tc)", act: "Xuất hiện tín hiệu lệch pha hoặc room/thanh khoản căng vừa. Theo dõi hàng ngày; rà soát tập trung CTCK/mã." },
    { max: 101, id: "alert", n: "Cảnh báo", c: "var(--giam)", act: "Rủi ro force-sell / siết room lan truyền tăng. Ưu tiên kiểm room, HHI CTCK, và phân kỳ margin–giá." }
  ];
  const mbrZone = v => MBR_ZONES.find(x => v < x.max) || MBR_ZONES[2];
  const cl01 = v => Math.max(0, Math.min(100, v));

  function marginBankRisk() {
    const days = MARGIN.days, brokers = MARGIN.brokers;
    const n = days.length, i = n - 1;
    const L = days[i];
    const d5 = days[Math.max(0, i - 5)], d20 = days[Math.max(0, i - 20)];

    const near = (iso, field) => {
      for (let k = ROWS.length - 1; k >= 0; k--) if (ROWS[k].date <= iso) return ROWS[k][field];
      return ROWS[0][field];
    };
    const vni = iso => near(iso, "close");
    const gtgd = iso => near(iso, "gtgd");

    /* Cổng từ chối. Cả ba trụ cột đều chia cho giá hoặc GTGD; thiếu một trong
       hai thì phép chia ra Infinity/NaN và vẫn cho ra một điểm rủi ro trông
       bình thường (mbrZone(null) rơi vào "An toàn" — sai theo hướng nguy hiểm
       nhất). Không đủ đầu vào thì không có điểm. */
    const needDates = [L.date, d5.date, d20.date];
    if (needDates.some(dt => vni(dt) == null || gtgd(dt) == null)) return null;

    const pMg5 = (L.debt - d5.debt) / d5.debt * 100;
    const pMg20 = (L.debt - d20.debt) / d20.debt * 100;
    const pPx5 = (vni(L.date) - vni(d5.date)) / vni(d5.date) * 100;
    const pPx20 = (vni(L.date) - vni(d20.date)) / vni(d20.date) * 100;
    const gap5 = pMg5 - pPx5, gap20 = pMg20 - pPx20;
    const rDiv5 = cl01(40 + gap5 * 7.5);
    const rDiv20 = cl01(40 + gap20 * 5);
    const bad5 = (pMg5 > 0.3 && pPx5 < -0.5) ? 12 : 0;
    const bad20 = (pMg20 > 1 && pPx20 < -1) ? 15 : 0;
    const rDiv = cl01(0.55 * rDiv5 + 0.45 * rDiv20 + bad5 + bad20);

    const ratio = L.debt / gtgd(L.date);
    const ratios = [];
    for (let k = Math.max(0, i - 59); k <= i; k++) ratios.push(days[k].debt / gtgd(days[k].date));
    const sorted = [...ratios].sort((a, b) => a - b);
    const rank = sorted.findIndex(x => x >= ratio);
    const pctile = rank < 0 ? 100 : (rank / (sorted.length - 1)) * 100;
    let g5 = 0, g20 = 0;
    for (let k = 0; k < 5; k++) g5 += gtgd(days[Math.max(0, i - k)].date);
    for (let k = 0; k < 20; k++) g20 += gtgd(days[Math.max(0, i - k)].date);
    g5 /= 5; g20 /= 20;
    const liqTrend = g5 / g20;
    const rRatio = cl01(pctile);
    const rLiqT = cl01(50 + (0.92 - liqTrend) * 200);
    const rLiq = cl01(0.65 * rRatio + 0.35 * rLiqT);

    const tot = brokers.reduce((s, b) => s + b.debt, 0) || 1;
    // Room còn lại theo từng CTCK cần vốn chủ sở hữu, chưa có nguồn công khai
    // miễn phí — khi không CTCK nào có room, không coi là room=0% (nguy hiểm
    // tối đa giả) mà loại hẳn khỏi phép tính, chỉ dùng độ tập trung (rConc).
    const withRoom = brokers.filter(b => b.room != null);
    const roomTot = withRoom.reduce((s, b) => s + b.debt, 0);
    const roomW = roomTot ? withRoom.reduce((s, b) => s + b.room * (b.debt / roomTot), 0) : null;
    const rRoom = roomW == null ? null : cl01(100 - roomW * 2.2);
    const top3 = brokers.slice(0, 3).reduce((s, b) => s + b.debt, 0) / tot * 100;
    const rConc = cl01((top3 - 30) * 2.2);
    const tightN = withRoom.filter(b => b.room < 20).length;
    const rTight = withRoom.length ? cl01(tightN / withRoom.length * 100 + tightN * 6) : null;
    const rRoomAll = (rRoom == null && rTight == null)
      ? rConc
      : cl01(0.45 * (rRoom ?? rConc) + 0.30 * rConc + 0.25 * (rTight ?? rConc));

    const score = cl01(0.40 * rDiv + 0.30 * rLiq + 0.30 * rRoomAll);
    const zone = mbrZone(score);

    const pillarZone = v => mbrZone(v);
    return {
      score, zone, date: L.date,
      pillars: [
        {
          id: "div", k: "Phân kỳ đòn bẩy – giá", w: "40%",
          risk: rDiv, z: pillarZone(rDiv),
          detail: `Margin 5P <b>${sgn(pMg5, 2)}%</b> · VN-Index 5P <b>${sgn(pPx5, 2)}%</b> (gap ${sgn(gap5, 2)} pp). ` +
            `20P: margin <b>${sgn(pMg20, 2)}%</b> / giá <b>${sgn(pPx20, 2)}%</b>.` +
            (bad5 || bad20 ? " <b style=\"color:var(--giam)\">Lệch pha xấu: đòn bẩy tăng khi giá yếu.</b>" : "")
        },
        {
          id: "liq", k: "Thanh khoản hệ thống", w: "30%",
          risk: rLiq, z: pillarZone(rLiq),
          detail: `Dư nợ/GTGD = <b>${nf(ratio, 1)}×</b> (percentile 60P: <b>${nf(pctile, 0)}</b>). ` +
            `GTGD 5P / 20P = <b>${nf(liqTrend, 2)}×</b>${liqTrend < 0.95 ? " — thanh khoản ngắn hạn mỏng hơn nền." : "."}`
        },
        {
          id: "room", k: "Room & tập trung CTCK", w: "30%",
          risk: rRoomAll, z: pillarZone(rRoomAll),
          detail: rRoom == null
            ? `Room còn lại từng CTCK: <b>chưa có nguồn công khai</b> (cần vốn chủ sở hữu từng công ty) · ` +
              `Top 3 CTCK <b>${nf(top3, 1)}%</b> dư nợ — điểm mục này tạm tính riêng theo độ tập trung.`
            : `Room bình quân có trọng số <b>${nf(roomW, 0)}%</b> · Top 3 CTCK <b>${nf(top3, 1)}%</b> dư nợ · ` +
              `<b>${tightN}</b>/${withRoom.length} CTCK room &lt;20%.`
        }
      ],
      raw: { pMg5, pPx5, gap5, pMg20, pPx20, gap20, ratio, pctile, liqTrend, roomW, top3, tightN }
    };
  }

  function renderMgRisk(box, risk) {
    // risk == null: thiếu giá hoặc GTGD nên ba trụ cột đều không tính được.
    if (!risk) {
      box.innerHTML = `<div class="mbr-foot">Chưa đủ dữ liệu giá / GTGD để chấm điểm rủi ro đòn bẩy cho phiên này — xem nhãn as-of ở đầu trang.</div>`;
      return;
    }
    const z = risk.zone, sc = risk.score;
    const pillars = risk.pillars.map(p => `
      <div class="mbr-p">
        <div class="mbr-p-top">
          <b>${p.k}</b>
          <span style="font-size:11px;color:var(--dim)">${p.w}</span>
          <span class="tag" style="background:${p.z.c}18;color:${p.z.c}">${p.z.n} · ${Math.round(p.risk)}</span>
        </div>
        <div class="bar"><i style="width:${p.risk.toFixed(0)}%;background:${p.z.c}"></i></div>
        <div class="meta">${p.detail}</div>
      </div>`).join("");

    box.innerHTML = `
      <div class="mbr-hd">
        <div>
          <h3>Chỉ số rủi ro đòn bẩy <span class="dtag dtag-proxy">Proxy</span></h3>
          <p class="sub">Góc banking · Phân kỳ · Thanh khoản · Room &amp; tập trung<br>
          Phiên ${dmyF(risk.date)} · điểm cao = rủi ro cao · không phải chuẩn UBCK</p>
        </div>
        <div class="mbr-badge" style="background:${z.c}14;color:${z.c}">
          <span class="lb">${z.n}</span>
          <span class="sc">${Math.round(sc)}<span>/100</span></span>
        </div>
      </div>
      <div class="mbr-track" aria-hidden="true"><i style="left:${sc}%"></i></div>
      <div class="mbr-scale"><span>0 An toàn</span><span>40 Theo dõi</span><span>70 Cảnh báo</span><span>100</span></div>
      <div class="mbr-pillars">${pillars}</div>
      <div class="mbr-foot">
        <b>Hành động gợi ý:</b> ${z.act}
        <div class="mbr-zones">
          <span style="background:var(--up-soft);color:var(--tang)">0–40 An toàn / lạnh</span>
          <span style="background:rgba(155,96,0,.12);color:var(--tc)">40–70 Theo dõi</span>
          <span style="background:var(--down-soft);color:var(--giam)">70–100 Cảnh báo</span>
        </div>
      </div>`;
  }

  (function marginUI() {
    const days = MARGIN.days;
    const L = days[days.length - 1];
    const prev1 = days[days.length - 2];
    const prev5 = days[days.length - 6] || days[0];
    const prev20 = days[days.length - 21] || days[0];
    const win = days.slice(-250);
    const hi = Math.max(...win.map(d => d.debt));
    const lo = Math.min(...win.map(d => d.debt));
    const d1 = L.debt - prev1.debt, p1 = d1 / prev1.debt * 100;
    const d5 = L.debt - prev5.debt, p5 = d5 / prev5.debt * 100;
    const d20 = L.debt - prev20.debt, p20 = d20 / prev20.debt * 100;
    // Thiếu GTGD thì tỷ lệ này không tồn tại — chia cho null ra Infinity và
    // nf() sẽ in "∞", tệ hơn một dấu gạch.
    const vsLiq = LAST.gtgd ? L.debt / LAST.gtgd : null;

    const risk = marginBankRisk();          // null = thiếu giá / GTGD, không tính được
    const rz = risk ? risk.zone : { c: "var(--dim)", n: "chưa đủ dữ liệu" };

    const avg1y = win.reduce((s, d) => s + d.debt, 0) / win.length;
    const vsAvg = (L.debt / avg1y - 1) * 100;

    el("mgStats").innerHTML = `
      <div class="stat"><div class="k">Dư nợ cuối ngày</div><div class="v">${nf(L.debt, 0)}</div><div class="m">tỷ đồng · ${dmyF(L.date)}</div></div>
      <div class="stat"><div class="k">Thay đổi 1 ngày</div><div class="v ${cls(d1)}">${sgn(d1, 0)}</div><div class="m ${cls(p1)}">${sgn(p1, 2)}% · ${d1 >= 0 ? "giải ngân ròng" : "thu nợ ròng"}</div></div>
      <div class="stat"><div class="k">5 / 20 phiên</div><div class="v ${cls(d5)}">${sgn(d5, 0)}</div><div class="m ${cls(d20)}">20P ${sgn(d20, 0)} (${sgn(p20, 1)}%)</div></div>
      <div class="stat"><div class="k">Vs TB 1 năm</div><div class="v ${cls(vsAvg)}">${sgn(vsAvg, 1)}%</div><div class="m">TB ${nf(avg1y / 1000, 1)}k tỷ · đỉnh ${nf(hi / 1000, 1)}k</div></div>
      <div class="stat"><div class="k">Dư nợ / GTGD phiên</div><div class="v">${nf(vsLiq, 1)}×</div><div class="m">GTGD HOSE ${nf(LAST.gtgd, 0)} tỷ</div></div>
      <div class="stat"><div class="k">Rủi ro đòn bẩy</div><div class="v" style="color:${rz.c}">${risk ? Math.round(risk.score) : "—"}</div><div class="m" style="color:${rz.c}">${rz.n} · proxy</div></div>`;

    el("mgLegend").innerHTML = [
      { k: "debt", n: "Dư nợ cuối ngày (tỷ đ)", c: "var(--blue)" },
      { k: "net", n: "Giải ngân ròng phiên", c: "var(--tc)" },
      { k: "vni", n: "VN-Index (trục phải)", c: "var(--tang)" }
    ].map(s => `<button class="lg" data-k="${s.k}" aria-pressed="true"><i class="sw" style="background:${s.c}"></i>${s.n}</button>`).join("");

    el("mgLegend").addEventListener("click", e => {
      const b = e.target.closest(".lg"); if (!b) return;
      mgOn[b.dataset.k] = !mgOn[b.dataset.k];
      b.setAttribute("aria-pressed", String(mgOn[b.dataset.k]));
      drawMargin();
    });
    el("mgPeriod").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      mgN = +b.dataset.n;
      [...e.currentTarget.children].forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      drawMargin();
    });

    el("mgBrokerBody").innerHTML = MARGIN.brokers.map((b, i) => `
      <tr>
        <td class="num" style="color:var(--dim)">${i + 1}</td>
        <td style="text-align:left"><b style="font-weight:600">${esc(b.code)}</b>
          <span style="color:var(--dim);font-size:11.5px;margin-left:6px">${esc(b.name)}</span></td>
        <td class="num" style="font-weight:600">${nf(b.debt, 0)}</td>
        <td class="num ${cls(b.d)}">${b.d == null ? "—" : sgn(b.d, 0)}</td>
        <td class="num">${b.share == null ? "—" : nf(b.share, 1) + "%"}</td>
        <td class="num" style="color:${b.room == null ? "var(--dim)" : b.room < 20 ? "var(--giam)" : b.room < 30 ? "var(--tc)" : "var(--tang)"}">${b.room == null ? "—" : nf(b.room, 0) + "%"}</td>
      </tr>`).join("");

    el("mgNote").innerHTML = `
      <b>Dư nợ margin</b> — thiết kế chốt <b>cuối mỗi phiên giao dịch</b>.
      Hiện <b>${nf(L.debt / 1000, 1)} nghìn tỷ</b> (${sgn(vsAvg, 1)}% so TB 1N)
      · đỉnh/đáy 1N: ${nf(hi / 1000, 1)}k / ${nf(lo / 1000, 1)}k.
      <br><span class="dtag dtag-sample">Mẫu</span>
      <span style="color:var(--dim)"> Nguồn public VN thường <b>tuần</b> (UBCK/tổng hợp); khi nối API ghi rõ tần suất &amp; as-of.
      ${esc(MARGIN.note)}</span>`;

    renderMgRisk(el("mgRiskBox"), risk);

    window.__mbrScore = risk ? risk.score : null;
    window.__mbrZone = rz.n;
    buildTape();
  })();

  function drawMargin() {
    const host = el("mgChart"); if (!host) return;
    const W = Math.max(420, host.clientWidth), H = 280;
    const m = { t: 16, r: 52, b: 32, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const data = MARGIN.days.slice(-mgN);
    const n = data.length;
    const X = i => m.l + (n < 2 ? iw / 2 : i / (n - 1) * iw);

    const debts = data.map(d => d.debt);
    const dlo = Math.min(...debts) * 0.985, dhi = Math.max(...debts) * 1.015;
    const YD = v => m.t + ih - (v - dlo) / (dhi - dlo) * ih;

    const vni = data.map(d => {
      for (let i = ROWS.length - 1; i >= 0; i--) if (ROWS[i].date <= d.date) return ROWS[i].close;
      return null;
    });
    const vv = vni.filter(v => v != null);
    const vlo = Math.min(...vv) * 0.99, vhi = Math.max(...vv) * 1.01;
    const YV = v => m.t + ih - (v - vlo) / (vhi - vlo) * ih;

    const nets = data.map(d => d.net);
    const nAbs = Math.max(400, ...nets.map(Math.abs));
    const barH = ih * 0.26;
    const YN0 = m.t + ih;
    const YN = v => YN0 - (v / nAbs) * barH;

    let g = "";
    for (let k = 0; k <= 4; k++) {
      const v = dlo + (dhi - dlo) * k / 4;
      g += `<line x1="${m.l}" y1="${YD(v).toFixed(1)}" x2="${W - m.r}" y2="${YD(v).toFixed(1)}" stroke="var(--line-soft)"/>
          <text x="${m.l - 8}" y="${(YD(v) + 4).toFixed(1)}" text-anchor="end" fill="var(--dim)" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${nf(v / 1000, 1)}k</text>`;
    }
    for (let k = 0; k <= 3; k++) {
      const v = vlo + (vhi - vlo) * k / 3;
      g += `<text x="${W - m.r + 8}" y="${(YV(v) + 4).toFixed(1)}" fill="var(--dim)" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${nf(v, 0)}</text>`;
    }
    const step = Math.max(1, Math.round(n / 7));
    for (let i = 0; i < n; i += step) {
      g += `<text x="${X(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="var(--dim)" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${dmy(data[i].date)}</text>`;
    }

    if (mgOn.net) {
      const bw = Math.max(1.2, iw / n * 0.55);
      data.forEach((d, i) => {
        const y1 = YN(d.net), top = Math.min(YN0, y1), h = Math.abs(y1 - YN0);
        g += `<rect class="bar" x="${(X(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}"
             fill="${d.net >= 0 ? 'var(--up-soft)' : 'var(--down-soft)'}" opacity=".9"/>`;
      });
    }

    const path = (vals, Yf) => vals.map((v, i) => v == null ? null : (i === 0 || vals[i - 1] == null ? "M" : "L") + X(i).toFixed(1) + " " + Yf(v).toFixed(1)).filter(Boolean).join(" ");

    if (mgOn.debt) {
      const d = path(debts, YD);
      g += `<path d="${d} L ${X(n - 1).toFixed(1)} ${m.t + ih} L ${X(0).toFixed(1)} ${m.t + ih} Z" fill="var(--blue)" opacity=".08"/>`;
      g += `<path class="draw" pathLength="1" d="${d}" fill="none" stroke="var(--blue)" stroke-width="2.2" stroke-linejoin="round"/>`;
      g += `<circle class="pop" cx="${X(n - 1).toFixed(1)}" cy="${YD(debts[n - 1]).toFixed(1)}" r="3.5" fill="var(--blue)"/>`;
    }
    if (mgOn.vni) {
      g += `<path class="draw" pathLength="1" d="${path(vni, YV)}" fill="none" stroke="var(--tang)" stroke-width="1.6" stroke-linejoin="round" opacity=".85" stroke-dasharray="4 3"/>`;
    }

    g += `<g id="mgcross" style="opacity:0"><line y1="${m.t}" y2="${m.t + ih}" stroke="var(--text)" stroke-width="1" stroke-dasharray="3 3" opacity=".35"/></g>`;

    host.innerHTML = `<div class="tip" id="mgTip"></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ dư nợ margin hàng ngày">${g}</svg>`;

    const tip = el("mgTip"), svg = host.querySelector("svg"), cross = host.querySelector("#mgcross line");
    svg.addEventListener("mousemove", ev => {
      const rect = svg.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width * W;
      let i = Math.round((x - m.l) / iw * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      const d = data[i];
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i));
      cross.parentElement.style.opacity = 1;
      tip.style.opacity = 1;
      tip.style.left = Math.min(rect.width - 210, Math.max(8, (X(i) / W) * rect.width + 12)) + "px";
      tip.style.top = "12px";
      tip.innerHTML = `<div class="d">Phiên ${dmyF(d.date)}</div>
        <div class="r"><span>Dư nợ cuối ngày</span><span>${nf(d.debt, 0)} tỷ</span></div>
        <div class="r"><span>Giải ngân ròng</span><span class="${cls(d.net)}">${sgn(d.net, 0)} tỷ</span></div>
        <div class="r"><span>VN-Index</span><span>${vni[i] == null ? "—" : nf(vni[i])}</span></div>`;
    });
    svg.addEventListener("mouseleave", () => { tip.style.opacity = 0; cross.parentElement.style.opacity = 0; });
  }
  drawMargin();
  window.addEventListener("resize", () => { clearTimeout(window.__mgR); window.__mgR = setTimeout(drawMargin, 120); });

  /* ============================================================
     9. BIỂU ĐỒ HỆ SỐ ADR
     ============================================================ */
  const rOn = { vn30: true, vn100: true, index: true, gtgd: true };
  let rN = 126, rW = 25;

  el("winSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    rW = +b.dataset.w;
    [...e.currentTarget.children].forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    el("ratioLegend").querySelector('[data-k="vn30"]').lastChild.textContent = "ADR " + rW + " · rổ VN30";
    el("ratioLegend").querySelector('[data-k="vn100"]').lastChild.textContent = "ADR " + rW + " · rổ VN100";
    drawRatio();
  });

  el("ratioLegend").innerHTML = [
    { k: "vn30", n: "ADR 25 · rổ VN30", c: "var(--tran)" },
    { k: "vn100", n: "ADR 25 · rổ VN100", c: "var(--tc)" },
    { k: "index", n: "VN-Index (trục phải)", c: "var(--tang)" },
    { k: "gtgd", n: "GTGD khớp lệnh (tỷ đồng)", c: "var(--series-gtgd)" }
  ].map(s => `<button class="lg" data-k="${s.k}" aria-pressed="true"><i class="sw" style="background:${s.c}"></i>${s.n}</button>`).join("");
  el("ratioLegend").addEventListener("click", e => {
    const b = e.target.closest(".lg"); if (!b) return;
    rOn[b.dataset.k] = !rOn[b.dataset.k];
    b.setAttribute("aria-pressed", String(rOn[b.dataset.k]));
    drawRatio();
  });
  el("periodSeg").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    rN = +b.dataset.n;
    [...e.currentTarget.children].forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    drawRatio();
  });

  let ratioGeom = null;
  function drawRatio() {
    const host = el("ratioChart"), W = Math.max(420, host.clientWidth), H = 430;
    const m = { t: 18, r: 58, b: 34, l: 46 };
    const volH = 78, gap = 16;
    const ih = H - m.t - m.b - volH - gap;
    const volTop = m.t + ih + gap;
    const data = ROWS.slice(-rN);
    const n = data.length;
    const iw = W - m.l - m.r;
    const X = i => m.l + (n < 2 ? iw / 2 : i / (n - 1) * iw);

    const rv = data.flatMap(d => [d.vn30.r[rW], d.vn100.r[rW]]).filter(v => v != null);
    let rlo = Math.min(40, Math.floor(Math.min(...rv) / 10) * 10 - 5);
    let rhi = Math.max(160, Math.ceil(Math.max(...rv) / 10) * 10 + 5);
    const YR = v => m.t + ih - (v - rlo) / (rhi - rlo) * ih;

    // Lọc null trước khi lấy min/max: một phiên thiếu giá/GTGD sẽ làm cả trục
    // thành NaN và biểu đồ biến mất, thay vì chỉ khuyết đúng điểm đó.
    const pv = data.map(d => d.close).filter(v => v != null);
    const plo = pv.length ? Math.min(...pv) * 0.985 : 0;
    const phi = pv.length ? Math.max(...pv) * 1.015 : 1;
    const YP = v => m.t + ih - (v - plo) / (phi - plo) * ih;

    const gv = data.map(d => d.gtgd).filter(v => v != null);
    const vmax = gv.length ? Math.max(...gv) * 1.1 : 1;
    const YV = v => volTop + volH - v / vmax * volH;

    let g = "";
    if (rhi > 120) g += `<rect x="${m.l}" y="${YR(rhi).toFixed(1)}" width="${iw}" height="${(YR(120) - YR(rhi)).toFixed(1)}" fill="var(--giam)" opacity=".055"/>`;
    if (rlo < 80) g += `<rect x="${m.l}" y="${YR(80).toFixed(1)}" width="${iw}" height="${(YR(rlo) - YR(80)).toFixed(1)}" fill="var(--tang)" opacity=".055"/>`;

    for (let v = Math.ceil(rlo / 20) * 20; v <= rhi; v += 20) {
      const key = (v === 120 || v === 80);
      g += `<line x1="${m.l}" y1="${YR(v).toFixed(1)}" x2="${W - m.r}" y2="${YR(v).toFixed(1)}" stroke="${key ? (v === 120 ? 'var(--giam)' : 'var(--tang)') : 'var(--line-soft)'}" ${key ? 'stroke-dasharray="4 4" opacity=".55"' : ''}/>
          <text x="${m.l - 8}" y="${(YR(v) + 4).toFixed(1)}" text-anchor="end" fill="${key ? (v === 120 ? 'var(--giam)' : 'var(--tang)') : 'var(--dim)'}" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${v}</text>`;
    }
    for (let k = 0; k <= 4; k++) {
      const v = plo + (phi - plo) * k / 4;
      g += `<text x="${W - m.r + 8}" y="${(YP(v) + 4).toFixed(1)}" fill="var(--dim)" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${nf(v, 0)}</text>`;
    }
    const step = Math.max(1, Math.round(n / 7));
    for (let i = 0; i < n; i += step) {
      g += `<line x1="${X(i).toFixed(1)}" y1="${m.t}" x2="${X(i).toFixed(1)}" y2="${volTop + volH}" stroke="var(--line-soft)" opacity=".55"/>
          <text x="${X(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" fill="var(--dim)" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${dmy(data[i].date)}</text>`;
    }
    g += `<line x1="${m.l}" y1="${volTop + volH}" x2="${W - m.r}" y2="${volTop + volH}" stroke="var(--line)"/>`;
    g += `<text x="${m.l - 8}" y="${(volTop + 11).toFixed(1)}" text-anchor="end" fill="var(--dim)" font-size="9" font-family="IBM Plex Mono, ui-monospace, monospace">${nf(vmax / 1000, 0)}k</text>`;

    if (rOn.gtgd) {
      const bw = Math.max(1.2, iw / n * 0.62);
      data.forEach((d, i) => {
        g += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${YV(d.gtgd).toFixed(1)}" width="${bw.toFixed(1)}" height="${(volTop + volH - YV(d.gtgd)).toFixed(1)}" fill="${d.pct == null ? 'var(--line)' : d.pct >= 0 ? 'var(--up-soft)' : 'var(--down-soft)'}" opacity=".85"/>`;
      });
    }
    const path = (vals, Yf) => vals.map((v, i) => v == null ? null : (i === 0 || vals[i - 1] == null ? "M" : "L") + X(i).toFixed(1) + " " + Yf(v).toFixed(1)).filter(Boolean).join(" ");

    if (rOn.index) {
      const d = path(data.map(x => x.close), YP);
      g += `<path class="draw" pathLength="1" d="${d}" fill="none" stroke="var(--tang)" stroke-width="1.7" opacity=".85" stroke-linejoin="round"/>`;
    }
    if (rOn.vn30) g += `<path class="draw" pathLength="1" d="${path(data.map(x => x.vn30.r[rW]), YR)}" fill="none" stroke="var(--tran)" stroke-width="1.8" stroke-linejoin="round" opacity=".9"/>`;
    if (rOn.vn100) g += `<path class="draw" pathLength="1" d="${path(data.map(x => x.vn100.r[rW]), YR)}" fill="none" stroke="var(--tc)" stroke-width="2.4" stroke-linejoin="round"/>`;

    g += `<g id="rcross" style="opacity:0">
          <line y1="${m.t}" y2="${volTop + volH}" stroke="var(--text)" stroke-width="1" stroke-dasharray="3 3" opacity=".35"/>
          <circle r="4.5" fill="var(--surface)" stroke="var(--blue)" stroke-width="2.2"/>
        </g>`;

    host.querySelector("svg")?.remove();
    host.insertAdjacentHTML("afterbegin",
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ hệ số ADR của rổ VN30 và VN100 so với VN-Index">${g}</svg>`);
    ratioGeom = { W, H, m, X, n, data, YR, YP, volTop, volH };
  }

  (function ratioHover() {
    const host = el("ratioChart"), tip = el("ratioTip");
    function move(ev) {
      if (!ratioGeom) return;
      const svg = host.querySelector("svg"); if (!svg) return;
      const b = svg.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - b.left;
      const sx = px / b.width * ratioGeom.W;
      const { m, n, data, X } = ratioGeom;
      let i = Math.round((sx - m.l) / ((ratioGeom.W - m.r - m.l) || 1) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      const d = data[i];
      const cx = X(i);
      const cross = svg.querySelector("#rcross");
      if (cross) {
        cross.style.opacity = "1";
        cross.querySelector("line").setAttribute("x1", cx);
        cross.querySelector("line").setAttribute("x2", cx);
        const c = cross.querySelector("circle");
        c.setAttribute("cx", cx);
        c.setAttribute("cy", d.vn100.r[rW] != null ? ratioGeom.YR(d.vn100.r[rW]) : ratioGeom.YP(d.close));
      }
      tip.innerHTML = `<div class="d">${dmyF(d.date)}</div>
        <div class="r"><span>VN-Index</span><span class="${cls(d.pct)}">${nf(d.close)} · ${sgn(d.pct)}%</span></div>
        <div class="r"><span>ADR ${rW} · VN100</span><span style="color:var(--tc)">${nf(d.vn100.r[rW], 1)}</span></div>
        <div class="r"><span>ADR ${rW} · VN30</span><span style="color:var(--tran)">${nf(d.vn30.r[rW], 1)}</span></div>
        <div class="r"><span>Mã tăng / giảm</span><span><span class="up">${nf(d.all.a, 0)}</span> / <span class="down">${nf(d.all.d, 0)}</span></span></div>
        <div class="r"><span>GTGD</span><span>${nf(d.gtgd, 0)} tỷ</span></div>`;
      tip.style.opacity = "1";
      const left = cx / ratioGeom.W * b.width;
      tip.style.left = Math.min(b.width - 190, Math.max(0, left + 14)) + "px";
      tip.style.top = "14px";
    }
    host.addEventListener("mousemove", move);
    host.addEventListener("touchmove", e => { move(e); }, { passive: true });
    host.addEventListener("mouseleave", () => {
      tip.style.opacity = "0";
      host.querySelector("#rcross")?.style.setProperty("opacity", "0");
    });
  })();

  /* ============================================================
     10. BẢNG 90 PHIÊN
     ============================================================ */
  let scope = "all";
  el("rowScope").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    scope = b.dataset.k;
    [...e.currentTarget.children].forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    drawHist();
  });
  const hl = v => {
    if (v == null) return "";
    if (v < 70) return "rt-lo";
    if (v < 80) return "";
    if (v < 100) return "";
    return "rt-h" + Math.min(5, Math.floor((v - 100) / 10));
  };
  /* Chèn thêm dòng cuối tuần (T7/CN) rỗng giữa hai phiên liền kề — chỉ để hiển
     thị liên tục theo lịch, KHÔNG đưa vào ROWS gốc vì các panel khác (biểu đồ
     ADR, dự phóng, gauge...) đều giả định ROWS chỉ gồm phiên giao dịch. Khoảng
     nghỉ lễ (không phải T7/CN) vẫn bị bỏ qua như trước, không chèn dòng. */
  function withWeekendGaps(tradingRowsDesc) {
    const out = [];
    for (let i = 0; i < tradingRowsDesc.length; i++) {
      out.push(tradingRowsDesc[i]);
      if (i === tradingRowsDesc.length - 1) continue;
      const stop = tradingRowsDesc[i + 1].date;
      const cur = new Date(tradingRowsDesc[i].date + "T00:00:00Z");
      let guard = 0;
      while (guard++ < 10) {
        cur.setUTCDate(cur.getUTCDate() - 1);
        const k = cur.toISOString().slice(0, 10);
        if (k === stop) break;
        const w = cur.getUTCDay();
        if (w === 0 || w === 6) out.push({ date: k, weekend: true });
      }
    }
    return out;
  }

  function drawHist() {
    const tradingData = ROWS.slice(-90).reverse();
    const data = withWeekendGaps(tradingData);
    const realCount = tradingData.filter(d => d.real).length;
    const tag = el("histTag");
    if (tag) {
      if (realCount >= tradingData.length) { tag.textContent = "Dữ liệu thật"; tag.className = "dtag dtag-live"; }
      else if (realCount > 0) { tag.textContent = realCount + "/" + tradingData.length + " phiên thật"; tag.className = "dtag dtag-proxy"; }
      else { tag.textContent = "Mẫu"; tag.className = "dtag dtag-sample"; }
    }
    el("histBody").innerHTML = data.map(d => {
      if (d.weekend) {
        return `<tr class="wknd">
        <td class="num" style="color:var(--dim)">${dmyF(d.date)}</td>
        <td colspan="12" style="color:var(--dim);font-style:italic">Cuối tuần — không giao dịch</td>
      </tr>`;
      }
      const s = d[scope];
      const hasBreadth = s.a != null && s.d != null && s.u != null;
      const tot = hasBreadth ? (s.a + s.d + s.u || 1) : 1;
      const cells = WINDOWS.map((w, i) =>
        `<td class="num rt ${hl(s.r[w])}${i === 0 ? ' grp-l' : ''}">${nf(s.r[w], 1)}</td>`).join("");
      const dotTitle = !d.real ? "" : d.breadthReal
        ? "Giá đóng cửa và cơ cấu tăng/giảm đều là dữ liệu thật"
        : "Giá đóng cửa là dữ liệu thật · cơ cấu tăng/giảm chưa có (chưa có nguồn HOSE breadth miễn phí) — hiển thị —, không bịa số";
      const bb = hasBreadth
        ? `<div class="bb" title="${s.a} mã tăng · ${s.u} mã tham chiếu · ${s.d} mã giảm">
          <i style="width:${(s.a / tot * 100).toFixed(1)}%;background:var(--tang)"></i>
          <i style="width:${(s.u / tot * 100).toFixed(1)}%;background:var(--tc)"></i>
          <i style="width:${(s.d / tot * 100).toFixed(1)}%;background:var(--giam)"></i>
        </div>`
        : `<div class="bb" title="Chưa có dữ liệu tăng/giảm thật"><i style="width:100%;background:var(--line)"></i></div>`;
      return `<tr${d.real ? "" : ' class="smp"'}>
        <td class="num" style="color:var(--muted)">${d.real ? `<i class="dot live" title="${esc(dotTitle)}" style="margin-right:5px"></i>` : ''}${dmyF(d.date)}</td>
        <td class="num" style="font-weight:600">${nf(d.close)}</td>
        <td class="num ${cls(d.pct)}">${sgn(d.chg)}</td>
        <td class="num ${cls(d.pct)}">${sgn(d.pct)}%</td>
        <td class="num" style="color:var(--muted)">${nf(d.gtgd, 0)}</td>
        <td class="num up">${hasBreadth ? s.a : "—"}</td>
        <td class="num down">${hasBreadth ? s.d : "—"}</td>
        <td class="num flat">${hasBreadth ? s.u : "—"}</td>
        <td>${bb}</td>
        ${cells}
      </tr>`;
    }).join("");
  }

  /* ============================================================
     11. DỰ PHÓNG PHIÊN KẾ TIẾP
     ============================================================ */
  const SUMS = {};
  WINDOWS.forEach(w => {
    const win = ROWS.slice(-w).map(r => r.vn100);
    // Chỉ tính khi cả w phiên trong cửa sổ đều có breadth thật — thiếu 1 phiên
    // cũng đủ làm sai lệch tổng, không được coi thiếu là 0 (JS coerce null->0).
    const complete = win.every(r => r.a != null && r.d != null);
    SUMS[w] = complete
      ? { A: win.reduce((s, r) => s + r.a, 0), D: win.reduce((s, r) => s + r.d, 0), o: win[0] }
      : null;
  });
  const projRatio = (a, d, w) => {
    const s = SUMS[w];
    if (!s) return null;
    const A = s.A - s.o.a + a, D = s.D - s.o.d + d;
    return D > 0 ? A / D * 100 : 200;
  };
  function updateProj() {
    const a = +el("pUp").value, d = +el("pDown").value;
    if (a + d > 100) {
      if (document.activeElement === el("pUp")) el("pDown").value = 100 - a;
      else el("pUp").value = 100 - d;
    }
    const A = +el("pUp").value, D = +el("pDown").value;
    el("pUpV").textContent = A; el("pDownV").textContent = D;
    el("projStats").innerHTML = WINDOWS.map(w => {
      const now = LAST.vn100.r[w], next = projRatio(A, D, w);
      const dd = (now == null || next == null) ? null : next - now;
      return `<div class="stat">
        <div class="k">${w} phiên</div>
        <div class="v"><span class="chip ${hl(next)}">${nf(next, 1)}</span></div>
        <div class="m">phiên gần nhất ${nf(now, 1)} · <span class="${cls(dd)}">${sgn(dd, 1)}</span></div>
      </div>`;
    }).join("");
  }
  ["pUp", "pDown"].forEach(id => el(id).addEventListener("input", updateProj));

  el("scenBody").innerHTML = [
    ["Tăng rất mạnh", 88, 7], ["Tăng", 66, 26], ["Cân bằng", 47, 44], ["Giảm", 26, 66], ["Giảm rất mạnh", 7, 88]
  ].map(([n, a, d]) => {
    const tds = WINDOWS.map(w => { const v = projRatio(a, d, w); return `<td class="num rt ${hl(v)}">${nf(v, 1)}</td>`; }).join("");
    return `<tr><td>${n}</td><td class="num"><span class="up">${a}</span>/<span class="down">${d}</span></td>${tds}</tr>`;
  }).join("");

  function drawWindows() {
    const host = el("winChart"), W = Math.max(300, host.clientWidth), H = 250;
    const m = { t: 16, r: 14, b: 32, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = WINDOWS.flatMap(w => [LAST.vn100.r[w], LAST.vn30.r[w]]).filter(v => v != null);
    const lo = Math.min(60, ...vals) - 8;
    const hi = Math.max(140, ...vals) + 8;
    const Y = v => m.t + ih - (v - lo) / (hi - lo) * ih;
    let g = "";
    if (hi > 120) g += `<rect x="${m.l}" y="${Y(hi).toFixed(1)}" width="${iw}" height="${(Y(120) - Y(hi)).toFixed(1)}" fill="var(--giam)" opacity=".07"/>`;
    if (lo < 80) g += `<rect x="${m.l}" y="${Y(80).toFixed(1)}" width="${iw}" height="${(Y(lo) - Y(80)).toFixed(1)}" fill="var(--tang)" opacity=".07"/>`;
    [80, 100, 120].forEach(v => {
      if (v < lo || v > hi) return;
      const c = v === 120 ? "var(--giam)" : v === 80 ? "var(--tang)" : "var(--line)";
      g += `<line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${W - m.r}" y2="${Y(v).toFixed(1)}" stroke="${c}" stroke-dasharray="4 4" opacity=".6"/>
          <text x="${m.l - 7}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" fill="${c}" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${v}</text>`;
    });
    const gw = iw / WINDOWS.length, bw = Math.min(26, gw * 0.28);
    WINDOWS.forEach((w, i) => {
      const cx = m.l + gw * (i + 0.5);
      [["vn100", "var(--tc)", -1], ["vn30", "var(--tran)", 1]].forEach(([k, c, side]) => {
        const v = LAST[k].r[w], x = cx + side * bw * 0.58 - bw / 2;
        if (v == null) {
          g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(Y(100) - 6).toFixed(1)}" text-anchor="middle" fill="var(--dim)" font-size="10.5" font-family="IBM Plex Mono, ui-monospace, monospace">—</text>`;
          return;
        }
        const y = Y(v), y0 = Y(100);
        g += `<rect x="${x.toFixed(1)}" y="${Math.min(y, y0).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2, Math.abs(y - y0)).toFixed(1)}" class="bar" fill="${c}" opacity=".88" rx="3"/>
            <text x="${(x + bw / 2).toFixed(1)}" y="${(Math.min(y, y0) - 6).toFixed(1)}" text-anchor="middle" fill="${c}" font-size="10.5" font-weight="600" font-family="IBM Plex Mono, ui-monospace, monospace">${nf(v, 0)}</text>`;
      });
      g += `<text x="${cx.toFixed(1)}" y="${H - 11}" text-anchor="middle" fill="var(--dim)" font-size="10.5" font-family="IBM Plex Mono, ui-monospace, monospace">${w} phiên</text>`;
    });
    host.querySelector("svg")?.remove();
    host.insertAdjacentHTML("afterbegin",
      `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="So sánh hệ số ADR theo bốn chu kỳ 25, 15, 10 và 6 phiên">${g}</svg>`);
  }
  el("winDate").textContent = dmyF(LAST.date);
  (function () {
    const s = LAST.vn100, fast = s.r[6], slow = s.r[25];
    const dir = (fast == null || slow == null)
      ? `<b class="flat">Chưa đủ dữ liệu tăng/giảm thật</b> để so sánh chu kỳ ngắn/dài — nguồn breadth đang stale.`
      : fast > slow + 6 ? `<b class="down">Chu kỳ ngắn đang cao hơn chu kỳ dài</b> — lực cầu vừa tăng tốc trong vài phiên gần nhất, đồng thời là lúc chỉ báo dễ chạm vùng quá mua sớm.`
      : fast < slow - 6 ? `<b class="up">Chu kỳ ngắn đang thấp hơn chu kỳ dài</b> — áp lực cung mới xuất hiện và chưa phản ánh hết vào hệ số chu kỳ 25 phiên.`
      : `<b class="flat">Bốn chu kỳ đang đồng pha</b> — tương quan cung cầu ổn định, chưa xuất hiện chuyển biến đột ngột trong ngắn hạn.`;
    el("winNote").innerHTML = `Cột vàng = rổ VN100, cột tím = rổ VN30, lệch từ mốc 100. ${dir} Chu kỳ 6–10 phiên phản ứng nhanh; <b>25 phiên</b> là chu kỳ chuẩn vùng quá mua (&gt;120) / quá bán (&lt;80), quá bán sâu (&lt;70).`;
  })();

  /* ============================================================
     12. TIN VĨ MÔ — Mỹ ⇄ Việt Nam
     ============================================================ */
  /* Tin tức được agent local tổng hợp mỗi ngày từ RSS thật (VnEconomy, Fed) —
     xem automation/daily_update.py (fetch thô) + automation/agent_daily_prompt.md
     (tổng hợp thẻ tin). NEWS_DATA truyền vào từ useNews() (MarketDashboardApp.jsx);
     không còn mảng tin hardcode — tránh lặp lại đúng bug đã sửa: nội dung tĩnh
     không bao giờ tự cập nhật. category/impact quyết định badge màu gì, không
     bắt agent phải biết tên class CSS nội bộ. */
  const CATEGORY_META = {
    fed: { badge: "Fed / FOMC", badgeCls: "b-blue" },
    "us-macro": { badge: "Kinh tế Mỹ", badgeCls: "b-red" },
    "vn-macro": { badge: "Việt Nam", badgeCls: "b-gold" },
    geopolitical: { badge: "Địa chính trị", badgeCls: "b-violet" },
    other: { badge: "Vĩ mô", badgeCls: "b-violet" }
  };
  const NEWS = (NEWS_DATA && Array.isArray(NEWS_DATA.items) ? NEWS_DATA.items : []).map(it => {
    const meta = CATEGORY_META[it.category] || CATEGORY_META.other;
    return {
      cls: it.category || "other",
      date: it.date,
      time: it.time ? it.time + " ICT" : "",
      badge: meta.badge,
      badgeCls: meta.badgeCls,
      hot: (it.impact || 0) >= 3,
      impact: it.impact || 1,
      title: it.title,
      data: Array.isArray(it.stats) ? it.stats : [],
      bullets: Array.isArray(it.bullets) ? it.bullets : [],
      chips: (Array.isArray(it.tags) ? it.tags : []).map(t => [t, "flat"]),
      vn: it.vnImpact || "",
      src: it.source || "",
      srcUrl: it.sourceUrl || null
    };
  });

  /* Ngày/giờ theo lịch công bố chính thức BLS/Fed (giờ ET quy đổi sang ICT,
     UTC-4 mùa DST) — đã đối chiếu với bls.gov & federalreserve.gov trước khi
     đưa vào, không phải suy đoán. time=null khi cơ quan công bố (GSO) chưa
     có giờ cố định công khai.

     forecast/previous/actual: số liệu THẬT theo đúng đơn vị agent ghi trong
     "unit" — để null nếu CHƯA có nguồn xác nhận (chưa công bố, hoặc chưa ai
     nhập số vào đây), UI tự hiện "—", KHÔNG bao giờ suy đoán/nội suy số kinh
     tế (xem CLAUDE.md §1.3/§1.5). goodDirection ("up"|"down"|null) = số CAO
     hơn có phải tín hiệu tích cực cho VN-Index không (vd NFP cao = tốt →
     "up"; CPI cao = xấu → "down") — chỉ tô màu actual khi field này VÀ cả
     forecast lẫn actual đều có số thật, tránh tô màu sai hướng khi chưa chắc.
     Nhập actual ngay khi có số công bố thật — đừng để trống mãi rồi quên. */
  const CAL = [
    { date: "2026-08-12", time: "19:30", title: "CPI Mỹ tháng 7", note: "Dữ liệu quyết định cho cuộc họp tháng 9 · 8:30 ET",
      unit: "% m/m", forecast: null, previous: null, actual: null, goodDirection: "down" },
    { date: "2026-08-28", time: "19:30", title: "PCE lõi tháng 7", note: "Thước đo lạm phát Fed ưu tiên · 8:30 ET",
      unit: "% m/m", forecast: null, previous: null, actual: null, goodDirection: "down" },
    { date: "2026-09-04", time: "19:30", title: "Bảng lương phi nông nghiệp tháng 8", note: "Xác nhận xu hướng việc làm suy yếu · 8:30 ET",
      unit: "K", forecast: null, previous: null, actual: null, goodDirection: "up" },
    { date: "2026-09-17", time: "01:00", title: "Kết quả họp FOMC (15–16/9)", note: "Thị trường định giá khả năng tăng 25 bps · 14:00 ET ngày 16/9",
      unit: "%", forecast: null, previous: null, actual: null, goodDirection: null },
    { date: "2026-09-30", time: null, title: "GDP & CPI quý III Việt Nam", note: "Cơ sở cho điều hành tỷ giá quý IV · GSO chưa công bố giờ cụ thể",
      unit: "%", forecast: null, previous: null, actual: null, goodDirection: null },
  ];

  (function news() {
    const updEl = el("newsUpdated");
    if (updEl) {
      const gen = NEWS_DATA && NEWS_DATA.generatedAtIct;
      updEl.textContent = gen
        ? "Agent tổng hợp lúc " + dmyF(gen.slice(0, 10)) + " " + gen.slice(11, 16) + " ICT"
        : "Chưa có lần tổng hợp nào";
      // `news.json` KHÔNG do script nào sinh (CLAUDE.md §1.5) — nó chỉ mới khi
      // có người hoặc agent chạy bước biên tập. Trước đây chỗ này chỉ IN dấu
      // thời gian, nên bản tổng hợp ngày 2026-08-13 nằm trên trang SUỐT BẢY
      // TUẦN mà nhìn vẫn như tin mới: tiêu đề tin không tự già đi, chỉ có một
      // dòng chữ xám ở trên nói ngày, và không ai trừ ngày trong đầu.
      //
      // Nhãn nói rõ "chưa biên tập lại", không nói "pipeline dừng" — pipeline
      // vẫn chạy tốt và `news-raw.json` vẫn mới mỗi ngày.
      attachStaleTag(updEl, gen ? gen.slice(0, 10) : null, {
        label: (d) => `tin cũ ${d} phiên — chưa biên tập lại`,
      });
    }
    const impactBars = n => `<span class="impact" title="Mức tác động ${n}/3">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join("")}</span>`;
    const DAY = 864e5, base = new Date(ASOF + "T00:00:00Z").getTime();
    const isNew = d => d && (base - new Date(d + "T00:00:00Z").getTime()) / DAY <= 3;
    const NEWICON = `<svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 .8l1.5 3.1 3.4.5-2.5 2.4.6 3.4L6 8.6 2.9 10.2l.6-3.4L1 4.4l3.4-.5L6 .8z" fill="currentColor"/></svg>`;

    const cardHtml = n => {
      const fresh = isNew(n.date);
      const srcHtml = n.srcUrl
        ? `<a href="${esc(n.srcUrl)}" target="_blank" rel="noopener">Nguồn: ${n.src}</a>`
        : `Nguồn: ${n.src}`;
      return `
      <article class="ncard ${n.cls}${n.hot ? ' hot' : ''}">
        <div class="nc-in">
          <div class="nmeta">
            ${fresh ? `<span class="badge-new">${NEWICON}New</span>` : ``}
            <span class="badge ${n.badgeCls}">${n.badge}</span>
            <span class="ntime">${dmyF(n.date)}${n.time ? " · " + n.time : ""}</span>
            ${impactBars(n.impact)}
          </div>
          <h3 class="ntitle">${n.title}</h3>
          ${n.data.length ? `<div class="ndata">${n.data.map(([k, v, c]) =>
            `<div><div class="lb">${k}</div><div class="vl ${c === 'dim' ? '' : c}" ${c === 'dim' ? 'style="color:var(--muted)"' : ''}>${v}</div></div>`).join("")}</div>` : ""}
          <ul class="nlist">${n.bullets.map(b => `<li>${b}</li>`).join("")}</ul>
          ${n.chips.length ? `<div class="nchips">${n.chips.map(([t, c]) => `<span class="chipx ${c}">${t}</span>`).join("")}</div>` : ""}
          ${n.vn ? `<div class="nvn">${n.vn}</div>` : ""}
          <div class="nsrc">${srcHtml}</div>
        </div>
      </article>`;
    };
    const emptyCard = msg => `
      <article class="ncard">
        <div class="nc-in">
          <div class="nmeta"><span class="badge b-gold">Chưa có tin</span></div>
          <p class="nvn" style="margin:0">${msg}</p>
        </div>
      </article>`;

    /* 1. Lịch sự kiện kinh tế Mỹ — CAL tĩnh, đã đối chiếu bls.gov/federalreserve.gov.
       Format Dự báo/Kỳ trước/Thực tế kiểu economic calendar chuyên nghiệp
       (Investing.com/TradingEconomics) — số nào chưa có nguồn thật thì "—",
       không suy đoán (xem ghi chú ngay trên khai báo CAL). */
    const fmtVal = (v, unit) => (v == null ? "—" : `${v > 0 && unit !== "%" ? "+" : ""}${v}${unit}`);
    // Ghi đè forecast/previous/actual bằng số thật agent tìm được (Task 3,
    // automation/agent_daily_prompt.md), key theo đúng date của dòng CAL —
    // xem econ-actuals.json. Dòng nào agent chưa tìm ra thì vẫn giữ null từ
    // CAL (hiện "—"), không suy đoán.
    const econByDate = (ECON_ACTUALS && typeof ECON_ACTUALS === "object") ? ECON_ACTUALS : {};
    el("newsSchedule").innerHTML = `
      <article class="ncard">
        <div class="nc-in">
          <div class="cal-scroll">
          <table class="cal"><thead><tr>
            <th>Ngày/Giờ</th><th>Sự kiện</th><th class="num">Dự báo</th><th class="num">Kỳ trước</th><th class="num">Thực tế</th>
          </tr></thead><tbody>
            ${CAL.map(row => {
              const found = econByDate[row.date];
              const merged = found ? { ...row, ...found } : row;
              const { date: d, time: t, title: e, note: f, unit, forecast, previous, actual, goodDirection } = merged;
              const days = Math.round((new Date(d + "T00:00:00Z").getTime() - base) / DAY);
              const when = days < 0 ? `${Math.abs(days)} ngày trước`
                : days === 0 ? "Hôm nay" : days === 1 ? "Ngày mai" : `Còn ${days} ngày`;
              const whenCls = days >= 0 && days <= 7 ? "soon" : "";
              // Chỉ tô beat/miss khi có ĐỦ actual + forecast + goodDirection — thiếu 1 trong 3 thì hiện màu trung tính (không đoán hướng).
              let actualCls = "flat";
              if (actual != null && forecast != null && goodDirection) {
                const beat = goodDirection === "up" ? actual > forecast : actual < forecast;
                const miss = goodDirection === "up" ? actual < forecast : actual > forecast;
                actualCls = beat ? "up" : miss ? "down" : "flat";
              }
              return `<tr>
                <td class="dt">${dmyF(d)}${t ? `<br>${t} ICT` : ""}<span class="ef ${whenCls}">${when}</span></td>
                <td class="ev">${e}<span class="ef">${f}</span></td>
                <td class="num">${fmtVal(forecast, unit)}</td>
                <td class="num">${fmtVal(previous, unit)}</td>
                <td class="num ${actualCls}" style="font-weight:700">${fmtVal(actual, unit)}</td>
              </tr>`;
            }).join("")}
          </tbody></table>
          </div>
          <div class="nsrc">Ngày/giờ đối chiếu lịch công bố chính thức BLS &amp; Fed (bls.gov, federalreserve.gov) — GDP/CPI Việt Nam theo lịch GSO, có thể xê dịch. Dự báo/Kỳ trước/Thực tế: "—" nghĩa là chưa có nguồn xác nhận, không phải bằng 0.</div>
        </div>
      </article>`;

    /* 2. Kết quả chỉ số kinh tế Mỹ (NonFarm, thất nghiệp, CPI, FOMC...) — tin agent
       gắn category fed/us-macro/geopolitical, cộng thẻ giải thích kênh truyền dẫn. */
    const usResults = NEWS.filter(n => n.cls === "fed" || n.cls === "us-macro" || n.cls === "geopolitical" || n.cls === "other");
    el("newsResults").innerHTML =
      (usResults.length ? usResults.map(cardHtml).join("")
        : emptyCard("Chưa có kết quả chỉ số kinh tế Mỹ nào được agent tổng hợp gần đây.")) + `
      <article class="ncard">
        <div class="nc-in">
          <div class="nmeta"><span class="badge b-violet">Kênh truyền dẫn</span><span class="ntime">Mỹ → Việt Nam</span></div>
          <h3 class="ntitle" style="margin-bottom:6px">Số liệu việc làm Mỹ tác động tới VN-Index qua những khâu nào</h3>
          <div class="chain">
            ${[
              ["1", "Việc làm & lương Mỹ yếu đi", "Thị trường hạ kỳ vọng Fed tăng lãi suất"],
              ["2", "Lợi suất trái phiếu Kho bạc Mỹ giảm", "Đường cong lợi suất hạ thấp, tài sản USD bớt hấp dẫn"],
              ["3", "DXY suy yếu", "Áp lực lên tỷ giá USD/VND dịu bớt"],
              ["4", "Áp lực điều hành của NHNN giảm", "Giảm nhu cầu hút ròng để giữ tỷ giá, lãi suất liên ngân hàng hạ"],
              ["5", "Dòng tiền quay lại thị trường cổ phiếu", "Thanh khoản cải thiện, hệ số ADR mở rộng"],
              ["6", "Chiều ngược lại: cầu tiêu dùng Mỹ suy yếu", "Đơn hàng xuất khẩu chậm lại, triệt tiêu một phần tác động tích cực từ kênh tỷ giá"]
            ].map(([n, t, d]) => `
              <div class="chain-step">
                <span class="chain-n">${n}</span>
                <span class="chain-t"><b>${t}</b>${d}</span>
              </div>`).join("")}
          </div>
        </div>
      </article>`;

    /* 3. Tin kinh tế chứng khoán Việt Nam — category vn-macro */
    const vnNews = NEWS.filter(n => n.cls === "vn-macro");
    el("newsVN").innerHTML = vnNews.length ? vnNews.map(cardHtml).join("")
      : emptyCard("Chưa có tin chứng khoán Việt Nam nào được agent tổng hợp gần đây.");
  })();

  /* ============================================================
     13. HIỆU ỨNG: đếm số, hiện dần
     ============================================================ */
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function countUp(node, target, dec, suffix, prefix) {
    if (!node) return;
    if (target == null || Number.isNaN(+target)) { node.textContent = "—"; return; }
    if (reduced) { node.textContent = (prefix || "") + nf(target, dec) + (suffix || ""); return; }
    const dur = 1100, t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      node.textContent = (prefix || "") + nf(target * e, dec) + (suffix || "");
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  (function hero() {
    el("heroDate").textContent = dmyF(LAST.date);
    el("heroSess").textContent = sessionState().label;
    countUp(el("heroVal"), LAST.close, 2);
    el("heroVal").className = "big num " + cls(LAST.pct);
    el("heroChg").innerHTML = `<span class="${cls(LAST.pct)}">${sgn(LAST.chg)} (${sgn(LAST.pct)}%)</span> · GTGD ${nf(LAST.gtgd, 0)} tỷ`;
    const r = LAST.vn100.r[25];
    countUp(el("heroAD"), r, 1);
    el("heroAD").className = "big num " + (r == null ? "flat" : r > 120 ? "down" : r < 80 ? "up" : "flat");
    el("heroZone").innerHTML = r == null ? '<span class="flat">Chưa có dữ liệu tăng/giảm thật · VN100</span>'
      : r > 120 ? '<span class="down">Vùng quá mua (&gt;120) · VN100</span>'
      : r < 70 ? '<span class="up">Vùng quá bán sâu (&lt;70) · VN100</span>'
      : r < 80 ? '<span class="up">Vùng quá bán (&lt;80) · VN100</span>'
      : '<span class="flat">Vùng cân bằng (80–120) · VN100</span>';
    el("epNo").textContent = String(ROWS.length);
  })();

  (function reveal() {
    const panels = [...document.querySelectorAll(".panel, .notice, .ncard")];
    if (reduced || !("IntersectionObserver" in window)) return;
    panels.forEach(p => p.classList.add("reveal"));
    const io = new IntersectionObserver((es) => {
      es.forEach((e, i) => {
        if (!e.isIntersecting) return;
        const n = e.target;
        setTimeout(() => n.classList.add("on"), i * 70);
        io.unobserve(n);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    panels.forEach(p => io.observe(p));
  })();

  /* ============================================================
     14. KHỞI ĐỘNG + RESPONSIVE
     ============================================================ */
  function renderAll() {
    try { drawCurve(); } catch (e) { console.error("drawCurve", e); }
    try { drawSpread(); } catch (e) { console.error("drawSpread", e); }
    try { drawRatio(); } catch (e) { console.error("drawRatio", e); }
    try { drawWindows(); } catch (e) { console.error("drawWindows", e); }
    try { if (typeof drawMargin === "function") drawMargin(); } catch (e) { console.error("drawMargin", e); }
  }
  try { renderAll(); drawHist(); updateProj(); }
  catch (e) { console.error("init fail", e); }

  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderAll, 140); });
}
