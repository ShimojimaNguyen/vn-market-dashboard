/* ============================================================
   Dòng tiền & Cashout — engine kiểu DOM-manipulation, cùng phong cách với
   worldEngine.js/sectorFlowsEngine.js. Nhận `data` đã fetch từ
   public/data/cashout-vn.json (null nếu fetch lỗi/chưa có file — khi đó
   dùng nguyên dữ liệu mẫu bên dưới, không tự bịa số).
   ============================================================ */

import { attachStaleTag } from "../lib/freshness.js";

// Dữ liệu mẫu (preset/simulated) — fallback khi chưa fetch được cashout-vn.json.
const PRESET_SECTORS = [
  { en: "Securities", vi: "Chứng khoán", chg: 3.1, value: 1420, volRatio: 1.67 },
  { en: "Steel & Materials", vi: "Thép", chg: 2.4, value: 1650, volRatio: 1.58 },
  { en: "Technology", vi: "Công nghệ", chg: 1.5, value: 290, volRatio: 1.31 },
  { en: "Banking", vi: "Ngân hàng", chg: 1.8, value: 4200, volRatio: 1.35 },
  { en: "Logistics", vi: "Vận tải", chg: 0.9, value: 380, volRatio: 0.88 },
  { en: "Utilities", vi: "Điện/Tiện ích", chg: 0.4, value: 520, volRatio: 1.05 },
  { en: "Construction", vi: "Xây dựng", chg: -0.8, value: 310, volRatio: 1.05 },
  { en: "F&B / Retail", vi: "Bán lẻ/Thực phẩm", chg: -0.6, value: 780, volRatio: 0.95 },
  { en: "Oil & Gas", vi: "Dầu khí", chg: -1.3, value: 640, volRatio: 1.25 },
  { en: "Real Estate", vi: "Bất động sản", chg: -2.1, value: 2800, volRatio: 1.42 },
];
const PRESET_STOCKS = [
  { code: "HPG", sector: "Thép / Steel", buy: 452, sell: 381 },
  { code: "TCB", sector: "Ngân hàng / Banking", buy: 318, sell: 296 },
  { code: "VHM", sector: "Bất động sản / Real Estate", buy: 274, sell: 312 },
  { code: "SSI", sector: "Chứng khoán / Securities", buy: 214, sell: 176 },
];
const PRESET_TURNOVER = 18500;
const PRESET_FOREIGN = -320;
// Không có PRESET_PROP: Proprietary Flow (tự doanh) không có nguồn dữ liệu
// miễn phí và hầu như không có nguồn công khai nào để bịa mẫu hợp lý — luôn
// "—" trừ khi agent thực sự tìm được số hôm nay (xem quality.proprietaryNetBn).

export function initCashout(data, insight) {
  const el = (id) => document.getElementById(id);

  let SECTOR_DATA = PRESET_SECTORS;
  let LEADING_STOCKS = PRESET_STOCKS;

  const isReal = !!data;
  if (isReal && Array.isArray(data.sectors) && data.sectors.length) {
    SECTOR_DATA = data.sectors
      .filter((s) => s.vol_ratio != null)
      .map((s) => ({ en: s.en, vi: s.vi, chg: s.chg, value: s.value_bn, volRatio: s.vol_ratio,
                     repN: s.vol_ratio_rep_n, repSyms: s.vol_ratio_proxy_symbols,
                     coverage: s.vol_ratio_coverage_pct,
                     hotThreshold: s.vol_ratio_hot_threshold }));
  }
  if (isReal && Array.isArray(data.tickers) && data.tickers.length) {
    LEADING_STOCKS = data.tickers.map((t) => ({
      code: t.code, sector: t.sector, buy: t.foreign_buy_bn, sell: t.foreign_sell_bn,
      roomPct: t.foreign_room_pct, spreadPct: t.spread_pct,
      pe: t.pe, pb: t.pb, roe: t.roe,
      foreignerPct: t.foreigner_pct, statePct: t.state_pct, freeFloatPct: t.free_float_pct,
      capacityDays500bn: t.capacity_days_500bn,
    }));
  }
  const FOREIGN_ROOM_WATCH = isReal && Array.isArray(data.foreignRoomWatch) ? data.foreignRoomWatch : [];
  // capacity (cấp thị trường) + leadersRollup — không có preset/mẫu, chỉ hiện
  // khi có dữ liệu thật (isReal); panel tương ứng tự ẩn nếu null (xem renderCapacity/renderLeadersRollup).
  const CAPACITY = isReal ? data.capacity : null;
  const LEADERS_ROLLUP = isReal ? data.leadersRollup : null;

  /* ============ Đồng hồ ============ */
  function tick() {
    // Nhãn cạnh đồng hồ ghi "ICT", nên phải ra giờ ICT chứ không phải giờ máy
    // người xem: getHours() trên máy ở UTC+9 hiện lệch đúng 2 tiếng và vẫn
    // mang chữ ICT. Cùng khuôn với worldEngine.js: cộng offset rồi đọc UTC.
    const d = new Date(Date.now() + 7 * 3600000);
    el("clock").textContent = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
      .map((x) => String(x).padStart(2, "0")).join(":");
  }
  tick();
  setInterval(tick, 1000);

  /* ============ Cashout Alert ============ */
  const numInput = el("turnoverInput");
  const rangeInput = el("turnoverSlider");
  const banner = el("cashoutBanner");
  const cbIcon = el("cbIcon");
  const cbTitle = el("cbTitle");
  const cbDesc = el("cbDesc");
  const cbVal = el("cbVal");
  const scaleMarker = el("scaleMarker");

  function evalCashout(v) {
    if (v >= 20000) {
      return {
        cls: "ok", icon: "mascots/confident-glow.png",
        title: "Healthy Rotation / Strong Market Liquidity",
        desc: "Dòng tiền vẫn ở lại thị trường. Sự luân chuyển giữa các nhóm ngành (sector rotation) là động lực chính của phiên.",
      };
    }
    if (v >= 12000) {
      return {
        cls: "warn", icon: "mascots/sunburst-glow.png",
        title: "Caution: Liquidity Consolidating",
        desc: "Thanh khoản đang co lại. Dòng tiền có xu hướng thu hẹp về một số nhóm ngành/mã trụ thay vì lan toả toàn thị trường.",
      };
    }
    return {
      cls: "danger", icon: "mascots/worried-handsup.png",
      title: "Danger: Market Cashout / Liquidity Crunch",
      desc: "Thanh khoản sụt giảm mạnh — dấu hiệu dòng tiền rút hẳn khỏi thị trường thay vì chỉ luân chuyển giữa các nhóm ngành.",
    };
  }

  function renderCashout(v) {
    const r = evalCashout(v);
    banner.className = "co-banner " + r.cls;
    cbIcon.src = r.icon;
    cbTitle.textContent = r.title;
    cbDesc.textContent = r.desc;
    cbVal.innerHTML = v.toLocaleString("en-US") + '<span class="u">VND Billion</span>';
    const pct = Math.max(0, Math.min(100, (v / 30000) * 100));
    scaleMarker.style.left = pct + "%";
  }

  function setTurnover(v) {
    v = Math.max(0, Math.min(40000, v));
    numInput.value = v;
    rangeInput.value = Math.min(30000, v);
    renderCashout(v);
  }

  numInput.addEventListener("input", () => setTurnover(parseFloat(numInput.value) || 0));
  rangeInput.addEventListener("input", () => setTurnover(parseFloat(rangeInput.value) || 0));

  /* ============ Foreign / Proprietary flow (read-only, tự động) ============ */
  const FLOW_HINT = {
    foreign: { missing: "Chưa có dữ liệu.", proxy: "Nguồn: agent nghiên cứu công khai — số ước tính, không phải snapshot sàn." },
    prop: { missing: "Chưa có nguồn công khai cho phiên hôm nay — agent tự động kiểm tra mỗi ngày.", proxy: "Nguồn: agent nghiên cứu công khai — số ước tính, không phải snapshot sàn." },
  };
  const FLOW_Q_LABEL = { live: "Dữ liệu thật", proxy: "Proxy", preset: "Mẫu", missing: "" };

  // v: số (tỷ VND) hoặc null nếu chưa có dữ liệu. quality: live|proxy|preset|missing.
  function renderFlow(key, v, quality) {
    const valEl = el(key === "foreign" ? "flowForeignVal" : "flowPropVal");
    const tagEl = el(key === "foreign" ? "flowForeignTag" : "flowPropTag");
    const qEl = el(key === "foreign" ? "flowForeignQ" : "flowPropQ");
    const hintEl = el(key === "foreign" ? "flowForeignHint" : "flowPropHint");

    qEl.textContent = FLOW_Q_LABEL[quality] || "";
    qEl.className = "co-flow-quality " + quality;

    if (typeof v !== "number" || Number.isNaN(v)) {
      valEl.textContent = "—";
      valEl.className = "amt num";
      tagEl.textContent = "";
      tagEl.className = "dir-tag";
      hintEl.textContent = (FLOW_HINT[key] || {}).missing || "";
      return;
    }
    const isBuy = v >= 0;
    valEl.textContent = (isBuy ? "+" : "") + v.toLocaleString("en-US");
    valEl.className = "amt num " + (isBuy ? "buy" : "sell");
    tagEl.textContent = isBuy ? "Mua ròng / Net Buy" : "Bán ròng / Net Sell";
    tagEl.className = "dir-tag " + (isBuy ? "buy" : "sell");
    hintEl.textContent = quality === "proxy" ? (FLOW_HINT[key] || {}).proxy || "" : "";
  }

  /* ============ VN Core Sector Matrix ============ */
  /* Ngưỡng "khối lượng nóng" đến từ pipeline, riêng cho từng ngành (phân vị 80
     trên lịch sử của chính ngành đó, loại trừ phiên đang xét). Trước đây dùng
     1,2x cho mọi ngành: đo trên 120 phiên thì Bất động sản vượt 1,2 ở 41,7% số
     phiên còn Ngân hàng chỉ 11,7% — cùng chữ "Cash Inflow" nhưng hiếm gặp gấp
     gần 4 lần tuỳ dòng, nên không so sánh được giữa các ngành.
     Thiếu ngưỡng (chưa đủ quan sát) thì KHÔNG phân loại, thay vì rơi về hằng số. */
  function classify(chg, volRatio, hotThreshold) {
    if (volRatio == null || hotThreshold == null || chg == null) {
      return { label: "—", vi: "chưa đủ dữ liệu", cls: "neutral" };
    }
    if (volRatio > hotThreshold && chg > 0) return { label: "Cash Inflow", vi: "Dòng tiền vào", cls: "in" };
    if (volRatio > hotThreshold && chg < 0) return { label: "Cash Outflow", vi: "Tháo chạy", cls: "out" };
    return { label: "Neutral", vi: "Rotation", cls: "neutral" };
  }

  function renderSectorTable() {
    const tbody = el("sectorTableBody");
    tbody.innerHTML = "";
    const sorted = [...SECTOR_DATA].sort((a, b) => b.chg - a.chg);
    sorted.forEach((s) => {
      const tr = document.createElement("tr");

      const tdName = document.createElement("td");
      const nameSpan = document.createElement("span");
      nameSpan.className = "co-sec-name";
      nameSpan.textContent = s.en;
      const viSpan = document.createElement("span");
      viSpan.className = "vi";
      viSpan.textContent = s.vi;
      nameSpan.appendChild(viSpan);
      tdName.appendChild(nameSpan);

      const tdChg = document.createElement("td");
      const chgSpan = document.createElement("span");
      chgSpan.className = "num " + (s.chg > 0 ? "co-val-up" : s.chg < 0 ? "co-val-down" : "co-val-flat");
      chgSpan.textContent = (s.chg > 0 ? "+" : "") + s.chg.toFixed(1) + "%";
      tdChg.appendChild(chgSpan);

      const tdVal = document.createElement("td");
      const valSpan = document.createElement("span");
      valSpan.className = "num";
      valSpan.style.color = "var(--text)";
      valSpan.textContent = s.value.toLocaleString("en-US");
      tdVal.appendChild(valSpan);

      const tdVol = document.createElement("td");
      const volSpan = document.createElement("span");
      volSpan.className = "co-volratio num" +
        (s.hotThreshold != null && s.volRatio > s.hotThreshold ? " hot" : "");
      volSpan.textContent = s.volRatio.toFixed(2) + "x";
      // Nói rõ ô này đại diện tới đâu — nó KHÔNG cùng phạm vi với hai cột bên trái.
      if (s.coverage != null) {
        volSpan.title =
          `GTGD hôm nay / TB 25 phiên trước, trên ${s.repN} mã lớn nhất ngành` +
          (s.repSyms && s.repSyms.length ? ` (${s.repSyms.join(", ")})` : "") +
          ` — rổ này chiếm ${s.coverage}% GTGD của ngành hôm nay.` +
          (s.hotThreshold != null
            ? ` Ngưỡng "nóng" của riêng ngành này: ${s.hotThreshold.toFixed(2)}x (phân vị 80 lịch sử của nó).`
            : "");
      }
      tdVol.appendChild(volSpan);

      const tdFlow = document.createElement("td");
      const c = classify(s.chg, s.volRatio, s.hotThreshold);
      const badge = document.createElement("span");
      badge.className = "co-flow-badge " + c.cls;
      badge.textContent = (c.cls === "in" ? "🟢 " : c.cls === "out" ? "🔴 " : "▪ ") + c.label + " (" + c.vi + ")";
      tdFlow.appendChild(badge);

      tr.appendChild(tdName);
      tr.appendChild(tdChg);
      tr.appendChild(tdVal);
      tr.appendChild(tdVol);
      tr.appendChild(tdFlow);
      tbody.appendChild(tr);
    });
  }

  /* ============ Market Leader Flow ============ */
  function renderStocks() {
    const grid = el("stocksGrid");
    grid.innerHTML = "";
    const maxVal = Math.max(...LEADING_STOCKS.flatMap((s) => [s.buy, s.sell]));

    LEADING_STOCKS.forEach((s) => {
      const net = s.buy - s.sell;
      const isNetBuy = net >= 0;

      const card = document.createElement("div");
      card.className = "co-stock-card";
      card.innerHTML = `
        <div class="co-stock-card-hd">
          <span class="s-name">${s.code}</span>
          <span class="s-sector">${s.sector}</span>
        </div>
        <div class="co-bar-row">
          <div class="bar-label"><span>Foreign Buy Value</span><span class="bar-val num">${s.buy.toLocaleString("en-US")} tỷ</span></div>
          <div class="co-bar-track"><div class="co-bar-fill buy" style="width:${(s.buy / maxVal * 100).toFixed(1)}%"></div></div>
        </div>
        <div class="co-bar-row">
          <div class="bar-label"><span>Foreign Sell Value</span><span class="bar-val num">${s.sell.toLocaleString("en-US")} tỷ</span></div>
          <div class="co-bar-track"><div class="co-bar-fill sell" style="width:${(s.sell / maxVal * 100).toFixed(1)}%"></div></div>
        </div>
        <div class="co-net-row">
          <span class="net-label">Foreign Net Flow</span>
          <span class="net-val co-net-val ${isNetBuy ? "buy" : "sell"} num">
            ${isNetBuy ? "▲" : "▼"} ${isNetBuy ? "+" : ""}${net.toLocaleString("en-US")} tỷ
          </span>
        </div>
        <div class="co-mini-row">
          <span>Room ngoại còn lại</span>
          <span class="num">${typeof s.roomPct === "number" ? s.roomPct.toFixed(1) + "%" : "—"}</span>
        </div>
        <div class="co-mini-row">
          <span>Spread (bid/ask)</span>
          <span class="num">${typeof s.spreadPct === "number" ? s.spreadPct.toFixed(2) + "%" : "—"}</span>
        </div>
        <div class="co-mini-row">
          <span>Định giá</span>
          <span class="num">P/E ${typeof s.pe === "number" ? s.pe.toFixed(1) : "—"} · P/B ${typeof s.pb === "number" ? s.pb.toFixed(1) : "—"} · ROE ${typeof s.roe === "number" ? s.roe.toFixed(1) + "%" : "—"}</span>
        </div>
        <div class="co-mini-row">
          <span>Sở hữu</span>
          <span class="num">Ngoại ${typeof s.foreignerPct === "number" ? s.foreignerPct.toFixed(1) + "%" : "—"} · NN ${typeof s.statePct === "number" ? s.statePct.toFixed(1) + "%" : "—"} · Free float ${typeof s.freeFloatPct === "number" ? s.freeFloatPct.toFixed(1) + "%" : "—"}</span>
        </div>
        <div class="co-mini-row">
          <span>Thời gian hấp thụ (500 tỷ, ≤15%/phiên)</span>
          <span class="num">${typeof s.capacityDays500bn === "number" ? s.capacityDays500bn.toFixed(1) + " phiên" : "—"}</span>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  /* ============ Sắp cạn room ngoại ============ */
  function renderForeignRoomWatch() {
    const tbody = el("roomWatchTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!FOREIGN_ROOM_WATCH.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.style.textAlign = "center";
      td.style.color = "var(--dim)";
      td.textContent = "— Chưa có dữ liệu (cần cashout-vn.json có foreignRoomWatch)";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    FOREIGN_ROOM_WATCH.forEach((r) => {
      const tr = document.createElement("tr");
      const tdCode = document.createElement("td");
      tdCode.textContent = r.code;
      tdCode.style.fontWeight = "700";
      const tdRoom = document.createElement("td");
      tdRoom.className = "num";
      tdRoom.textContent = typeof r.room_pct === "number" ? r.room_pct.toFixed(1) + "%" : "—";
      tdRoom.style.color = typeof r.room_pct === "number" && r.room_pct <= 1 ? "var(--giam)" : "var(--text)";
      const tdTurn = document.createElement("td");
      tdTurn.className = "num";
      tdTurn.textContent = typeof r.turnover_bn === "number" ? r.turnover_bn.toLocaleString("en-US") : "—";
      tr.appendChild(tdCode); tr.appendChild(tdRoom); tr.appendChild(tdTurn);
      tbody.appendChild(tr);
    });
  }

  /* ============ Mức độ cô đặc vốn hoá ============ */
  function renderMarketConcentration() {
    const statsEl = el("concentrationStats");
    const tbody = el("concentrationTableBody");
    if (!statsEl || !tbody) return;

    const mc = isReal ? data.marketConcentration : null;
    if (mc && (mc.top5Pct != null || mc.top10Pct != null)) {
      statsEl.innerHTML = `
        <div class="co-vn30-tile"><span class="k">Top 5 mã</span><span class="v num">${mc.top5Pct != null ? mc.top5Pct.toFixed(1) + "%" : "—"}</span></div>
        <div class="co-vn30-tile"><span class="k">Top 10 mã</span><span class="v num">${mc.top10Pct != null ? mc.top10Pct.toFixed(1) + "%" : "—"}</span></div>
      `;
    } else {
      statsEl.innerHTML = `<p style="color:var(--dim);font-size:12.5px;margin:0">— Chưa có dữ liệu.</p>`;
    }

    tbody.innerHTML = "";
    const stocks = (mc && Array.isArray(mc.topStocks)) ? mc.topStocks : [];
    if (!stocks.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.style.textAlign = "center";
      td.style.color = "var(--dim)";
      td.textContent = "— Chưa có dữ liệu";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    stocks.forEach((s) => {
      const tr = document.createElement("tr");
      const tdCode = document.createElement("td");
      tdCode.textContent = s.code;
      tdCode.style.fontWeight = "700";
      const tdCap = document.createElement("td");
      tdCap.className = "num";
      tdCap.textContent = typeof s.marketCapBn === "number" ? s.marketCapBn.toLocaleString("en-US") : "—";
      const tdWeight = document.createElement("td");
      tdWeight.className = "num";
      tdWeight.textContent = typeof s.weightPct === "number" ? s.weightPct.toFixed(2) + "%" : "—";
      tr.appendChild(tdCode); tr.appendChild(tdCap); tr.appendChild(tdWeight);
      tbody.appendChild(tr);
    });
  }

  /* ============ Năng lực hấp thụ vốn & định giá nhóm dẫn dắt ============ */
  function renderCapacityAndRollup() {
    const capEl = el("capacityStats");
    if (capEl) {
      const tiers = CAPACITY && Array.isArray(CAPACITY.tiers) ? CAPACITY.tiers : [];
      capEl.innerHTML = tiers.length
        ? tiers.map((t) => `
            <div class="co-vn30-tile">
              <span class="k">${t.capitalBn.toLocaleString("en-US")} tỷ VND</span>
              <span class="v num">${typeof t.days === "number" ? t.days.toFixed(1) + " phiên" : "—"}</span>
            </div>
          `).join("")
        : `<p style="color:var(--dim);font-size:12.5px;margin:0">— Chưa có dữ liệu.</p>`;
    }

    const rollupEl = el("leadersRollupStats");
    if (rollupEl) {
      const r = LEADERS_ROLLUP;
      rollupEl.innerHTML = r
        ? `
          <div class="co-vn30-tile"><span class="k">P/E bình quân</span><span class="v num">${typeof r.pe === "number" ? r.pe.toFixed(1) : "—"}</span></div>
          <div class="co-vn30-tile"><span class="k">P/B bình quân</span><span class="v num">${typeof r.pb === "number" ? r.pb.toFixed(1) : "—"}</span></div>
          <div class="co-vn30-tile"><span class="k">ROE bình quân</span><span class="v num">${typeof r.roe === "number" ? r.roe.toFixed(1) + "%" : "—"}</span></div>
          <div class="co-vn30-tile"><span class="k">Sở hữu ngoại bình quân</span><span class="v num">${typeof r.foreigner_pct === "number" ? r.foreigner_pct.toFixed(1) + "%" : "—"}</span></div>
          <div class="co-vn30-tile"><span class="k">Sở hữu Nhà nước bình quân</span><span class="v num">${typeof r.state_pct === "number" ? r.state_pct.toFixed(1) + "%" : "—"}</span></div>
          <div class="co-vn30-tile"><span class="k">Free float bình quân</span><span class="v num">${typeof r.free_float_pct === "number" ? r.free_float_pct.toFixed(1) + "%" : "—"}</span></div>
        `
        : `<p style="color:var(--dim);font-size:12.5px;margin:0">— Chưa có dữ liệu.</p>`;
    }
  }

  /* ============ Tín hiệu tổ chức (VN30) ============ */
  function renderInsight() {
    const statsEl = el("vn30Stats");
    const listEl = el("insiderList");
    if (!statsEl || !listEl) return;

    const v30 = insight && insight.vn30;
    if (v30 && v30.quality === "live") {
      const isContango = v30.basis >= 0;
      statsEl.innerHTML = `
        <div class="co-vn30-tile"><span class="k">VN30 giao ngay</span><span class="v num">${v30.spot.toLocaleString("en-US")}</span></div>
        <div class="co-vn30-tile"><span class="k">VN30F1M (tương lai)</span><span class="v num">${v30.futures.toLocaleString("en-US")}</span></div>
        <div class="co-vn30-tile"><span class="k">Basis</span><span class="v num ${isContango ? "buy" : "sell"}">${isContango ? "+" : ""}${v30.basis.toLocaleString("en-US")} (${isContango ? "+" : ""}${v30.basis_pct}%)</span></div>
      `;
    } else {
      statsEl.innerHTML = `<p style="color:var(--dim);font-size:12.5px;margin:0">— Chưa có dữ liệu basis VN30F1M hôm nay.</p>`;
    }

    const trades = (insight && Array.isArray(insight.insiderTrades)) ? insight.insiderTrades : [];
    listEl.innerHTML = "";
    if (!trades.length) {
      listEl.innerHTML = `<p style="color:var(--dim);font-size:12.5px;margin:10px 0 0">— Không có giao dịch cổ đông lớn/nội bộ nào công bố trong 30 ngày qua (30 mã VN30).</p>`;
      return;
    }
    trades.slice(0, 15).forEach((t) => {
      const row = document.createElement("div");
      row.className = "co-insider-row";
      const isBuy = (t.direction || "").toLowerCase() === "buy";
      const isSell = (t.direction || "").toLowerCase() === "sell";
      row.innerHTML = `
        <span class="co-insider-code">${t.ticker}</span>
        <span class="co-insider-title">${t.title_vi || t.title_en || "—"}</span>
        <span class="dir-tag ${isBuy ? "buy" : isSell ? "sell" : ""}">${isBuy ? "Mua" : isSell ? "Bán" : "—"}</span>
        <span class="co-insider-date">${t.date || "—"}</span>
      `;
      listEl.appendChild(row);
    });
  }

  /* ============ Khởi tạo giá trị ban đầu ============ */
  const initialTurnover = isReal && typeof data.totalTurnoverBn === "number"
    ? Math.round(data.totalTurnoverBn) : PRESET_TURNOVER;
  setTurnover(initialTurnover);

  const dataQuality = (isReal && data.quality) || {};
  if (isReal && typeof data.foreignNetBn === "number") {
    renderFlow("foreign", Math.round(data.foreignNetBn), dataQuality.foreignNetBn || "live");
  } else if (isReal) {
    renderFlow("foreign", null, "missing");
  } else {
    renderFlow("foreign", PRESET_FOREIGN, "preset");
  }

  if (isReal && typeof data.proprietaryNetBn === "number") {
    renderFlow("prop", Math.round(data.proprietaryNetBn), dataQuality.proprietaryNetBn || "proxy");
  } else {
    renderFlow("prop", null, "missing");
  }

  renderSectorTable();
  renderStocks();
  renderForeignRoomWatch();
  renderMarketConcentration();
  renderCapacityAndRollup();
  renderInsight();

  /* ============ Trạng thái dữ liệu + ghi chú ============ */
  const statusEl = el("dataStatus");
  const statusText = el("dataStatusText");
  const sectorNote = el("sectorDataNote");
  const stocksSub = el("stocksSub");

  if (isReal) {
    statusEl.className = "pill";
    // Ngày PHIÊN trước, giờ sinh file sau — chạy sáng thứ Bảy thì số liệu vẫn
    // là phiên thứ Sáu, chỉ ghi generatedAtIct sẽ khiến người xem đọc nhầm.
    statusText.textContent = data.asof
      ? "Phiên " + data.asof + " · sinh lúc " + (data.generatedAtIct || "—")
      : "Dữ liệu thật · " + (data.generatedAtIct || "");
    // Pipeline vnstock đã từng đỏ nhiều ngày (25→29/09/2026) trong khi trang
    // vẫn in đúng ngày phiên cũ và không nói gì. Nhãn này là chỗ nói.
    attachStaleTag(statusEl, data.asof);
    if (Array.isArray(data.sectors) && data.sectors.length) {
      sectorNote.textContent =
        "※ GTGD & % thay đổi là số thật, tính trên TOÀN BỘ mã trong ngành (phiên " +
        (data.asof || data.generatedAtIct || "—") + "). " +
        "25D Avg Vol Ratio tính trên nhóm mã lớn nhất mỗi ngành, " +
        (data.sectors.map((x) => x.vol_ratio_coverage_pct)
          .filter((x) => x != null).length
          ? "phủ " + Math.min(...data.sectors.map((x) => x.vol_ratio_coverage_pct).filter((x) => x != null)) +
            "–" + Math.max(...data.sectors.map((x) => x.vol_ratio_coverage_pct).filter((x) => x != null)) + "% GTGD ngành"
          : "phạm vi hẹp hơn") +
        " — không cùng phạm vi với hai cột bên trái. Di chuột lên từng ô để xem mã và mức phủ.";
    }
    if (Array.isArray(data.tickers) && data.tickers.length) {
      // Cơ sở xếp hạng đọc từ payload, không giả định: pipeline tự rơi về xếp
      // theo 1 phiên khi không lấy đủ lịch sử (hạn mức API), và khi đó dán nhãn
      // "15 phiên" lên danh sách này là sai.
      const basisNote = data.tickersRankBasisNote
        || (data.tickersRankBasis === "adtv15"
            ? "GTGD bình quân 15 phiên gần nhất"
            : "GTGD phiên hôm nay");
      stocksSub.textContent =
        "10 mã dẫn dắt, xếp theo " + basisNote + ". " +
        "Số liệu hiển thị là khối ngoại mua/bán thật (Foreign Buy/Sell Value) trong PHIÊN GẦN NHẤT " +
        "— không bao gồm lệnh của NĐT trong nước. " +
        "Độ dài thanh được chuẩn hoá theo giá trị lớn nhất trong nhóm.";
    }
  } else {
    statusEl.className = "pill";
    statusText.textContent = "Dữ liệu mẫu (preset)";
  }
}
