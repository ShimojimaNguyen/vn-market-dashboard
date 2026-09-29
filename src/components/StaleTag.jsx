import { freshness } from "../lib/freshness.js";

/**
 * Nhãn độ tươi cho trang React. Bản DOM cho trang khuôn B là
 * `attachStaleTag()` trong `src/lib/freshness.js` — **cùng một** `freshness()`,
 * chỉ khác cách gắn vào cây. Đừng viết cách tính thứ hai ở đây.
 *
 * Không render gì khi dữ liệu còn tươi: một nhãn hiện suốt ngày là một nhãn
 * không ai đọc nữa.
 *
 * Style `.stale-tag` nằm ở `src/styles/layout.css` (dùng chung), không ở CSS
 * của từng trang — `.dtag` từng bị khai hai nơi và trang chỉ import style
 * chung thì nhãn ra không có style.
 *
 * @param {{asof: string|null|undefined}} props
 *   `asof` là NGÀY PHIÊN của dữ liệu (YYYY-MM-DD), không phải giờ sinh file.
 */
export function StaleTag({ asof }) {
  const f = freshness(asof);
  if (f.level === "fresh") return null;
  return (
    <span
      className={"stale-tag " + f.cls}
      title={
        "Tính theo số phiên (T2–T6) kể từ ngày phiên của dữ liệu. "
        + "Không trừ ngày nghỉ lễ, nên kỳ nghỉ dài có thể bị báo chậm."
      }
    >
      {f.label}
    </span>
  );
}
