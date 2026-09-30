import { useEffect, useRef } from "react";
import SiteHeader from "../components/layout/SiteHeader.jsx";
import TickerTape from "../components/layout/TickerTape.jsx";
import { useLiveMarketData } from "../hooks/useLiveMarketData.js";
import { useHistory } from "../hooks/useHistory.js";
import { useNews } from "../hooks/useNews.js";
import { useEconActuals } from "../hooks/useEconActuals.js";
import { initMarketDashboard } from "./dashboardEngine.js";
import "../styles/tokens.css";
import "../styles/layout.css";
import "./dashboard.css";

export default function MarketDashboardApp() {
  const { live, status } = useLiveMarketData();
  const { rows: history, status: historyStatus } = useHistory();
  const { items: newsItems, generatedAtIct: newsGeneratedAtIct, status: newsStatus } = useNews();
  const { items: econActuals, status: econActualsStatus } = useEconActuals();
  const initedRef = useRef(false);

  useEffect(() => {
    if (status !== "ready" || historyStatus !== "ready" || newsStatus !== "ready" || econActualsStatus !== "ready" || initedRef.current) return;
    initedRef.current = true;
    initMarketDashboard(live, history, { items: newsItems, generatedAtIct: newsGeneratedAtIct }, econActuals);
  }, [status, live, historyStatus, history, newsStatus, newsItems, newsGeneratedAtIct, econActualsStatus, econActuals]);

  return (
    <>
      <SiteHeader active="dashboard" subtitle="Độ rộng · Margin · Tâm lý · Lợi suất Mỹ–Việt · tin vĩ mô">
        <span className="pill"><span className="dot" id="mkDot" /><span id="mkStatus">Đang tải…</span></span>
        <span className="pill"><span className="num" id="clock">--:--:--</span> ICT</span>
        <span className="pill">Dữ liệu <span className="num" id="asof">--/--/----</span></span>
      </SiteHeader>

      <TickerTape />

      <section className="hero">
        <div className="wrap hero-in">
          <div className="hero-left">
            <span className="jp-eyebrow">Thị trường Việt Nam · chuỗi <span id="epNo">—</span> phiên trong bộ nhớ</span>
            <h2 className="hero-title">Tỷ lệ tăng giảm</h2>
            <p className="hero-sub">Phiên <span id="heroDate" className="num" /> · HOSE · <span id="heroSess">đã đóng cửa</span></p>
          </div>
          <div className="hero-num">
            <span className="jp-tag">VN-Index</span>
            <div className="big num" id="heroVal">0</div>
            <div className="chgline" id="heroChg" />
          </div>
          <div className="hero-ratio">
            <span className="jp-tag">ADR 25 phiên · rổ VN100</span>
            <div className="big num" id="heroAD">0</div>
            <div className="chgline" id="heroZone" />
          </div>
        </div>
      </section>

      <main className="wrap">

        <div className="layout">
          <div className="col-main">
            {/* ======================= BREADTH ======================= */}
            <div className="grid g-3-2" style={{ marginTop: 24 }}>
              <section className="panel">
                <div className="p-hd">
                  <h2>Cơ cấu cung cầu phiên gần nhất</h2>
                  {/* Nhãn do dashboardEngine đặt theo chất lượng dữ liệu thật,
                      không nướng cứng trong JSX (xem histTag làm chuẩn). */}
                  <span className="dtag dtag-sample" id="boardTag">Mẫu</span>
                  <span className="sub" id="boardDate" />
                </div>
                <div className="board">
                  <div className="board-bar" id="boardBar" />
                  <div className="board-key">
                    <span><i style={{ background: "var(--tran)" }} />Trần</span>
                    <span><i style={{ background: "var(--tang)" }} />Tăng</span>
                    <span><i style={{ background: "var(--tc)" }} />Tham chiếu</span>
                    <span><i style={{ background: "var(--giam)" }} />Giảm</span>
                    <span><i style={{ background: "var(--san)" }} />Sàn</span>
                  </div>
                </div>
                <div className="stats" id="boardStats" />
              </section>

              <section className="panel">
                <div className="p-hd"><h2>Vùng quá mua / quá bán</h2><span className="dtag dtag-sample" id="gaugeTag">Mẫu</span><span className="sub">ADR 25 · rổ VN100 · ngưỡng 70 / 80 / 120</span></div>
                <div className="p-body">
                  <div className="gauge">
                    <div className="gauge-track"><div className="gauge-mark" id="gaugeMark" data-v="--" /></div>
                    <div className="gauge-scale"><span>40</span><span>70</span><span>80</span><span>100</span><span>120</span><span>180</span></div>
                  </div>
                  <p className="note" id="gaugeNote" style={{ marginTop: 14 }} />
                </div>
              </section>
            </div>

            <section className="panel" style={{ marginTop: 16 }}>
              <div className="p-hd">
                <h2>Hệ số ADR — Biểu đồ so sánh VN30 / VN100</h2>
                <span className="dtag dtag-sample" id="adrTag">Mẫu</span>
                <span className="sub">Advance / Decline Ratio · quá bán &lt;80 · quá mua &gt;120</span>
                <div className="right">
                  <div className="seg" id="winSeg">
                    <button data-w="25" aria-pressed="true">25 phiên</button>
                    <button data-w="15" aria-pressed="false">15</button>
                    <button data-w="10" aria-pressed="false">10</button>
                    <button data-w="6" aria-pressed="false">6</button>
                  </div>
                  <div className="seg" id="periodSeg">
                    <button data-n="42" aria-pressed="false">2T</button>
                    <button data-n="63" aria-pressed="false">3T</button>
                    <button data-n="126" aria-pressed="true">6T</button>
                    <button data-n="250" aria-pressed="false">1N</button>
                  </div>
                </div>
              </div>
              <div className="legend" id="ratioLegend" />
              <div className="p-body tight">
                <div className="chart" id="ratioChart"><div className="tip" id="ratioTip" /></div>
              </div>
            </section>

            <section className="panel" style={{ marginTop: 16 }}>
              <div className="p-hd">
                <h2>90 phiên giao dịch gần nhất</h2>
                <span className="dtag dtag-sample" id="histTag">Mẫu</span>
                <span className="sub">chốt sau ATC · từ 15:00 ICT</span>
                <span className="key">
                  <i className="k-lo">&lt;70</i><span className="k-lo-t">quá bán sâu</span>
                  <span style={{ color: "var(--dim)", fontSize: 11, margin: "0 4px" }}>| 70–80 quá bán | 80–120 cân bằng |</span>
                  <span className="k-ramp" aria-hidden="true"><i className="rt-h0" /><i className="rt-h1" /><i className="rt-h2" /><i className="rt-h3" /><i className="rt-h4" /><i className="rt-h5" /></span>
                  <span className="k-hi-t">≥100 cầu áp đảo · &gt;120 quá mua</span>
                </span>
                <div className="right">
                  <div className="seg" id="rowScope">
                    <button data-k="all" aria-pressed="true">Toàn thị trường</button>
                    <button data-k="vn100" aria-pressed="false">VN100</button>
                    <button data-k="vn30" aria-pressed="false">VN30</button>
                  </div>
                </div>
              </div>
              <div className="scroll">
                <table className="hist">
                  <thead><tr>
                    <th rowSpan="2">Ngày GD</th><th rowSpan="2">VN-Index</th><th rowSpan="2">Thay đổi</th><th rowSpan="2">±%</th>
                    <th rowSpan="2">GTGD (tỷ đ)</th>
                    <th rowSpan="2">Mã tăng</th><th rowSpan="2">Mã giảm</th><th rowSpan="2">Đứng giá</th><th rowSpan="2">Cơ cấu</th>
                    <th colSpan="4" className="grp">Hệ số ADR</th>
                  </tr>
                    <tr className="sub-hd">
                      <th className="grp-l">25 phiên</th><th>15 phiên</th><th>10 phiên</th><th>6 phiên</th>
                    </tr></thead>
                  <tbody id="histBody" />
                </table>
              </div>
            </section>

            <div className="grid g-1-1" style={{ marginTop: 16 }}>
              <section className="panel">
                <div className="p-hd"><h2>Dự phóng hệ số ADR phiên kế tiếp</h2><span className="dtag dtag-proxy">Proxy</span><span className="sub">tham khảo · rổ VN100</span></div>
                <div className="p-body">
                  <p className="note" style={{ marginTop: 0 }}>Kéo thanh trượt để giả định số mã tăng / giảm của rổ VN100 trong phiên kế tiếp. Mỗi chu kỳ sẽ loại phiên cũ nhất khỏi mẫu rồi cộng giả định vào để tính lại hệ số — chu kỳ càng ngắn thì biên độ dao động càng lớn.</p>
                  <div style={{ marginTop: 16 }}>
                    <div className="proj-row">
                      <label htmlFor="pUp">Số mã tăng giá</label>
                      <input type="range" id="pUp" min="0" max="100" defaultValue="55" />
                      <span className="proj-val up" id="pUpV">55</span>
                    </div>
                    <div className="proj-row">
                      <label htmlFor="pDown">Số mã giảm giá</label>
                      <input type="range" id="pDown" min="0" max="100" defaultValue="35" />
                      <span className="proj-val down" id="pDownV">35</span>
                    </div>
                  </div>
                  <div className="stats" id="projStats" style={{ margin: "16px -20px 0" }} />
                  <div className="tbl-x">
                    <table className="scenarios" style={{ marginTop: 0 }}>
                      <thead><tr><th>Kịch bản phiên kế tiếp</th><th>Tăng/Giảm</th><th>25</th><th>15</th><th>10</th><th>6</th></tr></thead>
                      <tbody id="scenBody" />
                    </table>
                  </div>
                </div>
              </section>

              <section className="panel">
                <div className="p-hd"><h2>So sánh bốn chu kỳ tính ADR</h2><span className="sub">phiên <span id="winDate" /></span></div>
                <div className="p-body tight"><div className="chart" id="winChart" /></div>
                <div className="p-body" style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 14 }}>
                  <p className="note" style={{ marginTop: 0 }} id="winNote" />
                </div>
              </section>
            </div>

            {/* ======================= DƯ NỢ MARGIN (hàng ngày) ======================= */}
            <section className="panel" style={{ marginTop: 24 }} id="marginPanel">
              <div className="p-hd">
                <h2>Dư nợ cho vay ký quỹ (Margin)</h2>
                <span className="dtag dtag-sample" id="mgTag">Mẫu</span>
                <span className="sub">toàn TT · tỷ đồng · thiết kế <b>hàng ngày</b> (nguồn live có thể tuần)</span>
                <div className="right">
                  <div className="seg" id="mgPeriod" role="group" aria-label="Khoảng thời gian">
                    <button data-n="22" aria-pressed="false">1T</button>
                    <button data-n="66" aria-pressed="false">3T</button>
                    <button data-n="132" aria-pressed="true">6T</button>
                    <button data-n="250" aria-pressed="false">1N</button>
                  </div>
                </div>
              </div>
              <div className="stats" id="mgStats" />
              <div className="legend" id="mgLegend" style={{ paddingTop: 12 }} />
              <div className="p-body tight">
                <div className="chart" id="mgChart"><div className="tip" id="mgTip" /></div>
              </div>
              <div className="grid g-1-1" style={{ margin: 0, padding: "0 20px 18px", gap: 18 }}>
                <div>
                  <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>Top CTCK theo dư nợ <span className="dtag dtag-proxy" style={{ marginLeft: 4 }}>Quý</span></h3>
                  <div className="scroll" style={{ maxHeight: 340 }}>
                    <table>
                      <thead><tr>
                        <th>#</th><th>Công ty chứng khoán</th><th>Dư nợ</th><th>So quý trước</th><th>Tỷ trọng</th><th>Room còn</th>
                      </tr></thead>
                      <tbody id="mgBrokerBody" />
                    </table>
                  </div>
                  <p className="note" id="mgNote" style={{ marginTop: 12 }} />
                </div>
                <div className="mbr" id="mgRiskBox" />
              </div>
            </section>

            {/* =============== SỢ HÃI & THAM LAM =============== */}
            <div className="grid g-1-1" style={{ marginTop: 18 }}>
              <section className="panel" id="fgUS" />
              <section className="panel" id="fgVN" />
            </div>

            {/* ======================= BOND ======================= */}
            <div className="grid g-2-1">
              <section className="panel">
                <div className="p-hd">
                  <h2>Đường cong lợi suất trái phiếu Chính phủ</h2>
                  {/* Nhãn do engine đặt: panel này từng gắn cứng dtag-live
                      "Tham chiếu chốt" trong khi toàn bộ nửa VN là số mẫu tĩnh. */}
                  <span className="dtag dtag-live" id="curveTag">Tham chiếu chốt</span>
                  <span className="sub">USD vs VND · 1–30 năm · nhãn ngày trên kỳ hạn VN = lãi suất trúng thầu sơ cấp (Kho bạc Nhà nước, đấu thầu HNX) và ngày phát hành của đợt đó · <span className="est">e</span> = nội suy</span>
                  <div className="right">
                    <div className="seg" id="curveScale">
                      <button data-s="log" aria-pressed="true">Log kỳ hạn</button>
                      <button data-s="lin" aria-pressed="false">Tuyến tính</button>
                    </div>
                  </div>
                </div>
                <div className="legend" id="curveLegend" />
                <div className="p-body tight">
                  <div className="chart" id="curveChart"><div className="tip" id="curveTip" /></div>
                </div>
              </section>

              <section className="panel">
                <div className="p-hd"><h2>Chênh lệch lợi suất VN − Mỹ</h2><span className="sub">điểm cơ bản</span></div>
                <div className="p-body tight">
                  <div className="chart" id="spreadChart" />
                </div>
                <div className="p-body" style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 14 }}>
                  <p className="note" id="spreadNote" />
                </div>
              </section>
            </div>

            <div className="grid g-1-1">
              <section className="panel">
                <div className="p-hd">
                  <div className="mark" style={{ width: 26, height: 26, fontSize: 9.5, fontWeight: 700, background: "linear-gradient(160deg,var(--flag-us-a),var(--flag-us-b))", boxShadow: "0 2px 6px rgba(75,98,201,.3)" }}>US</div>
                  <h2>Trái phiếu Kho bạc Mỹ (USD)</h2>
                  <span className="dtag dtag-live">Tham chiếu chốt</span>
                </div>
                <table>
                  <thead><tr><th>Kỳ hạn</th><th>Lợi suất</th><th>1 phiên</th><th>1 tháng</th><th>1 năm</th></tr></thead>
                  <tbody id="usBody" />
                </table>
              </section>

              <section className="panel">
                <div className="p-hd">
                  <div className="mark" style={{ width: 26, height: 26, fontSize: 12, background: "linear-gradient(160deg,var(--flag-vn-a),var(--flag-vn-b))", color: "var(--flag-vn-star)", boxShadow: "0 2px 6px rgba(218,37,29,.3)" }}>★</div>
                  <h2>Trái phiếu Chính phủ Việt Nam (VND)</h2>
                  <span className="dtag dtag-est">Nội suy (e)</span>
                </div>
                <table>
                  <thead><tr><th>Kỳ hạn</th><th>Lợi suất</th><th>1 phiên</th><th>1 tháng</th><th>1 năm</th></tr></thead>
                  <tbody id="vnBody" />
                </table>
              </section>
            </div>

            {/* ======================= NOTES ======================= */}
            <div className="grid" style={{ marginTop: 24 }}>
              <section className="panel">
                <div className="p-hd"><h2>Cách đọc hệ số ADR</h2></div>
                <div className="p-body">
                  <p className="note" style={{ marginTop: 0 }}><b>Hệ số ADR</b> (Advance/Decline Ratio) đo tương quan cung cầu bằng cách so tổng số mã tăng giá với tổng số mã giảm giá trong một chu kỳ cố định. Đây là chỉ báo <b>độ rộng thị trường</b> — cho biết đà tăng của chỉ số lan toả toàn sàn hay chỉ tập trung ở nhóm cổ phiếu vốn hoá lớn.</p>
                  <div className="formula">ADR (25 phiên) = Σ(số mã tăng giá, 25 phiên) ÷ Σ(số mã giảm giá, 25 phiên) × 100</div>
                  <div className="note">
                    <ul>
                      <li><b className="down">Trên 120</b> — vùng quá mua. Bên cầu áp đảo trên diện rộng, rủi ro điều chỉnh ngắn hạn tăng dần.</li>
                      <li><b>80 – 120</b> — vùng cân bằng cung cầu, chưa phát tín hiệu đảo chiều.</li>
                      <li><b className="up">Dưới 80</b> — vùng quá bán (chuẩn). Độ tin cậy thường cao hơn ngưỡng quá mua khi canh giải ngân ngược xu hướng.</li>
                      <li><b className="up">Dưới 70</b> — quá bán <b>sâu</b> (tô xanh dương trên bảng lịch sử). Hiếm hơn; thường xuất hiện sau đợt xả mạnh.</li>
                    </ul>
                  </div>
                  <p className="note" style={{ marginTop: 12 }}><b>Lưu ý về tính bất đối xứng.</b> Hệ số không đối xứng quanh mốc 100: 800 mã tăng trên 1.000 mã giảm cho ADR = 80, nhưng chiều ngược lại (1.000 mã tăng trên 800 mã giảm) cho 125 chứ không phải 120. Ngưỡng đối ứng của 70 là ≈142,9; của 60 là ≈166,7. Màu đỏ trên ô ADR cao = <b>rủi ro quá mua</b>, không phải "thị trường đang giảm".</p>
                  <p className="note" style={{ marginTop: 12 }}><b>Vì sao tách rổ VN30 và VN100.</b> Rổ VN30 chỉ gồm 30 mã nên hệ số nhiễu mạnh và phản ứng nhanh với biến động phiên. Rổ VN100 mượt hơn, phản ánh sát hơn dòng tiền toàn thị trường. Khi VN-Index tăng điểm nhưng ADR của rổ VN100 suy giảm, đà tăng đang thu hẹp về nhóm cổ phiếu vốn hoá lớn — đây là tín hiệu phân kỳ cần theo dõi.</p>
                </div>
              </section>
            </div>
          </div>

          <aside className="news">
            <div className="news-hd">
              <span className="jp-eyebrow">Tin kinh tế</span>
              <h2>Tin vĩ mô tác động</h2>
              <p className="sub">Lãi suất Mỹ · việc làm · lạm phát → kênh truyền dẫn sang Việt Nam</p>
              <p className="sub" id="newsUpdated" style={{ marginTop: 2 }} />
            </div>

            <div className="news-section">
              <h3 className="news-section-hd">1. Lịch sự kiện kinh tế Mỹ</h3>
              <div id="newsSchedule" />
            </div>

            <div className="news-section">
              <h3 className="news-section-hd">2. Kết quả chỉ số kinh tế Mỹ</h3>
              <div id="newsResults" />
            </div>

            <div className="news-section">
              <h3 className="news-section-hd">3. Tin kinh tế chứng khoán Việt Nam</h3>
              <div id="newsVN" />
            </div>
          </aside>
        </div>

      </main>
    </>
  );
}
