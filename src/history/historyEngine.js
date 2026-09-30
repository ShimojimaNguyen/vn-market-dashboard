/* ============================================================
   History & Correlation engine — same hand-rolled SVG charting
   style as dashboard/dashboardEngine.js (axis gridlines, crosshair
   tooltip, .lg[aria-pressed] legend toggles) for visual/interaction
   consistency with the rest of the site. No charting library.

   initHistory(rows, events) is called once after both have been
   fetched (see hooks/useHistory.js) and the page shell has mounted.
   ============================================================ */

const RANGE_DAYS = { "3T": 90, "6T": 180, "1N": 365, all: Infinity };

const CATEGORY_LABEL = {
  fed: "Fed", "us-macro": "Vĩ mô Mỹ", "vn-macro": "Vĩ mô VN",
  geopolitical: "Địa chính trị", other: "Khác",
};
const CATEGORY_COLOR = {
  fed: "var(--blue)", "us-macro": "var(--tran)", "vn-macro": "var(--vn-macro)",
  geopolitical: "var(--giam)", other: "var(--dim)",
};

/* Mỗi chuỗi: get() đọc giá trị từ 1 row lịch sử; kind quyết định cách tính
   % thay đổi ngày-qua-ngày cho bảng tương quan ("pct" = %, "abs" = số tuyệt đối/bps). */
const SERIES = [
  { key: "vnIndex", label: "VN-Index", color: "var(--tang)", kind: "pct", get: (r) => r.vnIndex, fmt: (v) => v.toLocaleString("vi-VN", { maximumFractionDigits: 2 }) },
  { key: "us10y", label: "US 10Y", color: "var(--us)", kind: "abs", get: (r) => r.usYields && r.usYields["10"], fmt: (v) => v.toFixed(2) + "%" },
  { key: "vn10y", label: "VN 10Y", color: "var(--vn)", kind: "abs", get: (r) => r.vnYields && r.vnYields["10"], fmt: (v) => v.toFixed(2) + "%" },
  { key: "dxy", label: "DXY", color: "var(--tran)", kind: "pct", get: (r) => r.dxy, fmt: (v) => v.toFixed(2) },
  { key: "margin", label: "Margin", color: "var(--tc)", kind: "pct", get: (r) => r.margin, fmt: (v) => v.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) },
  /* Hai chuỗi USD/VND RIÊNG BIỆT, không gộp: tỷ giá trung tâm do NHNN công bố
     và tỷ giá ngân hàng thương mại của Vietcombank là hai đại lượng khác nhau,
     lệch nhau 1–2,5%. Vẽ chung một đường sẽ tạo một bậc nhảy vô hình đúng chỗ
     đổi nguồn. Chuỗi NHNN chỉ có ~10 điểm cũ và không còn được ghi thêm. */
  { key: "usdVndCb", label: "USD/VND (NHNN trung tâm)", color: "var(--san)", kind: "pct", get: (r) => r.usdVndCentral, fmt: (v) => v.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) },
  { key: "usdVndVcb", label: "USD/VND (VCB mua CK)", color: "var(--tran)", kind: "pct", get: (r) => r.usdVndVcbTransfer, fmt: (v) => v.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) },
];
const DEFAULT_ON = new Set(["vnIndex", "us10y", "dxy"]);

export function initHistory(rows, events) {
  const el = (id) => document.getElementById(id);
  const nf = (v, d = 2) => (v == null || Number.isNaN(+v) ? "—" : (+v).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sgn = (v, d = 2) => (v == null || Number.isNaN(+v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf(Math.abs(v), d));
  const dmyF = (iso) => (!iso ? "—" : String(iso).replace(/-/g, "/"));

  const on = new Set(DEFAULT_ON);
  let rangeKey = "1N";

  el("histRangeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    rangeKey = b.dataset.r;
    [...e.currentTarget.children].forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderAll();
  });

  el("seriesLegend").innerHTML = SERIES.map(
    (s) => `<button class="lg" data-k="${s.key}" aria-pressed="${on.has(s.key)}"><i class="sw" style="background:${s.color}"></i>${s.label}</button>`
  ).join("");
  el("seriesLegend").addEventListener("click", (e) => {
    const b = e.target.closest(".lg");
    if (!b) return;
    const k = b.dataset.k;
    if (on.has(k)) on.delete(k);
    else on.add(k);
    b.setAttribute("aria-pressed", String(on.has(k)));
    renderAll();
  });

  function windowedRows() {
    const days = RANGE_DAYS[rangeKey];
    if (!Number.isFinite(days) || !rows.length) return rows;
    const last = new Date(rows[rows.length - 1].date + "T00:00:00Z").getTime();
    const cutoff = last - days * 86400000;
    return rows.filter((r) => new Date(r.date + "T00:00:00Z").getTime() >= cutoff);
  }
  function windowedEvents(data) {
    if (!data.length) return events;
    const lo = data[0].date, hi = data[data.length - 1].date;
    return events.filter((e) => e.date >= lo && e.date <= hi);
  }

  /* ============================================================
     BIỂU ĐỒ CHỒNG LỚP — chỉ số hoá base=100 tại điểm đầu cửa sổ
     ============================================================ */
  let chartGeom = null;
  function drawChart() {
    const host = el("historyChart");
    if (!host) return;
    const data = windowedRows();
    const evs = windowedEvents(data);
    const active = SERIES.filter((s) => on.has(s.key));

    if (!data.length || !active.length) {
      host.innerHTML = `<p class="note" style="padding:16px">Chưa có đủ dữ liệu lịch sử cho lựa chọn hiện tại.</p>`;
      chartGeom = null;
      return;
    }

    const W = Math.max(480, host.clientWidth), H = 420;
    const m = { t: 18, r: 20, b: 40, l: 46 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = data.length;
    const X = (i) => m.l + (n < 2 ? iw / 2 : (i / (n - 1)) * iw);

    // rebase mỗi chuỗi về 100 tại điểm dữ liệu đầu tiên có trong cửa sổ
    const series = active.map((s) => {
      const raw = data.map((r) => s.get(r));
      const baseIdx = raw.findIndex((v) => v != null);
      const base = baseIdx >= 0 ? raw[baseIdx] : null;
      const idxed = raw.map((v) => (v == null || !base ? null : (v / base) * 100));
      return { ...s, raw, idxed };
    });

    const allVals = series.flatMap((s) => s.idxed).filter((v) => v != null);
    if (!allVals.length) {
      host.innerHTML = `<p class="note" style="padding:16px">Chưa có đủ dữ liệu lịch sử cho lựa chọn hiện tại.</p>`;
      chartGeom = null;
      return;
    }
    const lo = Math.min(100, ...allVals) * 0.98, hi = Math.max(100, ...allVals) * 1.02;
    const Y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

    let g = "";
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      g += `<line x1="${m.l}" y1="${Y(v).toFixed(1)}" x2="${W - m.r}" y2="${Y(v).toFixed(1)}" stroke="var(--line-soft)"/>
          <text x="${m.l - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" fill="var(--dim)" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${nf(v, 0)}</text>`;
    }
    g += `<line x1="${m.l}" y1="${Y(100).toFixed(1)}" x2="${W - m.r}" y2="${Y(100).toFixed(1)}" stroke="var(--dim)" stroke-dasharray="3 3" opacity=".6"/>`;

    const step = Math.max(1, Math.round(n / 8));
    for (let i = 0; i < n; i += step) {
      g += `<text x="${X(i).toFixed(1)}" y="${H - 22}" text-anchor="middle" fill="var(--dim)" font-size="10" font-family="IBM Plex Mono, ui-monospace, monospace">${dmyF(data[i].date).slice(0, 7)}</text>`;
    }

    // vạch đánh dấu sự kiện
    let evMarkers = "";
    evs.forEach((ev) => {
      let i = data.findIndex((r) => r.date >= ev.date);
      if (i < 0) i = n - 1;
      const x = X(i);
      const c = CATEGORY_COLOR[ev.category] || "var(--dim)";
      evMarkers += `<g class="ev-marker" data-i="${i}">
        <line x1="${x.toFixed(1)}" y1="${m.t}" x2="${x.toFixed(1)}" y2="${m.t + ih}" stroke="${c}" stroke-width="1.2" stroke-dasharray="3 3" opacity=".55"/>
        <circle cx="${x.toFixed(1)}" cy="${m.t}" r="3.5" fill="${c}"/>
      </g>`;
    });

    const path = (vals) =>
      vals
        .map((v, i) => (v == null ? null : (i === 0 || vals[i - 1] == null ? "M" : "L") + X(i).toFixed(1) + " " + Y(v).toFixed(1)))
        .filter(Boolean)
        .join(" ");

    let lines = "";
    series.forEach((s) => {
      lines += `<path class="draw" pathLength="1" d="${path(s.idxed)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    });

    let cross = `<g id="hcross" style="opacity:0">
        <line y1="${m.t}" y2="${m.t + ih}" stroke="var(--text)" stroke-width="1" stroke-dasharray="3 3" opacity=".35"/>
      </g>`;

    host.innerHTML = `<div class="tip" id="historyTip"></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ chỉ số hoá các chuỗi dữ liệu lịch sử">
        <text x="${m.l - 8}" y="${m.t - 4}" text-anchor="end" fill="var(--dim)" font-size="9.5" font-family="IBM Plex Mono, ui-monospace, monospace">idx=100</text>
        ${g}${lines}${evMarkers}${cross}
      </svg>`;

    chartGeom = { W, H, m, iw, X, n, data, series, evs, Y };
    wireChartHover();
  }

  function wireChartHover() {
    const host = el("historyChart"), tip = el("historyTip");
    if (!host || !chartGeom) return;
    const svg = host.querySelector("svg");
    const cross = host.querySelector("#hcross line");
    if (!svg) return;

    function move(ev) {
      if (!chartGeom) return;
      const b = svg.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - b.left;
      const sx = (px / b.width) * chartGeom.W;
      const { m, n, data, X, series } = chartGeom;
      let i = Math.round(((sx - m.l) / (chartGeom.W - m.r - m.l || 1)) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      const cx = X(i);
      cross.setAttribute("x1", cx);
      cross.setAttribute("x2", cx);
      cross.parentElement.style.opacity = "1";
      const row = data[i];

      const dayEvents = chartGeom.evs.filter((e) => e.date === row.date);
      const rowsHtml = series
        .map((s) => {
          const v = s.raw[i];
          return `<div class="r"><span>${s.label}</span><span style="color:${s.color}">${v == null ? "—" : s.fmt(v)}</span></div>`;
        })
        .join("");
      const evHtml = dayEvents.length
        ? `<div class="tip-ev">${dayEvents.map((e) => `<div><b style="color:${CATEGORY_COLOR[e.category]}">${CATEGORY_LABEL[e.category] || e.category}</b> · ${e.title}</div>`).join("")}</div>`
        : "";

      tip.innerHTML = `<div class="d">${dmyF(row.date)}</div>${rowsHtml}${evHtml}`;
      tip.style.opacity = "1";
      const left = (cx / chartGeom.W) * b.width;
      tip.style.left = Math.min(b.width - 220, Math.max(0, left + 14)) + "px";
      tip.style.top = "10px";
    }
    svg.addEventListener("mousemove", move);
    svg.addEventListener("touchmove", (e) => move(e), { passive: true });
    svg.addEventListener("mouseleave", () => {
      tip.style.opacity = "0";
      cross.parentElement.style.opacity = "0";
    });
  }

  /* ============================================================
     BẢNG TƯƠNG QUAN — Pearson trên thay đổi ngày-qua-ngày
     ============================================================ */
  function dailyDeltas(data, s) {
    const out = [];
    let prev = null;
    data.forEach((r) => {
      const v = s.get(r);
      if (v != null && prev != null) {
        out.push({ date: r.date, delta: s.kind === "pct" ? ((v - prev) / prev) * 100 : v - prev });
      }
      if (v != null) prev = v;
    });
    return out;
  }
  function pearson(a, b) {
    const byDate = new Map(b.map((x) => [x.date, x.delta]));
    const xs = [], ys = [];
    a.forEach((x) => {
      if (byDate.has(x.date)) {
        xs.push(x.delta);
        ys.push(byDate.get(x.date));
      }
    });
    const n = xs.length;
    if (n < 8) return { r: null, n };
    const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return { r: null, n };
    return { r: sxy / Math.sqrt(sxx * syy), n };
  }
  function corrColor(r) {
    if (r == null) return "var(--fill)";
    const a = Math.min(1, Math.abs(r));
    return r > 0 ? `rgba(29,169,91,${(a * 0.85).toFixed(2)})` : `rgba(224,52,43,${(a * 0.85).toFixed(2)})`;
  }

  function drawCorrelation() {
    const host = el("corrTable");
    if (!host) return;
    const data = windowedRows();
    const active = SERIES.filter((s) => on.has(s.key));
    if (active.length < 2) {
      host.innerHTML = `<p class="note" style="padding:12px 0">Chọn ít nhất 2 chuỗi ở phần chú giải phía trên để xem tương quan.</p>`;
      return;
    }
    const deltas = active.map((s) => dailyDeltas(data, s));
    const matrix = active.map((_, i) => active.map((_, j) => (i === j ? { r: 1, n: deltas[i].length } : pearson(deltas[i], deltas[j]))));

    const head = `<tr><th></th>${active.map((s) => `<th>${s.label}</th>`).join("")}</tr>`;
    const body = active
      .map(
        (s, i) => `<tr><td style="text-align:left;font-weight:600">${s.label}</td>${matrix[i]
          .map((c) => `<td class="num" style="background:${corrColor(c.r)}" title="${c.n} phiên">${c.r == null ? "—" : c.r.toFixed(2)}</td>`)
          .join("")}</tr>`
      )
      .join("");
    host.innerHTML = `<table class="corr"><thead>${head}</thead><tbody>${body}</tbody></table>
      <p class="note" style="margin-top:10px">Hệ số tương quan Pearson trên % thay đổi ngày-qua-ngày (điểm cơ bản với lợi suất). +1 = cùng chiều hoàn toàn, −1 = ngược chiều hoàn toàn, gần 0 = không rõ tương quan. Ô "—" nghĩa là chưa đủ &lt;8 phiên trùng ngày có cả hai chuỗi.</p>`;
  }

  /* ============================================================
     DANH SÁCH SỰ KIỆN
     ============================================================ */
  let catFilter = "all";
  el("eventCatSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    catFilter = b.dataset.c;
    [...e.currentTarget.children].forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    drawEvents();
  });
  function drawEvents() {
    const host = el("eventsList");
    if (!host) return;
    const list = [...events]
      .filter((e) => catFilter === "all" || e.category === catFilter)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!list.length) {
      host.innerHTML = `<p class="note" style="padding:12px 0">Không có sự kiện nào khớp bộ lọc.</p>`;
      return;
    }
    host.innerHTML = list
      .map(
        (e) => `<div class="ev-row">
          <div class="ev-date">${dmyF(e.date)}</div>
          <div class="ev-body">
            <span class="badge" style="background:${CATEGORY_COLOR[e.category]}22;color:${CATEGORY_COLOR[e.category]}">${CATEGORY_LABEL[e.category] || e.category}</span>
            <b>${e.title}</b>
            ${e.summary ? `<p>${e.summary}</p>` : `<p class="note">Đã lên lịch — chưa có kết quả.</p>`}
            ${e.source ? `<div class="nsrc">Nguồn: ${e.source}</div>` : ""}
          </div>
        </div>`
      )
      .join("");
  }

  function renderAll() {
    try { drawChart(); } catch (e) { console.error("drawChart", e); }
    try { drawCorrelation(); } catch (e) { console.error("drawCorrelation", e); }
  }
  renderAll();
  drawEvents();

  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(renderAll, 140);
  });
}
