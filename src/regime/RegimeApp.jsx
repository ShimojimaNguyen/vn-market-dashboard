import SiteHeader from "../components/layout/SiteHeader.jsx";
import Footer from "../components/layout/Footer.jsx";
import { useRegime } from "../hooks/useRegime.js";
import "../styles/tokens.css";
import "../styles/layout.css";
import "./regime.css";
import { StaleTag } from "../components/StaleTag.jsx";

const SCORE_META = {
  liquidity: { name: "Thanh khoản", vi: "Liquidity", icon: "💧" },
  positioning: { name: "Định vị vốn", vi: "Positioning", icon: "🧭" },
  momentum: { name: "Động lượng ngành", vi: "Momentum", icon: "🔄" },
  macro: { name: "Bối cảnh vĩ mô", vi: "Macro", icon: "🌐" },
};

const BAND_LABEL = {
  healthy: "Khoẻ mạnh",
  caution: "Thận trọng",
  danger: "Rủi ro",
  insufficient_history: "Chưa đủ dữ liệu",
};

const VERDICT_MASCOT = {
  ok: "mascots/confident-glow.png",
  warn: "mascots/sunburst-glow.png",
  danger: "mascots/worried-handsup.png",
  unknown: "mascots/sleeping.png",
};

const DRILL_DOWN = [
  { href: "index.html", name: "Trong nước", desc: "VN-Index, lợi suất, margin, khối ngoại — dữ liệu lõi mỗi ngày." },
  { href: "the-gioi.html", name: "Thế giới", desc: "31 chỉ số, tiền tệ, hàng hoá — bối cảnh vĩ mô toàn cầu." },
  { href: "lich-su.html", name: "Lịch sử", desc: "Chuỗi thời gian & sự kiện — đối chiếu tương quan." },
  { href: "dong-tien-nganh.html", name: "Dòng tiền ngành", desc: "RRG 10 ngành ICB — nguồn của Momentum Score." },
  { href: "dong-tien-cashout.html", name: "Cashout", desc: "GTGD & khối ngoại thật — nguồn của Liquidity/Positioning Score." },
];

const ArrowIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 12L12 4M12 4H6M12 4V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Sparkline({ values }) {
  const vals = values.filter((v) => v != null);
  if (vals.length < 3) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals), rg = hi - lo || 1;
  const n = values.length;
  const W = 200, H = 30;
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * W;
    if (v == null) return null;
    const y = H - 2 - ((v - lo) / rg) * (H - 6);
    return [x, y];
  });
  const segs = [];
  let cur = [];
  pts.forEach((p, i) => {
    if (p == null) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  });
  if (cur.length > 1) segs.push(cur);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {segs.map((seg, i) => (
        <polyline
          key={i}
          points={seg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke="var(--blue)"
          strokeWidth="1.6"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function ScoreCard({ id, score, history }) {
  const meta = SCORE_META[id];
  const band = score?.band || "insufficient_history";
  const values = history.map((r) => r.scores?.[id]).filter((v) => v !== undefined);

  return (
    <div className="rg-card">
      <div className="rg-card-hd">
        <span className="rg-name">{meta.icon} {meta.name}</span>
        <span className={`rg-badge ${band}`}>{BAND_LABEL[band] || band}</span>
      </div>
      {score?.value != null ? (
        <div className="rg-val">{score.value.toFixed(0)}<span style={{ fontSize: 13, color: "var(--dim)", fontWeight: 500 }}> /100</span></div>
      ) : (
        <div className="rg-val dim">—</div>
      )}
      <p className="rg-basis">{score?.basis}</p>
      {values.length >= 3 && (
        <div className="rg-spark"><Sparkline values={values} /></div>
      )}
    </div>
  );
}

export default function RegimeApp() {
  const { regime, history, status } = useRegime();

  const verdictCls = regime?.verdict?.cls || "unknown";
  const divergence = regime?.divergence || [];

  return (
    <>
      <SiteHeader active="regime" subtitle="Bức tranh thị trường · Regime Engine">
        <span className="pill">
          {status === "ready" ? `Cập nhật ${regime?.date || ""}` : status === "error" ? "Chưa có dữ liệu" : "Đang tải…"}
        </span>
      </SiteHeader>

      <main className="wrap">
        <div className="page-hd">
          <div>
            <h2>Bức tranh thị trường</h2>
            <p>Tổng hợp Thanh khoản · Định vị vốn · Động lượng ngành · Bối cảnh vĩ mô thành 1 verdict duy nhất — 5 trang còn lại là chi tiết bên dưới.</p>
          </div>
        </div>

        {status === "loading" && (
          <section className="panel" style={{ marginTop: 16, padding: "40px 0" }}>
            <p style={{ textAlign: "center", color: "var(--dim)", fontSize: 13, margin: 0 }}>Đang tải…</p>
          </section>
        )}

        {status === "error" && (
          <section className="panel" style={{ marginTop: 16, padding: "40px 0" }}>
            <p style={{ textAlign: "center", color: "var(--dim)", fontSize: 13, margin: 0 }}>
              Chưa có <code>data/regime.json</code> — chạy <code>automation/vn_regime/compute_regime.py</code> để tạo dữ liệu.
            </p>
          </section>
        )}

        {regime && (
          <>
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="p-body">
                <div className={`rg-banner ${verdictCls}`}>
                  <img className="rg-icon" src={VERDICT_MASCOT[verdictCls] || VERDICT_MASCOT.unknown} alt="" />
                  <div className="rg-text">
                    <p className="rg-title">{regime.verdict?.label}</p>
                    <p className="rg-summary">{regime.verdict?.summary}</p>
                  </div>
                </div>

                <div className="rg-scores">
                  {["liquidity", "positioning", "momentum", "macro"].map((id) => (
                    <ScoreCard key={id} id={id} score={regime.scores?.[id]} history={history} />
                  ))}
                </div>

                {regime.marketStats?.realizedVol20d != null && (
                  <div className="rg-marketstat">
                    <span className="k">📉 Biến động thực hiện VN-Index</span>
                    <span className="v">{regime.marketStats.realizedVol20d.toFixed(1)}%/năm</span>
                    <span className="note">{regime.marketStats.basis}</span>
                  </div>
                )}

                {divergence.length > 0 ? (
                  <div className="rg-divergence">
                    {divergence.map((d, i) => (
                      <div className="rg-div-item" key={i}>
                        <span className="rg-div-icon">⚠</span>
                        <div>
                          <span className="rg-div-pair">
                            {SCORE_META[d.pair[0]]?.name} ↔ {SCORE_META[d.pair[1]]?.name}
                          </span>
                          {d.note}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rg-div-empty"><span className="dot" />Không phát hiện tín hiệu lệch pha giữa các điểm số ở kỳ này.</div>
                )}

                <p className="rg-quality">
                  {regime.dataQuality?.note}
                  {" "}Phiên {regime.date} · sinh lúc {regime.generatedAtIct} ICT.
                  {/* `date` là NGÀY PHIÊN; `generatedAtIct` là giờ chạy script.
                      Trước đây chỉ in giờ chạy, nên khi pipeline vnstock đỏ từ
                      25/09/2026 trang vẫn trông bình thường suốt 5 ngày. */}
                  <StaleTag asof={regime.date} />
                </p>
              </div>
            </section>

            <section className="panel" style={{ marginTop: 16 }}>
              <div className="p-hd">
                <h2>Xem chi tiết</h2>
                <span className="sub">Từng điểm số ở trên tổng hợp lại từ các trang này</span>
              </div>
              <div className="p-body">
                <div className="rg-links">
                  {DRILL_DOWN.map((l) => (
                    <a className="rg-link" href={l.href} key={l.href}>
                      <span className="rg-link-name">{l.name}<ArrowIcon /></span>
                      <span className="rg-link-desc">{l.desc}</span>
                    </a>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        <Footer>
          Bức tranh thị trường · Verdict tổng hợp tự động, không phải khuyến nghị đầu tư.
          Công thức Positioning/Macro Score hiện là ước lượng ban đầu (v1), chưa hiệu chỉnh bằng dữ liệu lịch sử thật —
          xem <code>automation/vn_regime/README.md</code> để biết giới hạn cụ thể.
        </Footer>
      </main>
    </>
  );
}
