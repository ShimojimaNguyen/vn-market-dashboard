/* Độ tươi của dữ liệu: biến "as of 11/09" thành "cũ 6 ngày làm việc".
 *
 * VÌ SAO CẦN: as-of trung thực vẫn chưa đủ. Nếu pipeline chết, trang tiếp tục
 * hiển thị số đúng của phiên cuối cùng lấy được, kèm as-of đúng của phiên đó —
 * không có gì sai, và cũng không có gì báo động. Người xem liếc qua không phân
 * biệt được dữ liệu của hôm qua với dữ liệu của ba tuần trước; cả hai đều là
 * một ngày tháng trông bình thường.
 *
 * Đây là cách một hệ thống "đúng" trở thành sai trên thực tế, nên độ tươi phải
 * được tính ra và nói thành lời, không để người đọc tự trừ ngày.
 *
 * ĐẾM THEO NGÀY LÀM VIỆC, không theo ngày lịch: dữ liệu thứ Sáu xem vào sáng
 * thứ Hai là bình thường (0 phiên trễ) dù đã 3 ngày lịch. Đếm ngày lịch sẽ báo
 * động mỗi cuối tuần và người dùng sẽ học cách phớt lờ cảnh báo.
 *
 * KHÔNG biết ngày nghỉ lễ. Nghỉ lễ dài sẽ bị tính là trễ — chấp nhận: thà cảnh
 * báo thừa vài ngày trong năm còn hơn im lặng khi hỏng thật. Ngưỡng 3 phiên đủ
 * rộng để hầu hết kỳ nghỉ không chạm tới.
 */

const LEVELS = {
  fresh: { level: "fresh", cls: "ok" },
  lagging: { level: "lagging", cls: "warn" },
  stale: { level: "stale", cls: "danger" },
};

/** Số ngày làm việc (T2–T6) trôi qua giữa hai ngày, không tính ngày đầu. */
export function tradingDaysBetween(fromISO, toDate = new Date()) {
  const from = new Date(fromISO + "T00:00:00");
  if (Number.isNaN(from.getTime())) return null;
  const to = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  let n = 0;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (d < to) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

/**
 * @param {string} asofISO  ngày phiên của dữ liệu, dạng YYYY-MM-DD
 * @returns {{days:number|null, level:string, cls:string, label:string}}
 *   days = số phiên trễ. null nghĩa là không có as-of — tệ hơn cũ, vì không
 *   biết cũ bao nhiêu.
 */
export function freshness(asofISO, now = new Date()) {
  if (!asofISO) {
    return { days: null, ...LEVELS.stale, label: "không rõ thời điểm dữ liệu" };
  }
  const days = tradingDaysBetween(asofISO, now);
  if (days === null) {
    return { days: null, ...LEVELS.stale, label: "as-of không đọc được" };
  }
  if (days <= 1) return { days, ...LEVELS.fresh, label: "mới nhất" };
  if (days <= 3) return { days, ...LEVELS.lagging, label: `chậm ${days} phiên` };
  return { days, ...LEVELS.stale, label: `CŨ ${days} phiên — pipeline có thể đã dừng` };
}

const TITLE =
  "Tính theo số phiên (T2–T6) kể từ ngày phiên của dữ liệu. "
  + "Không trừ ngày nghỉ lễ, nên kỳ nghỉ dài có thể bị báo chậm.";

/**
 * Gắn nhãn độ tươi vào một phần tử DOM. Dùng cho các trang khuôn B (engine).
 * Trang React dùng <StaleTag> trong components/StaleTag.jsx — cùng một
 * `freshness()`, chỉ khác cách gắn vào cây.
 *
 * VÌ SAO LÀ HÀM DÙNG CHUNG: bản đầu chỉ `dashboardEngine.js` có đoạn này, và
 * 1/7 trang biết tự báo cũ. Ngày 2026-09-29, ba trang (regime, cashout,
 * sector-flows) phục vụ số liệu 5 ngày tuổi vì pipeline vnstock đỏ từ 25/09 —
 * cả ba đều in đúng dấu thời gian và không trang nào nói nó đã cũ. Chép đoạn
 * này ra sáu chỗ sẽ lại lệch nhau, nên nó ở đây.
 *
 * Không làm gì khi dữ liệu còn tươi: một nhãn hiện suốt ngày là một nhãn
 * không ai đọc nữa.
 *
 * @param {Element|null} host  nơi chèn nhãn vào cuối
 * @param {string|null|undefined} asofISO  ngày phiên của dữ liệu (YYYY-MM-DD)
 * @returns {boolean} đã gắn nhãn hay chưa
 */
export function attachStaleTag(host, asofISO) {
  if (!host) return false;
  // Idempotent: gỡ nhãn cũ trước. `setAsof()` của trang Thế giới được gọi
  // nhiều lần (tải xong, lỗi mạng, render lại) — không gỡ thì mỗi lần gọi
  // dán thêm một nhãn nữa và người đọc thấy ba chữ "CŨ 5 phiên" xếp hàng.
  host.querySelectorAll(":scope > .stale-tag").forEach((n) => n.remove());
  const f = freshness(asofISO);
  if (f.level === "fresh") return false;
  const tag = document.createElement("span");
  tag.className = "stale-tag " + f.cls;
  tag.textContent = f.label;
  tag.title = TITLE;
  host.appendChild(tag);
  return true;
}

/** Ngày phiên từ một dấu thời gian ISO có giờ. `null` nếu không đọc được. */
export function dateOfIso(iso) {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : null;
}
