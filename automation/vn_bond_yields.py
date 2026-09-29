"""Lợi suất trái phiếu Chính phủ VN — từ kết quả đấu thầu HNX.

Chạy:    py automation/vn_bond_yields.py
         py automation/vn_bond_yields.py --print   (chỉ in, không ghi file)

VÌ SAO TỰ LẤY: `live.json` có field `vnYields` từ đầu nhưng `quality.vnYields`
là "missing" ở 161/170 phiên và CHƯA MỘT LẦN "live" — không có API miễn phí nào
cho đường cong lợi suất TPCP Việt Nam. Đã dò và loại:

  - VNDirect finfo (nguồn đang dùng cho breadth): `bonds` chỉ có trái phiếu
    doanh nghiệp; `stock_prices` không có type trái phiếu (chỉ STOCK/ETF/IFC)
  - vnstock: không có module trái phiếu/lãi suất
  - SSI iBoard: chỉ 6 mã HĐTL TPCP, không có đường cong
  - TCBS: 403
  - FireAnt restv2: 401, cần bearer token của tài khoản
  - VBMA (chuẩn ngành, có đúng đường cong): nằm sau Cloudflare challenge +
    CSRF Laravel. Lấy được thì phải mô phỏng challenge, tức né bot protection
    — KHÔNG làm, và cũng quá mong manh cho một job chạy tự động hằng ngày.

HNX là nơi TPCP thực sự niêm yết và đấu thầu, không có robots.txt (trả 404 =
không tuyên bố hạn chế), và công bố công khai kết quả từng đợt đấu thầu của Kho
bạc Nhà nước.

ĐÂY LÀ LỢI SUẤT SƠ CẤP, KHÔNG PHẢI ĐƯỜNG CONG THỨ CẤP HẰNG NGÀY. Lãi suất trúng
thầu là giá vốn Kho bạc Nhà nước thực sự vay được ở phiên đấu thầu đó — một mốc
thật, nhưng chỉ đổi vào ngày có đấu thầu (thường vài lần/tháng), không phải mỗi
phiên giao dịch. Vì thế quality = "proxy", và mỗi kỳ hạn mang NGÀY RIÊNG của nó.

CẠM BẪY CHÍNH — ĐẤU THẦU TRƯỢT: khi không ai trúng thầu, bảng vẫn có dòng đó
nhưng "GT trúng thầu" = 0 và "Lãi suất trúng thầu" hiện 0 hoặc rỗng. Đọc thẳng
sẽ ra "lợi suất 30 năm = 0%". Phiên 10/09/2026 có 3/5 kỳ hạn trượt đúng như vậy.
Nên chỉ nhận dòng có GT trúng thầu > 0 VÀ lãi suất > 0.

VÌ SAO TÍCH LUỸ: endpoint chỉ trả 10 dòng gần nhất và không nhận tham số phân
trang nào (đã thử p_pageIndex/pageIndex/p_currentpage/p_recordonpage/
txtFromDate — tất cả trả về đúng 10 dòng đó). 10 dòng ≈ 2 đợt đấu thầu × 5 kỳ
hạn, mà mỗi đợt thường chỉ 1–2 kỳ hạn trúng, nên một lần chạy không đủ phủ hết
đường cong. Vì thế mỗi lần chạy ghi thêm vào `public/data/vn-bond-auctions.jsonl`
(khoá theo mã đợt đấu thầu, chạy lại cùng ngày không tạo dòng trùng), rồi dựng
đường cong từ toàn bộ lịch sử đã tích luỹ.

CHỨNG CHỈ: www.hnx.vn KHÔNG gửi kèm cert trung gian trong TLS handshake, nên
Python stdlib không dựng được chuỗi và mọi kết nối thất bại. Cert trung gian
được đóng gói ở automation/certs/ và nạp thêm vào kho tin cậy — verify vẫn ĐẦY
ĐỦ, không dùng CERT_NONE. Xem file .pem đó để biết cách xác minh và hạn dùng.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

# Console Windows ở máy dev là cp932, còn log của script này có tiếng Việt/
# tiếng Nhật. Không ép UTF-8 thì `print` ném UnicodeEncodeError và SCRIPT CHẾT
# GIỮA CHỪNG — ở đúng dòng log, không phải ở chỗ lấy dữ liệu.
#
# CI chạy Linux/UTF-8 nên chuyện này không bao giờ xảy ra ở đó. Nghĩa là nó chỉ
# cắn khi phải chạy tay tại máy — tức đúng lúc CI đang hỏng và cần chạy tay.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERT = os.path.join(ROOT, "automation", "certs", "hnx-globalsign-intermediate.pem")
STORE = os.path.join(ROOT, "public", "data", "vn-bond-auctions.jsonl")

URL = "https://www.hnx.vn/ModuleReportBonds/Bond_DauThau/Bond_KetQua_DauThau_Default"
REFERER = "https://www.hnx.vn/vi-vn/trai-phieu/ket-qua-dau-thau.html"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")

# Chỉ số cột trong bảng HNX. Bảng có 21 cột; giữ tên tiếng Việt nguyên văn của
# HNX ở comment để đối chiếu được khi trang đổi bố cục.
C_DOT = 1        # Đợt đấu thầu (PH.156.2026) — khoá idempotent
C_MA = 2         # Mã trái phiếu
C_TCPH = 3       # Tên TCPH (phải là "Kho bạc Nhà nước")
C_KYHAN = 5      # Kỳ hạn ("10 Năm")
C_NGAY_PH = 7    # Ngày phát hành
C_GT_TRUNG = 11  # GT trúng thầu  (0 = đấu thầu trượt)
C_LS_TRUNG = 18  # Lãi suất trúng thầu (%/Năm)
N_COLS = 19      # số cột tối thiểu để coi là dòng dữ liệu

ICT = timezone(timedelta(hours=7))


def log(msg: str) -> None:
    print(f"[vn_bond_yields] {msg}", flush=True)


def _ctx() -> ssl.SSLContext:
    """Kho tin cậy hệ thống CỘNG cert trung gian của HNX. Không tắt verify."""
    ctx = ssl.create_default_context()
    if os.path.exists(CERT):
        ctx.load_verify_locations(cafile=CERT)
    else:
        log(f"CẢNH BÁO: không thấy {CERT} — kết nối HNX nhiều khả năng sẽ hỏng")
    return ctx


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def _num(s: str) -> float | None:
    """'4,43' -> 4.43 ; '8.000.000.000.000' -> 8e12 ; '' -> None.

    HNX dùng '.' làm phân cách nghìn và ',' làm dấu thập phân (quy ước VN).
    """
    s = (s or "").strip()
    if not s:
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def fetch_rows(timeout: int = 25) -> list[dict]:
    """10 đợt đấu thầu gần nhất, chỉ giữ đợt THỰC SỰ có người trúng thầu."""
    req = urllib.request.Request(
        URL, data=b"p_keysearch=&p_pageIndex=1",
        headers={"User-Agent": UA, "Referer": REFERER,
                 "X-Requested-With": "XMLHttpRequest",
                 "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
    )
    raw = urllib.request.urlopen(req, timeout=timeout, context=_ctx()).read()
    page = raw.decode("utf-8", "replace")

    tbl = re.search(r'<table id="_tableDatas".*?</table>', page, re.S)
    if not tbl:
        raise RuntimeError("không thấy bảng _tableDatas — HNX đã đổi bố cục trang")

    out, seen, skipped = [], 0, 0
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tbl.group(0), re.S):
        c = [_text(x) for x in re.findall(r"<td[^>]*>.*?</td>", tr, re.S)]
        if len(c) < N_COLS:
            continue
        seen += 1
        won = _num(c[C_GT_TRUNG]) or 0
        y = _num(c[C_LS_TRUNG])
        # Đấu thầu trượt: dòng vẫn tồn tại, GT trúng thầu = 0, lãi suất 0/rỗng.
        # Nhận nó là ghi "lợi suất kỳ hạn này = 0%".
        if won <= 0 or not y or y <= 0:
            skipped += 1
            continue
        m = re.match(r"(\d+)\s*Năm", c[C_KYHAN])
        if not m:
            skipped += 1
            continue
        d = re.match(r"(\d{2})/(\d{2})/(\d{4})", c[C_NGAY_PH])
        out.append({
            "auction": c[C_DOT],
            "bond": c[C_MA],
            "issuer": c[C_TCPH],
            "tenor_years": int(m.group(1)),
            "issue_date": f"{d.group(3)}-{d.group(2)}-{d.group(1)}" if d else None,
            "won_vnd": won,
            "yield_pct": y,
        })
    log(f"HNX trả {seen} dòng, {len(out)} đợt có người trúng thầu, bỏ {skipped} đợt trượt/không đọc được")
    return out


def load_store() -> dict[str, dict]:
    if not os.path.exists(STORE):
        return {}
    rows = {}
    with open(STORE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            if r.get("auction"):
                rows[r["auction"]] = r
    return rows


def write_store(rows: dict[str, dict]) -> None:
    """Ghi lại toàn bộ, sắp theo ngày phát hành. Idempotent theo mã đợt."""
    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    ordered = sorted(rows.values(), key=lambda r: (r.get("issue_date") or "", r["auction"]))
    with open(STORE, "w", encoding="utf-8", newline="\n") as f:
        for r in ordered:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def curve(rows: dict[str, dict]) -> list[dict]:
    """Đợt đấu thầu thành công GẦN NHẤT cho mỗi kỳ hạn, kèm ngày riêng.

    `d` = chênh lệch so với đợt trúng thầu LIỀN TRƯỚC của CHÍNH kỳ hạn đó, tính
    bằng điểm phần trăm. Không phải "thay đổi trong ngày" như bảng lợi suất Mỹ —
    hai đợt đấu thầu có thể cách nhau vài tuần, nên trường `d_from` nói rõ mốc so
    sánh thay vì để người đọc tưởng là biến động phiên.
    """
    by_tenor: dict[int, list[dict]] = {}
    for r in rows.values():
        by_tenor.setdefault(r["tenor_years"], []).append(r)
    out = []
    for tenor, rs in sorted(by_tenor.items()):
        rs.sort(key=lambda r: (r.get("issue_date") or "", r["auction"]))
        last = rs[-1]
        prev = rs[-2] if len(rs) > 1 else None
        out.append({
            "t": f"{tenor} năm",
            "x": tenor,
            "y": round(last["yield_pct"], 2),
            "d": round(last["yield_pct"] - prev["yield_pct"], 2) if prev else None,
            "d_from": prev["issue_date"] if prev else None,
            "m": None,
            "yr": None,
            "est": False,
            "asof": last["issue_date"],
            "auction": last["auction"],
            "bond": last["bond"],
        })
    return out


def fetch_vn_yields(prev: dict | None = None) -> tuple[list[dict] | None, str]:
    """(rows, quality) để daily_update.py gắn thẳng vào live.json.

    quality = "proxy": đây là lợi suất trúng thầu SƠ CẤP, không phải đường cong
    thứ cấp hằng ngày — đúng nghĩa "ước tính hợp lý" theo 3 mức của CLAUDE.md
    §1.4, và không bao giờ là "live".
    """
    prev = prev or {}
    try:
        fresh = fetch_rows()
    except Exception as e:  # noqa: BLE001
        log(f"fetch hỏng ({e!r}) — giữ số cũ")
        old = prev.get("vnYields")
        return old, ("stale" if old else "missing")

    store = load_store()
    added = [r["auction"] for r in fresh if r["auction"] not in store]
    for r in fresh:
        store[r["auction"]] = r          # upsert theo mã đợt
    write_store(store)
    log(f"kho đấu thầu: {len(store)} đợt ({len(added)} mới: {', '.join(added) or 'không có'})")

    rows = curve(store)
    if not rows:
        return prev.get("vnYields"), ("stale" if prev.get("vnYields") else "missing")
    for r in rows:
        log(f"  {r['t']:8} {r['y']:>5.2f}%  (đợt {r['auction']}, phát hành {r['asof']})")
    return rows, "proxy"


def main() -> int:
    ap = argparse.ArgumentParser(description="Lợi suất TPCP từ đấu thầu HNX")
    ap.add_argument("--print", action="store_true", help="chỉ in, không ghi kho")
    a = ap.parse_args()

    if a.print:
        for r in curve({x["auction"]: x for x in fetch_rows()}):
            print(json.dumps(r, ensure_ascii=False))
        return 0

    rows, quality = fetch_vn_yields()
    log(f"quality={quality}, {len(rows or [])} kỳ hạn")
    log(f"kho: {STORE}")
    return 0 if rows else 1


if __name__ == "__main__":
    sys.exit(main())
