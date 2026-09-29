/* ============================================================
   Dòng tiền ngành — engine kiểu DOM-manipulation, cùng phong cách với
   worldEngine.js/historyEngine.js (xem worldEngine.js để biết lý do giữ
   cách này thay vì React state thuần tuý cho các trang có nhiều SVG/canvas
   vẽ tay). Nhận `data` đã fetch từ public/data/sector-flows.json.
   ============================================================ */
import { attachStaleTag } from "../lib/freshness.js";

export function initSectorFlows(data) {
  const SECTOR_SHORT = {
    VNREAL: "BĐS", VNCONS: "Xây dựng", VNMAT: "Vật liệu", VNENE: "Năng lượng",
    VNFIN: "Tài chính", VNHEAL: "Y tế", VNIND: "Công nghiệp", VNIT: "CNTT",
    VNUTI: "Tiện ích", VNCOND: "Tiêu dùng",
  };

  const el = (id) => document.getElementById(id);
  const fmtPct = (v, d = 1) => (v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(d) + "%");
  const fmtBn = (v) => (v == null ? "—" : v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v).toString());

  let freq = "monthly";
  const tooltip = el("sfTooltip");

  function showTooltipNode(node, evt) {
    tooltip.innerHTML = "";
    tooltip.appendChild(node);
    tooltip.classList.add("show");
    moveTooltip(evt);
  }
  function moveTooltip(evt) {
    const pad = 14;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    const rect = tooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }
  function hideTooltip() { tooltip.classList.remove("show"); }

  // `|| []` phòng khi sector-flows.json cũ (trước khi thêm tần suất "daily")
  // chưa kịp có field này — tránh vỡ trang trong lúc chờ pipeline chạy lại.
  function rowsFor(f) { return data[f] || []; }
  function periodsFor(f) { return [...new Set(rowsFor(f).map((r) => r.period))].sort(); }
  function periodLabel(p, f) {
    if (f === "monthly") {
      const [y, m] = p.split("-");
      return "T" + parseInt(m, 10) + "/" + y.slice(2);
    }
    if (f === "daily") {
      const [, m, d] = p.split("-");
      return d + "/" + m;
    }
    return p.replace("-", " ");
  }
  function grouped(f) {
    const periods = periodsFor(f);
    const bySector = {};
    data.sectors.forEach((s) => (bySector[s.id] = {}));
    rowsFor(f).forEach((r) => { bySector[r.sector][r.period] = r; });
    return { periods, bySector };
  }

  /* ---------- màu: đọc token thật từ CSS để trộn gradient ---------- */
  const _probe = document.createElement("div");
  _probe.style.display = "none";
  document.body.appendChild(_probe);
  const _varCache = {};
  function resolveVar(token) {
    if (_varCache[token]) return _varCache[token];
    _probe.style.color = token;
    const cs = getComputedStyle(_probe).color;
    const m = cs.match(/[\d.]+/g).map(Number);
    _varCache[token] = m;
    return m;
  }
  function mixColor(varA, varB, t) {
    const a = resolveVar(varA), b = resolveVar(varB);
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }

  /* ============ Heatmap ============ */
  // Hàng = kỳ (mới nhất trên cùng), cột = ngành — xem CLAUDE.md: không đổi
  // thứ tự dữ liệu gốc (grouped/periodsFor vẫn sort tăng dần), chỉ đảo chiều
  // mảng hiển thị (`rows`) để tránh look-ahead/off-by-one khi tính maxAbs.
  function renderHeat() {
    const { periods, bySector } = grouped(freq);
    const windowN = freq === "monthly" ? 24 : periods.length;
    const shown = periods.slice(-windowN); // tăng dần (cũ → mới) — dùng để tính range/maxAbs
    const rows = [...shown].reverse(); // mới → cũ, thứ tự hiển thị theo hàng

    let maxAbs = 0.0001;
    data.sectors.forEach((s) => shown.forEach((p) => {
      const r = bySector[s.id][p];
      if (r && r.return_pct != null) maxAbs = Math.max(maxAbs, Math.abs(r.return_pct));
    }));

    const order = [...data.sectors].sort((a, b) => {
      const la = Object.values(bySector[a.id]).slice(-1)[0];
      const lb = Object.values(bySector[b.id]).slice(-1)[0];
      return (lb?.turnover_share_pct || 0) - (la?.turnover_share_pct || 0);
    });

    // dd/mm/yyyy từ field "date" (ngày cuối kỳ thật) đã có sẵn trong JSON —
    // rõ ràng hơn nhãn viết tắt "T8/26" dùng ở các biểu đồ khác của trang.
    function dateLabel(p) {
      for (const s of data.sectors) {
        const r = bySector[s.id][p];
        if (r && r.date) {
          const [y, m, d] = r.date.split("-");
          return `${d}/${m}/${y}`;
        }
      }
      return periodLabel(p, freq);
    }

    const table = el("sfHeatTable");
    table.innerHTML = "";
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    htr.appendChild(document.createElement("th"));
    order.forEach((s) => {
      const th = document.createElement("th");
      th.title = s.name + " (" + s.id + ")";
      th.textContent = SECTOR_SHORT[s.id] || s.id;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    rows.forEach((p) => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.textContent = dateLabel(p);
      tr.appendChild(th);

      order.forEach((s) => {
        const r = bySector[s.id][p];
        const td = document.createElement("td");
        td.className = "sf-cell";
        td.tabIndex = 0;
        if (r && r.return_pct != null) {
          const t = r.return_pct / maxAbs;
          td.style.background = t >= 0
            ? mixColor("var(--surface-2)", "var(--tang)", Math.min(Math.abs(t), 1))
            : mixColor("var(--surface-2)", "var(--giam)", Math.min(Math.abs(t), 1));
          const info = {
            name: s.name, code: s.id, period: dateLabel(p),
            ret: r.return_pct, turn: r.turnover_bn, share: r.turnover_share_pct,
          };
          td.addEventListener("pointerenter", (e) => showHeatTip(e, info));
          td.addEventListener("focus", (e) => showHeatTip(e, info));
          td.addEventListener("pointermove", moveTooltip);
          td.addEventListener("pointerleave", hideTooltip);
          td.addEventListener("blur", hideTooltip);
        } else {
          td.style.background = "var(--fill)";
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    el("sfHeatRange").textContent = dateLabel(shown[shown.length - 1]) + " → " + dateLabel(shown[0]);
    el("sfHeatMin").textContent = "−" + maxAbs.toFixed(1) + "%";
    el("sfHeatMax").textContent = "+" + maxAbs.toFixed(1) + "%";
  }

  function showHeatTip(evt, info) {
    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "sft-title";
    title.textContent = info.name + " · " + info.period;
    wrap.appendChild(title);
    [
      ["% thay đổi", fmtPct(info.ret)],
      ["GTGD ước tính", fmtBn(info.turn) + " tỷ"],
      ["Tỷ trọng", info.share != null ? info.share.toFixed(1) + "%" : "—"],
    ].forEach(([k, v]) => {
      const row = document.createElement("div");
      row.className = "sft-row";
      const kEl = document.createElement("span"); kEl.textContent = k;
      const vEl = document.createElement("span"); vEl.className = "sft-val"; vEl.textContent = v;
      row.appendChild(kEl); row.appendChild(vEl);
      wrap.appendChild(row);
    });
    showTooltipNode(wrap, evt);
  }

  /* ============ Small multiples ============ */
  function renderSmallMultiples() {
    const { periods, bySector } = grouped(freq);
    const windowN = freq === "monthly" ? 18 : periods.length;
    const shown = periods.slice(-windowN);

    const ranked = data.sectors.map((s) => {
      const series = shown.map((p) => bySector[s.id][p]?.turnover_share_pct ?? null);
      const last = series[series.length - 1];
      const prev = series[series.length - 2];
      return { s, series, last, prev };
    }).sort((a, b) => (b.last || 0) - (a.last || 0));

    const grid = el("sfGrid");
    grid.innerHTML = "";
    ranked.forEach(({ s, series, last, prev }) => {
      const tile = document.createElement("div");
      tile.className = "sf-tile";

      const top = document.createElement("div");
      top.className = "sf-top";
      const left = document.createElement("div");
      const nm = document.createElement("span"); nm.className = "sf-name"; nm.textContent = s.name;
      const cd = document.createElement("span"); cd.className = "sf-code"; cd.textContent = s.id;
      left.appendChild(nm); left.appendChild(cd);
      const val = document.createElement("div");
      val.className = "sf-val num";
      val.textContent = last != null ? last.toFixed(1) + "%" : "—";
      top.appendChild(left); top.appendChild(val);
      tile.appendChild(top);

      const d = last != null && prev != null ? last - prev : null;
      const delta = document.createElement("div");
      delta.className = "sf-delta num " + (d == null ? "flat" : d > 0 ? "up" : d < 0 ? "down" : "flat");
      delta.textContent = d == null ? "—" : (d > 0 ? "▲ " : d < 0 ? "▼ " : "· ") + Math.abs(d).toFixed(1) + "đ so kỳ trước";
      tile.appendChild(delta);

      const atr = document.createElement("div");
      atr.className = "sf-atr num";
      atr.textContent = "ATR(14): " + (s.atr14Pct != null ? s.atr14Pct.toFixed(2) + "%/phiên" : "—");
      tile.appendChild(atr);

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 200 40");
      svg.setAttribute("preserveAspectRatio", "none");
      const vals = series.map((v) => (v == null ? 0 : v));
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const rg = (hi - lo) || 1;
      const n = vals.length;
      const X = (i) => (n <= 1 ? 0 : (i / (n - 1)) * 200);
      const Y = (v) => 38 - ((v - lo) / rg) * 34;
      const line = vals.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
      const area = line + " L 200 40 L 0 40 Z";
      const strokeVar = (d == null ? true : d >= 0) ? "var(--tang)" : "var(--giam)";
      const p1 = document.createElementNS(svg.namespaceURI, "path");
      p1.setAttribute("d", area); p1.setAttribute("fill", strokeVar); p1.setAttribute("opacity", "0.12");
      const p2 = document.createElementNS(svg.namespaceURI, "path");
      p2.setAttribute("d", line); p2.setAttribute("fill", "none");
      p2.setAttribute("stroke", strokeVar); p2.setAttribute("stroke-width", "2");
      p2.setAttribute("stroke-linejoin", "round"); p2.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(p1); svg.appendChild(p2);
      tile.appendChild(svg);

      grid.appendChild(tile);
    });

    el("sfSmRange").textContent = periodLabel(shown[0], freq) + " → " + periodLabel(shown[shown.length - 1], freq);
  }

  /* ============ RRG ============ */
  let selectedSector = null;
  function quadrantOf(x, y) {
    if (x >= 100 && y >= 100) return "lead";
    if (x >= 100 && y < 100) return "weak";
    if (x < 100 && y < 100) return "lag";
    return "imp";
  }
  const QUAD_NAME = { lead: "Dẫn dắt", weak: "Suy yếu", lag: "Trễ nhịp", imp: "Cải thiện" };
  const QUAD_CLASS = { lead: "sf-quad-lead", weak: "sf-quad-weak", lag: "sf-quad-lag", imp: "sf-quad-imp" };

  function renderRRG() {
    const { periods, bySector } = grouped(freq);
    const trailN = 6;
    const shown = periods.slice(-trailN);

    const svg = el("sfRrgSvg");
    svg.innerHTML = "";
    const NS = svg.namespaceURI;
    const W = 640, H = 440, PAD = 44;

    let vals = [];
    data.sectors.forEach((s) => shown.forEach((p) => {
      const r = bySector[s.id][p];
      if (r && r.rs_ratio != null) vals.push(r.rs_ratio);
      if (r && r.rs_momentum != null) vals.push(r.rs_momentum);
    }));
    const span = Math.max(6, ...vals.map((v) => Math.abs(v - 100))) * 1.15;
    const lo = 100 - span, hi = 100 + span;
    const sx = (v) => PAD + ((v - lo) / (hi - lo)) * (W - 2 * PAD);
    const sy = (v) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);

    function make(tag, attrs) {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }

    const midX = sx(100), midY = sy(100);
    const bg = [
      [PAD, PAD, midX - PAD, midY - PAD, "rgba(10,147,200,.08)"],       // top-left = cải thiện (san)
      [midX, PAD, W - PAD - midX, midY - PAD, "var(--up-soft)"],        // top-right = dẫn dắt (tang)
      [PAD, midY, midX - PAD, H - PAD - midY, "rgba(142,142,147,.06)"], // bottom-left = trễ nhịp (neutral/dim)
      [midX, midY, W - PAD - midX, H - PAD - midY, "rgba(224,138,0,.10)"], // bottom-right = suy yếu (tc)
    ];
    bg.forEach(([x, y, w, h, fill]) => svg.appendChild(make("rect", { x, y, width: Math.max(w, 0), height: Math.max(h, 0), fill })));

    svg.appendChild(make("line", { x1: PAD, y1: midY, x2: W - PAD, y2: midY, stroke: "var(--line)", "stroke-width": 1 }));
    svg.appendChild(make("line", { x1: midX, y1: PAD, x2: midX, y2: H - PAD, stroke: "var(--line)", "stroke-width": 1 }));
    svg.appendChild(make("rect", { x: PAD, y: PAD, width: W - 2 * PAD, height: H - 2 * PAD, fill: "none", stroke: "var(--line)", "stroke-width": 1 }));

    [
      ["Cải thiện", PAD + 8, PAD + 16, "start"],
      ["Dẫn dắt", W - PAD - 8, PAD + 16, "end"],
      ["Trễ nhịp", PAD + 8, H - PAD - 10, "start"],
      ["Suy yếu", W - PAD - 8, H - PAD - 10, "end"],
    ].forEach(([t, x, y, anchor]) => {
      const txt = make("text", { x, y, class: "sf-quad-label", "text-anchor": anchor });
      txt.textContent = t;
      svg.appendChild(txt);
    });
    const ax1 = make("text", { x: W - PAD, y: midY - 6, class: "sf-axis-label", "text-anchor": "end" });
    ax1.textContent = "RS-Ratio →";
    svg.appendChild(ax1);
    const ax2 = make("text", { x: midX + 6, y: PAD + 2, class: "sf-axis-label" });
    ax2.textContent = "RS-Momentum ↑";
    svg.appendChild(ax2);

    data.sectors.forEach((s) => {
      const series = shown.map((p) => bySector[s.id][p]).filter((r) => r && r.rs_ratio != null && r.rs_momentum != null);
      if (!series.length) return;
      const isSel = selectedSector === s.id;
      const dim = selectedSector && !isSel;

      if (series.length > 1) {
        const d = series.map((r, i) => (i ? "L" : "M") + sx(r.rs_ratio).toFixed(1) + " " + sy(r.rs_momentum).toFixed(1)).join(" ");
        svg.appendChild(make("path", {
          d, fill: "none",
          stroke: isSel ? "var(--blue)" : "var(--dim)",
          "stroke-width": isSel ? 2 : 1.4,
          opacity: dim ? 0.15 : isSel ? 0.9 : 0.35,
        }));
      }
      const last = series[series.length - 1];
      const cx = sx(last.rs_ratio), cy = sy(last.rs_momentum);
      const r = isSel ? 7 : 5.5;
      svg.appendChild(make("circle", { cx, cy, r: r + 2, fill: "var(--surface)", opacity: dim ? 0.3 : 1 }));
      svg.appendChild(make("circle", { cx, cy, r, fill: isSel ? "var(--blue)" : "var(--dim)", opacity: dim ? 0.35 : 1 }));

      if (isSel) {
        const lbl = make("text", {
          x: cx + 10, y: cy + 4,
          style: "font-family: var(--mono); font-size:12px; font-weight:700; fill:var(--text)",
        });
        lbl.textContent = SECTOR_SHORT[s.id] || s.id;
        svg.appendChild(lbl);
      }

      const hit = make("circle", { cx, cy, r: 14, fill: "transparent", style: "cursor:pointer" });
      hit.addEventListener("pointerenter", (e) => showRRGTip(e, s, last));
      hit.addEventListener("pointermove", moveTooltip);
      hit.addEventListener("pointerleave", hideTooltip);
      hit.addEventListener("click", () => selectSector(s.id));
      svg.appendChild(hit);
    });

    el("sfRrgRange").textContent = "Vệt " + shown.length + " kỳ gần nhất · " + periodLabel(shown[shown.length - 1], freq);
    renderRRGList(bySector, periods[periods.length - 1]);
  }

  function showRRGTip(evt, s, last) {
    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "sft-title";
    title.textContent = s.name + " · " + s.id;
    wrap.appendChild(title);
    [
      ["RS-Ratio", last.rs_ratio.toFixed(1)],
      ["RS-Momentum", last.rs_momentum.toFixed(1)],
      ["Góc phần tư", QUAD_NAME[quadrantOf(last.rs_ratio, last.rs_momentum)]],
    ].forEach(([k, v]) => {
      const row = document.createElement("div");
      row.className = "sft-row";
      const kEl = document.createElement("span"); kEl.textContent = k;
      const vEl = document.createElement("span"); vEl.className = "sft-val"; vEl.textContent = v;
      row.appendChild(kEl); row.appendChild(vEl);
      wrap.appendChild(row);
    });
    showTooltipNode(wrap, evt);
  }

  function renderRRGList(bySector, lastPeriod) {
    const list = el("sfRrgList");
    list.innerHTML = "";
    const rows = data.sectors
      .map((s) => ({ s, r: bySector[s.id][lastPeriod] }))
      .sort((a, b) => (b.r?.rs_ratio || 0) - (a.r?.rs_ratio || 0));

    rows.forEach(({ s, r }) => {
      const btn = document.createElement("button");
      btn.className = "sf-rrg-row";
      btn.setAttribute("aria-pressed", String(selectedSector === s.id));
      btn.addEventListener("click", () => selectSector(s.id));

      const dot = document.createElement("span"); dot.className = "sf-dot";
      const nameWrap = document.createElement("span");
      const nm = document.createElement("span"); nm.className = "sf-name"; nm.textContent = s.name;
      const cd = document.createElement("span"); cd.className = "sf-code"; cd.textContent = s.id;
      nameWrap.appendChild(nm); nameWrap.appendChild(cd);

      const quad = document.createElement("span");
      if (r && r.rs_ratio != null && r.rs_momentum != null) {
        const q = quadrantOf(r.rs_ratio, r.rs_momentum);
        quad.className = "sf-quad " + QUAD_CLASS[q];
        quad.textContent = QUAD_NAME[q];
      } else {
        quad.className = "sf-quad";
        quad.textContent = "—";
      }

      btn.appendChild(dot); btn.appendChild(nameWrap); btn.appendChild(quad);
      list.appendChild(btn);
    });
  }

  function selectSector(id) {
    selectedSector = selectedSector === id ? null : id;
    renderRRG();
  }

  /* ============ Data table ============ */
  function renderTable() {
    const rows = rowsFor(freq);
    const nameOf = (id) => data.sectors.find((s) => s.id === id)?.name || id;
    const sorted = [...rows].sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : a.sector.localeCompare(b.sector)));
    const table = el("sfDataTable");
    table.innerHTML = "";
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    ["Kỳ", "Ngành", "% thay đổi", "GTGD (tỷ)", "Tỷ trọng %", "RS-Ratio", "RS-Mom."].forEach((h) => {
      const th = document.createElement("th"); th.textContent = h; htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    sorted.forEach((r) => {
      const tr = document.createElement("tr");
      [
        periodLabel(r.period, freq),
        nameOf(r.sector) + " (" + r.sector + ")",
        fmtPct(r.return_pct),
        r.turnover_bn != null ? r.turnover_bn.toLocaleString("vi-VN") : "—",
        r.turnover_share_pct != null ? r.turnover_share_pct.toFixed(2) : "—",
        r.rs_ratio != null ? r.rs_ratio.toFixed(2) : "—",
        r.rs_momentum != null ? r.rs_momentum.toFixed(2) : "—",
      ].forEach((c) => { const td = document.createElement("td"); td.textContent = c; tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  /* ============ Header meta ============ */
  function renderMeta() {
    el("sfGenAt").textContent = data.generatedAtIct;
    // sector-flows.json không có `asof` cấp 1; ngày phiên thật là dòng daily
    // cuối cùng. Dùng generatedAtIct sẽ nói dối khi script chạy lại mà không
    // lấy được phiên mới.
    const sfDaily = Array.isArray(data.daily) && data.daily.length
      ? data.daily[data.daily.length - 1].date : null;
    attachStaleTag(el("sfGenAt").parentElement, sfDaily);
    el("sfSource").textContent = data.source;
    el("sfMethodTurnover").textContent = data.method.turnover_bn;
    el("sfMethodReturn").textContent = data.method.return_pct;
    el("sfMethodRrg").textContent = data.method.rrg;

    const monthlyPeriods = periodsFor("monthly");
    const quarterlyPeriods = periodsFor("quarterly");
    const dailyPeriods = periodsFor("daily");
    const meta = el("sfMetaRow");
    meta.innerHTML = "";
    [
      "10 ngành ICB · benchmark " + data.benchmark.name,
      monthlyPeriods.length + " tháng dữ liệu (" + periodLabel(monthlyPeriods[0], "monthly") + " → " + periodLabel(monthlyPeriods[monthlyPeriods.length - 1], "monthly") + ")",
      quarterlyPeriods.length + " quý (" + periodLabel(quarterlyPeriods[0], "quarterly") + " → " + periodLabel(quarterlyPeriods[quarterlyPeriods.length - 1], "quarterly") + ")",
      ...(dailyPeriods.length
        ? [dailyPeriods.length + " phiên gần nhất (" + periodLabel(dailyPeriods[0], "daily") + " → " + periodLabel(dailyPeriods[dailyPeriods.length - 1], "daily") + ")"]
        : []),
    ].forEach((t) => {
      const span = document.createElement("span");
      span.textContent = t;
      meta.appendChild(span);
    });
  }

  function renderAll() {
    renderHeat();
    renderSmallMultiples();
    renderRRG();
    renderTable();
  }

  el("sfFreqSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    freq = b.dataset.f;
    [...e.currentTarget.children].forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    selectedSector = null;
    renderAll();
  });

  const tableSection = el("sfTableSection");
  el("sfTableToggle").addEventListener("click", (e) => {
    const show = !tableSection.classList.contains("show");
    tableSection.classList.toggle("show", show);
    e.currentTarget.setAttribute("aria-pressed", String(show));
    e.currentTarget.textContent = show ? "Ẩn bảng" : "Xem dạng bảng";
  });

  document.addEventListener("pointermove", (e) => {
    if (tooltip.classList.contains("show")) moveTooltip(e);
  });

  renderMeta();
  renderAll();
}
