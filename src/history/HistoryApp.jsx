import { useEffect, useRef } from "react";
import SiteHeader from "../components/layout/SiteHeader.jsx";
import Footer from "../components/layout/Footer.jsx";
import { useHistory } from "../hooks/useHistory.js";
import { initHistory } from "./historyEngine.js";
import "../styles/tokens.css";
import "../styles/layout.css";
import "./history.css";
import { StaleTag } from "../components/StaleTag.jsx";

export default function HistoryApp() {
  const { rows, events, status } = useHistory();
  const initedRef = useRef(false);

  useEffect(() => {
    if (status !== "ready" || initedRef.current) return;
    initedRef.current = true;
    initHistory(rows, events);
  }, [status, rows, events]);

  const hasData = rows && rows.length > 0;

  /* Chuỗi JSONL không mang generatedAtIct, nên mốc "as of" đúng của trang này
     là phiên mới nhất thực sự có trong dữ liệu (CLAUDE.md §1.4 — số nào lên UI
     cũng phải nói rõ tính đến bao giờ). Không suy ra từ "hôm nay". */
  const lastDate = hasData ? rows[rows.length - 1].date : null;
  const dmy = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  };

  return (
    <>
      <SiteHeader active="history" subtitle="Lịch sử giá · lợi suất · sự kiện vĩ mô">
        <span className="pill">{hasData ? `${rows.length} phiên trong lịch sử` : "Đang tải…"}</span>
        <span className="pill">
          {dmy(lastDate) ? `Đến phiên ${dmy(lastDate)}` : "Đến phiên —"}
          {/* Lịch sử đứng im nghĩa là pipeline ngừng nối thêm phiên — nhìn một
              ngày tháng trong quá khứ thì không thấy điều đó. */}
          <StaleTag asof={lastDate} />
        </span>
      </SiteHeader>

      <main className="wrap">
        <div className="page-hd">
          <div>
            <h2>Lịch sử &amp; Tương quan</h2>
            <p>Đối chiếu VN-Index, lợi suất trái phiếu Mỹ–Việt, DXY, margin, USD/VND với các sự kiện vĩ mô theo thời gian</p>
          </div>
        </div>


        <section className="panel" style={{ marginTop: 20 }}>
          <div className="p-hd">
            <h2>Biểu đồ chồng lớp (chỉ số hoá base=100)</h2>
            <span className="sub">Bật/tắt chuỗi ở chú giải · di chuột để xem giá trị theo ngày</span>
            <div className="right">
              <div className="seg" id="histRangeSeg">
                <button data-r="3T" aria-pressed="false">3T</button>
                <button data-r="6T" aria-pressed="false">6T</button>
                <button data-r="1N" aria-pressed="true">1N</button>
                <button data-r="all" aria-pressed="false">Tối đa</button>
              </div>
            </div>
          </div>
          <div className="legend" id="seriesLegend" />
          <div className="p-body tight">
            <div className="chart" id="historyChart" />
          </div>
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <div className="p-hd">
            <h2>Bảng tương quan</h2>
            <span className="sub">Pearson trên thay đổi ngày-qua-ngày của các chuỗi đang bật</span>
          </div>
          <div className="p-body" id="corrTable" />
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <div className="p-hd">
            <h2>Sự kiện vĩ mô</h2>
            <span className="sub">Đánh dấu trên biểu đồ phía trên</span>
            <div className="right">
              <div className="seg" id="eventCatSeg">
                <button data-c="all" aria-pressed="true">Tất cả</button>
                <button data-c="fed" aria-pressed="false">Fed</button>
                <button data-c="us-macro" aria-pressed="false">Vĩ mô Mỹ</button>
                <button data-c="vn-macro" aria-pressed="false">Vĩ mô VN</button>
                <button data-c="geopolitical" aria-pressed="false">Địa chính trị</button>
              </div>
            </div>
          </div>
          <div className="p-body" id="eventsList" />
        </section>

        <Footer>
          Lịch sử &amp; Tương quan · Dữ liệu tham khảo, không phải khuyến nghị đầu tư.
          Tương quan thống kê không hàm ý quan hệ nhân quả.
          Nguồn: chuỗi lịch sử do <code>automation/daily_update.py</code> ghi hằng ngày
          (Yahoo Finance, US Treasury), sự kiện vĩ mô từ <code>public/data/events.json</code>.
        </Footer>
      </main>
    </>
  );
}
