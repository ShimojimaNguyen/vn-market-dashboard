#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cập nhật dữ liệu thị trường tự động (free sources) → public/data/live.json
Chạy local:  py automation/daily_update.py
Chạy CI:     GitHub Actions schedule (sau phiên VN + sáng ICT)
"""
from __future__ import annotations

import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

# Windows console mặc định dùng codepage cp932/1252 (không phải UTF-8), nên các
# dòng log tiếng Việt có dấu sẽ crash UnicodeEncodeError khi chạy trực tiếp
# (python automation/daily_update.py) trên máy Windows — ép stdout/stderr sang
# UTF-8 để an toàn ở mọi môi trường (GitHub Actions ubuntu vốn đã UTF-8 nên
# không đổi hành vi ở đó).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
LIVE_JSON = DATA / "live.json"
META_JSON = DATA / "last-run.json"
GROK_FILL = DATA / "grok-fill.json"
HISTORY_DIR = DATA / "history"
HISTORY_INDEX = HISTORY_DIR / "index.json"
HISTORY_QUALITY_FIELDS = (
    "vnIndex", "usYields", "vnYields", "dxy", "fgUs",
    "margin", "breadth", "usdVnd", "foreign",
)
NEWS_RAW_JSON = DATA / "news-raw.json"
# news.json KHÔNG có hằng số ở đây, và đó là chủ đích: script này chỉ ghi
# news-raw.json. Bước chọn lọc/biên tập sang news.json do người hoặc agent
# `vn-news-tagger` làm. Một hằng số trỏ tới file mà script không bao giờ ghi
# khiến người đọc tưởng đây là output tự động — đã mất một lượt truy vì nó.
WORLD_LIVE_JSON = DATA / "world-live.json"
# Mã Yahoo Finance cho các thị trường trong src/data/worldInstruments.js (trang
# Thế giới). Chỉ những mã đã có số tĩnh (v khác null) mới liệt kê ở đây — các
# mã còn lại (nhiều cặp FX chéo, hàng hoá phụ, VCB retail rates) đã ghi rõ
# "chưa live" trong worldInstruments.js và không có nguồn Yahoo đáng tin, giữ
# nguyên số tĩnh thay vì cố fetch rồi fail âm thầm.
WORLD_SYMBOLS = {
    "VNINDEX": "^VNINDEX.VN",
    "N225": "^N225", "HSI": "^HSI", "SSEC": "000001.SS", "SZI": "399001.SZ",
    "KS11": "^KS11", "TWII": "^TWII", "STI": "^STI", "JKSE": "^JKSE",
    "KLSE": "^KLSE", "SENSEX": "^BSESN", "AXJO": "^AXJO", "NZ50": "^NZ50",
    "SPX": "^GSPC", "IXIC": "^IXIC", "DJI": "^DJI", "VIX": "^VIX", "RUT": "^RUT",
    "GDAXI": "^GDAXI", "SX5E": "^STOXX50E", "FTSE": "^FTSE", "FCHI": "^FCHI",
    "BFX": "^BFX", "GSPTSE": "^GSPTSE", "BVSP": "^BVSP",
    "DXY": "DX-Y.NYB", "USDVND": "VND=X", "USDJPY": "USDJPY=X",
    "WTI": "CL=F", "GOLD": "GC=F",
    "BTC": "BTC-USD",
}
# Nguồn RSS miễn phí, chính chủ — không cần API key. Mỗi feed gắn category để
# agent tổng hợp tin (xem automation/agent_daily_prompt.md) biết cách gắn nhãn.
# maxAgeDays/maxItems áp riêng từng feed — Fed chỉ ra tin vài lần/tháng nên cần
# cửa sổ dài hơn nhiều so với báo VN (ra hàng chục tin/ngày), nếu dùng chung
# một ngưỡng thì tin Fed luôn bị tin VN lấn át hoàn toàn khỏi top theo ngày.
NEWS_FEEDS = (
    ("vn-macro", "VnEconomy — Chứng khoán", "https://vneconomy.vn/chung-khoan.rss", 4, 8),
    ("vn-macro", "VnEconomy — Tiêu điểm", "https://vneconomy.vn/tieu-diem.rss", 4, 6),
    ("fed", "Federal Reserve — Monetary Policy", "https://www.federalreserve.gov/feeds/press_monetary.xml", 30, 4),
    ("us-macro", "Federal Reserve — All Press Releases", "https://www.federalreserve.gov/feeds/press_all.xml", 30, 4),
)

ICT = timezone(timedelta(hours=7))
UA = "vn-market-dashboard-bot/1.0 (non-profit research; +https://github.com/Tarzanjp/vn-market-dashboard)"
CTX = ssl.create_default_context()
XAI_API = os.environ.get("XAI_API_BASE", "https://api.x.ai/v1").rstrip("/")
XAI_MODEL = os.environ.get("XAI_MODEL", "grok-3-latest")


# Lợi suất TPCP tách thành module riêng: nó cần một SSL context đặc biệt
# (HNX không gửi cert trung gian) và một kho tích luỹ đợt đấu thầu, quá
# nhiều thứ riêng để nhét vào file này.
from vn_bond_yields import fetch_vn_yields  # noqa: E402


def now_ict() -> datetime:
    return datetime.now(ICT)


def log(msg: str) -> None:
    print(f"[daily_update] {msg}", flush=True)


def http_get(url: str, timeout: int = 25) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read()


def http_get_json(url: str, timeout: int = 25):
    return json.loads(http_get(url, timeout).decode("utf-8", "replace"))


def load_previous() -> dict:
    if LIVE_JSON.exists():
        try:
            return json.loads(LIVE_JSON.read_text(encoding="utf-8"))
        except Exception as e:
            log(f"previous snapshot read fail: {e}")
    return {}


def fetch_us_treasury_yields(prev: dict) -> tuple[list | None, str]:
    """Daily Treasury yield curve (public CSV)."""
    import csv
    import io

    year = now_ict().year

    def parse_date(s: str):
        s = (s or "").strip().strip('"')
        for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                pass
        return None

    for y in (year, year - 1):
        url = (
            "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
            f"daily-treasury-rates.csv/{y}/all?"
            f"type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv"
        )
        try:
            text = http_get(url, timeout=30).decode("utf-8", "replace")
            reader = csv.DictReader(io.StringIO(text))
            rows = [r for r in reader if r]
            if not rows:
                continue

            def row_date(r):
                return parse_date(r.get("Date") or r.get("date") or next(iter(r.values()), ""))

            rows = [r for r in rows if row_date(r)]
            rows.sort(key=lambda r: row_date(r))
            last, prev_row = rows[-1], rows[-2] if len(rows) > 1 else None

            def get_y(row, keys):
                if not row:
                    return None
                for k in keys:
                    for hk, hv in row.items():
                        if hk and hk.strip().lower() == k.lower() and hv not in (None, "", "N/A"):
                            try:
                                return float(str(hv).replace("%", "").strip())
                            except ValueError:
                                pass
                return None

            out = []
            for keys, label, x, est in [
                (["1 Yr", "1 Year"], "1 năm", 1, True),
                (["3 Yr", "3 Year"], "3 năm", 3, False),
                (["5 Yr", "5 Year"], "5 năm", 5, False),
                (["10 Yr", "10 Year"], "10 năm", 10, False),
                (["30 Yr", "30 Year"], "30 năm", 30, False),
            ]:
                yv = get_y(last, keys)
                if yv is None:
                    continue
                y_prev = get_y(prev_row, keys)
                d = round(yv - y_prev, 2) if y_prev is not None else None
                # m (tháng)/yr (năm): CHƯA có nguồn tính (cần lịch sử dài hơi qua
                # history/*.jsonl) — để None thay vì 0.0, để UI hiển thị "—" đúng
                # luật CLAUDE.md §1.4 thay vì "+0,00" giả (trông như không đổi).
                out.append(
                    {"t": label, "y": round(yv, 2), "d": d, "m": None, "yr": None, "x": x, "est": est}
                )
            if len(out) >= 4:
                asof = row_date(last)
                asof_s = asof.isoformat() if asof else now_ict().date().isoformat()
                log(f"US yields OK asof={asof_s} n={len(out)}")
                return out, asof_s
        except Exception as e:
            log(f"US yields year={y} fail: {e}")
    return prev.get("usYields"), prev.get("usYieldsAsof") or ""


def fetch_fg_us(prev: dict) -> tuple[dict | None, str]:
    url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
    try:
        # CNN đôi khi chặn bot — thử header giống browser
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json,text/plain,*/*",
                "Referer": "https://edition.cnn.com/markets/fear-and-greed",
                "Origin": "https://edition.cnn.com",
            },
        )
        with urllib.request.urlopen(req, timeout=20, context=CTX) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
        # structure varies; try common paths
        score = None
        hist = {}
        if isinstance(data, dict):
            fg = data.get("fear_and_greed") or data.get("fearAndGreed") or data
            if isinstance(fg, dict):
                score = fg.get("score") or fg.get("rating")
                if isinstance(score, str):
                    score = None
                # previous close fields
                hist = {
                    "prev": fg.get("previous_close") or fg.get("previousClose"),
                    "week": fg.get("previous_1_week") or fg.get("previous1Week"),
                    "month": fg.get("previous_1_month") or fg.get("previous1Month"),
                    "year": fg.get("previous_1_year") or fg.get("previous1Year"),
                }
            # alternative: data["fear_and_greed_historical"]["data"][-1]
            if score is None and "fear_and_greed_historical" in data:
                series = data["fear_and_greed_historical"].get("data") or []
                if series:
                    score = series[-1].get("y") or series[-1].get("score")
        if score is not None:
            score = round(float(score), 1)
            out = {
                "score": score,
                "hist": {
                    "prev": _num(hist.get("prev"), score),
                    "week": _num(hist.get("week"), score),
                    "month": _num(hist.get("month"), score),
                    "year": _num(hist.get("year"), score),
                },
                "asofEt": now_ict().strftime("%Y-%m-%d"),
            }
            log(f"F&G US OK score={score}")
            return out, now_ict().isoformat()
    except Exception as e:
        log(f"F&G US fail: {e}")
    return prev.get("fgUs"), prev.get("fgUsFetchedAt") or ""


def _num(v, fallback):
    try:
        if v is None:
            return fallback
        return round(float(v), 1)
    except (TypeError, ValueError):
        return fallback


def fetch_yahoo_quote(symbol: str) -> dict | None:
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib_parse_quote(symbol)}"
        f"?interval=1d&range=5d"
    )
    try:
        data = http_get_json(url, timeout=20)
        res = data["chart"]["result"][0]
        meta = res.get("meta") or {}
        closes = (res.get("indicators") or {}).get("quote", [{}])[0].get("close") or []
        ts = res.get("timestamp") or []
        # last non-null close
        price = meta.get("regularMarketPrice")
        prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
        if price is None:
            for c in reversed(closes):
                if c is not None:
                    price = c
                    break
        if price is None:
            return None
        price = float(price)
        prev = float(prev_close) if prev_close is not None else None
        chg = price - prev if prev else 0.0
        pct = (chg / prev * 100) if prev else 0.0
        trade_date = None
        if ts:
            trade_date = datetime.fromtimestamp(ts[-1], tz=timezone.utc).date().isoformat()
        return {
            "symbol": symbol,
            "price": round(price, 2),
            "prev": round(prev, 2) if prev else None,
            "chg": round(chg, 2),
            "pct": round(pct, 2),
            "date": trade_date or now_ict().date().isoformat(),
        }
    except Exception as e:
        log(f"Yahoo {symbol} fail: {e}")
        return None


def urllib_parse_quote(s: str) -> str:
    from urllib.parse import quote

    return quote(s, safe="")


def fetch_vn_index(prev: dict) -> tuple[dict | None, str]:
    # try several symbols used by Yahoo for VN
    for sym in ("^VNINDEX.VN", "VNI.VN", "^VNINDEX"):
        q = fetch_yahoo_quote(sym)
        if q:
            log(f"VN-Index OK via {sym} = {q['price']}")
            return q, now_ict().isoformat()
    return prev.get("vnIndex"), prev.get("vnIndexFetchedAt") or ""


def fetch_dxy(prev: dict) -> tuple[float | None, str]:
    q = fetch_yahoo_quote("DX-Y.NYB")
    if q:
        log(f"DXY OK = {q['price']}")
        return q["price"], now_ict().isoformat()
    return prev.get("dxy"), prev.get("dxyFetchedAt") or ""


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", " ", s or "").strip()


def _parse_rss_items(xml_bytes: bytes, category: str, source_name: str) -> list[dict]:
    items = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        log(f"news RSS parse fail ({source_name}): {e}")
        return items
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_raw = item.findtext("pubDate") or ""
        desc = _strip_html(item.findtext("description") or "")
        if not title:
            continue
        try:
            dt = parsedate_to_datetime(pub_raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        items.append({
            "title": re.sub(r"\s+", " ", title),
            "link": link,
            "description": re.sub(r"\s+", " ", desc)[:500],
            "publishedAt": dt.astimezone(timezone.utc).isoformat(),
            "category": category,
            "source": source_name,
        })
    return items


def fetch_breadth(trade_date: str, prev: dict) -> tuple[dict | None, str]:
    """Đếm số mã tăng/giảm/tham chiếu trên HOSE từ dữ liệu từng mã.

    Trước đây field này không có nguồn free nào nên chỉ được điền qua
    grok-fill.json — và thực tế đã đứng yên từ 2026-08-07, khiến bảng 90 phiên
    trên dashboard trống hoàn toàn sau khi bỏ dữ liệu mẫu giả.

    VNDirect finfo trả về giá đóng cửa từng mã HOSE theo ngày, không cần API
    key, nên breadth được **tính** chứ không phải đi tìm một con số có sẵn:
    a/d/u là số mã change>0 / <0 / ==0, trần và sàn so với ceilingPrice /
    floorPrice, GTGD là tổng nmValue.

    Tự kiểm chứng: a + d + u phải bằng tổng số mã trả về, và số mã trả về phải
    bằng totalElements của API. Lệch một trong hai nghĩa là trang bị cắt hoặc
    dữ liệu thiếu — khi đó trả None để giữ số của phiên trước và đánh dấu
    stale, thay vì ghi một con số đếm thiếu.
    """
    url = ("https://api-finfo.vndirect.com.vn/v4/stock_prices"
           f"?q=floor:HOSE~date:{trade_date}&size=1200")
    try:
        raw = http_get(url)
        payload = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        log(f"breadth: fetch failed ({e}) — giữ số phiên trước")
        return prev.get("breadth"), "stale" if prev.get("breadth") else "missing"

    rows = payload.get("data") or []
    reported = payload.get("totalElements")
    if not rows:
        log(f"breadth: không có dữ liệu cho {trade_date} (phiên nghỉ?) — giữ số phiên trước")
        return prev.get("breadth"), "stale" if prev.get("breadth") else "missing"

    a = sum(1 for x in rows if (x.get("change") or 0) > 0)
    d = sum(1 for x in rows if (x.get("change") or 0) < 0)
    u = sum(1 for x in rows if (x.get("change") or 0) == 0)
    ceil_n = sum(1 for x in rows
                 if x.get("close") and x.get("ceilingPrice") and x["close"] >= x["ceilingPrice"])
    floor_n = sum(1 for x in rows
                  if x.get("close") and x.get("floorPrice") and x["close"] <= x["floorPrice"])
    total = len(rows)

    if a + d + u != total or (reported is not None and reported != total):
        log(f"breadth: kiểm chứng thất bại (a+d+u={a+d+u}, n={total}, "
            f"totalElements={reported}) — không ghi số đếm thiếu")
        return prev.get("breadth"), "stale" if prev.get("breadth") else "missing"

    gtgd_bn = round(sum((x.get("nmValue") or 0) for x in rows) / 1e9, 1)
    log(f"breadth OK {trade_date}: a={a} d={d} u={u} (n={total}) GTGD={gtgd_bn} tỷ")
    return {
        "date": trade_date,
        "gtgd": gtgd_bn,
        "all": {"a": a, "d": d, "u": u, "ceil": ceil_n, "floor": floor_n, "total": total},
        "source": "VNDirect finfo (đếm từ giá đóng cửa từng mã HOSE)",
    }, "live"


def fetch_foreign(trade_date: str, prev: dict) -> tuple[dict | None, str]:
    """Mua/bán/ròng của khối ngoại trên HOSE, TÍNH từ dữ liệu từng mã.

    Trước đây field này chỉ được Grok điền và đã đứng yên ở đúng -59 tỷ suốt 4
    phiên khác nhau trong lịch sử — dấu hiệu kinh điển của một con số cũ được
    mang theo. Cùng API VNDirect finfo đang dùng cho breadth (không thêm nguồn),
    endpoint `foreigns` trả buyVal/sellVal/netVal theo từng mã từng phiên, nên
    tổng thị trường được CỘNG ra chứ không đi tìm một con số có sẵn.

    HAI CẠM BẪY CỦA ENDPOINT NÀY, cả hai đều làm số phồng lên mà trông vẫn hợp lý:

      1. Response chứa cả dòng `type: "INDEX"` — đó là dòng TỔNG HỢP cấp chỉ số,
         không phải một mã. Cộng nó chung với từng mã là đếm hai lần cả thị
         trường: phiên 2026-09-11 các dòng INDEX cộng thêm -8.831 tỷ, biến ròng
         -834 tỷ thành -10.575 tỷ. Con số sai đó lớn hơn cả tổng GTGD toàn thị
         trường phiên đó (16.123 tỷ) — tức khối ngoại "mua" nhiều hơn toàn bộ
         giao dịch, điều bất khả.
      2. Chứng quyền được trả HAI LẦN, một lần `type: "EW"` và một lần `"CW"`
         (287 mã trùng ở phiên trên). Giá trị đều 0 nên vô hại hôm nay, nhưng
         không có gì bảo đảm ngày mai vẫn thế.

    Nên chỉ lấy `type == "STOCK"`.

    Tự kiểm chứng trước khi trả về: mua − bán phải bằng ròng (đẳng thức của
    chính dữ liệu), không mã nào xuất hiện hai lần, và số mã phải hợp lý so với
    quy mô HOSE. Lệch bất kỳ điều nào → trả None để giữ số phiên trước và đánh
    dấu stale, thay vì công bố một tổng cộng thiếu/thừa.

    Đây là giao dịch TOÀN PHIÊN (khớp lệnh + thoả thuận) trên RIÊNG HOSE — khác
    `cashout-vn.json: foreignNetBn`, vốn là khớp lệnh trên cả ba sàn. Hai con số
    không bằng nhau và không nên bằng nhau; `scope`/`method` dưới đây nói rõ.
    """
    url = ("https://api-finfo.vndirect.com.vn/v4/foreigns"
           f"?q=floor:HOSE~tradingDate:{trade_date}&size=1500")
    try:
        payload = json.loads(http_get(url))
    except Exception as e:  # noqa: BLE001
        log(f"foreign: fetch failed ({e}) — giữ số phiên trước")
        return prev.get("foreign"), "stale" if prev.get("foreign") else "missing"

    rows = [r for r in (payload.get("data") or []) if r.get("type") == "STOCK"]
    if not rows:
        log(f"foreign: không có dữ liệu cho {trade_date} (phiên nghỉ?) — giữ số phiên trước")
        return prev.get("foreign"), "stale" if prev.get("foreign") else "missing"

    codes = {r.get("code") for r in rows}
    buy = sum(r.get("buyVal") or 0 for r in rows)
    sell = sum(r.get("sellVal") or 0 for r in rows)
    net = sum(r.get("netVal") or 0 for r in rows)

    if len(codes) != len(rows):
        log(f"foreign: {len(rows) - len(codes)} mã trùng trong type=STOCK — không cộng số đếm hai lần")
        return prev.get("foreign"), "stale" if prev.get("foreign") else "missing"
    if abs((buy - sell) - net) > 1:            # 1 VND cho sai số dấu phẩy động
        log(f"foreign: mua-bán ({(buy - sell)/1e9:.1f} tỷ) khác ròng ({net/1e9:.1f} tỷ) — không tin tổng này")
        return prev.get("foreign"), "stale" if prev.get("foreign") else "missing"
    if len(rows) < 100:
        log(f"foreign: chỉ {len(rows)} mã trên HOSE — trang bị cắt, không ghi tổng thiếu")
        return prev.get("foreign"), "stale" if prev.get("foreign") else "missing"

    out = {
        "net": round(net / 1e9, 1),
        "buy": round(buy / 1e9, 1),
        "sell": round(sell / 1e9, 1),
        "unit": "tỷ VND",
        "scope": "HOSE, toàn phiên (khớp lệnh + thoả thuận)",
        "n": len(rows),
        "source": "VNDirect finfo (cộng từ buyVal/sellVal từng mã HOSE, chỉ type=STOCK)",
    }
    log(f"foreign OK {trade_date}: mua={out['buy']:,.1f} bán={out['sell']:,.1f} "
        f"ròng={out['net']:,.1f} tỷ (n={out['n']} mã)")
    return out, "live"


def fetch_usd_vnd_vcb(trade_date: str, prev: dict) -> tuple[dict | None, str]:
    """Tỷ giá USD/VND của Vietcombank — mua tiền mặt / mua chuyển khoản / bán.

    KHÔNG PHẢI TỶ GIÁ TRUNG TÂM. Field `usdVnd` (và `usdVndCentral` trong lịch
    sử) là tỷ giá trung tâm do NHNN công bố, một đại lượng khác: hôm nay NHNN
    25.463 còn Vietcombank mua CK 25.730 / bán 26.110 — lệch 1–2,5%. Ghi số VCB
    vào key của NHNN sẽ nối hai chuỗi khác nhau thành một đường liền trên biểu
    đồ Lịch sử, với một bậc nhảy vô hình. Nên đây là key RIÊNG (`usdVndVcb`), và
    `usdVnd` vẫn "missing" cho tới khi tìm được nguồn NHNN thật.

    robots.txt của vietcombank.com.vn: `User-agent: *  Allow: /`.

    CẠM BẪY CỦA API: tham số `date` được ECHO lại nguyên văn vào trường `Date`
    của response, kể cả khi hỏi một ngày không có bảng giá mới — hỏi thứ Bảy vẫn
    trả bảng thứ Sáu nhưng `Date` ghi thứ Bảy. Chỉ `UpdatedDate` nói thật thời
    điểm công bố, nên as-of lấy từ đó, và quality chỉ là "live" khi bảng đúng
    thật của phiên đang xét.
    """
    url = f"https://www.vietcombank.com.vn/api/exchangerates?date={trade_date}"
    try:
        payload = json.loads(http_get(url))
    except Exception as e:  # noqa: BLE001
        log(f"usdVndVcb: fetch failed ({e}) — giữ số phiên trước")
        return prev.get("usdVndVcb"), "stale" if prev.get("usdVndVcb") else "missing"

    usd = next((x for x in (payload.get("Data") or [])
                if (x.get("currencyCode") or "").upper() == "USD"), None)
    if not payload.get("Count") or not usd:
        log(f"usdVndVcb: không có bảng giá cho {trade_date} — giữ số phiên trước")
        return prev.get("usdVndVcb"), "stale" if prev.get("usdVndVcb") else "missing"

    def _f(key):
        try:
            return float(str(usd.get(key)).replace(",", ""))
        except (TypeError, ValueError):
            return None

    cash, transfer, sell = _f("cash"), _f("transfer"), _f("sell")
    # Chặn theo bậc độ lớn: USD/VND nằm trong khoảng vài chục nghìn. Một thay đổi
    # đơn vị phía Vietcombank (hoặc số 0 lọt vào) phải bị từ chối, không được
    # render thành tỷ giá.
    vals = [v for v in (cash, transfer, sell) if v is not None]
    if not vals or not all(20000 <= v <= 35000 for v in vals):
        log(f"usdVndVcb: giá trị ngoài khoảng hợp lý {vals} — không ghi")
        return prev.get("usdVndVcb"), "stale" if prev.get("usdVndVcb") else "missing"
    if transfer and sell and transfer > sell:
        log(f"usdVndVcb: mua CK ({transfer}) > bán ({sell}) — vô lý, không ghi")
        return prev.get("usdVndVcb"), "stale" if prev.get("usdVndVcb") else "missing"

    upd = str(payload.get("UpdatedDate") or "")
    upd_day = upd[:10] if len(upd) >= 10 else None
    # "stale" ở đây là MÔ TẢ, không phải báo lỗi: thứ Bảy/Chủ nhật và ngày nghỉ
    # lễ thì Vietcombank không công bố bảng mới, nên bảng của phiên gần nhất
    # được mang theo — đúng như mong đợi, không cần đi truy. Chỉ đáng để ý khi
    # nó "stale" giữa một chuỗi ngày làm việc liên tiếp.
    quality = "live" if upd_day == trade_date else "stale"

    out = {
        "buyCash": cash, "buyTransfer": transfer, "sell": sell,
        "unit": "VND / 1 USD",
        "asof": upd or None,
        "bank": "Vietcombank",
        "source": "Vietcombank api/exchangerates (tỷ giá NHTM, KHÔNG phải tỷ giá trung tâm NHNN)",
    }
    log(f"usdVndVcb {quality} {trade_date}: mua CK={transfer:,.0f} bán={sell:,.0f} "
        f"(bảng công bố {upd_day})")
    return out, quality


def fetch_news_raw() -> list[dict]:
    """Kéo tiêu đề tin thô (không tổng hợp/phân tích) từ các feed RSS miễn phí,
    chính chủ — chỉ dữ liệu xác định (title/date/link/description gốc), không
    có bước LLM nào ở đây. Việc tổng hợp thành thẻ tin đầy đủ (bảng số liệu,
    nhận định tác động VN, tag) do agent local đảm nhiệm, đọc từ file này —
    xem automation/agent_daily_prompt.md. Tách hai bước để phần fetch chạy an
    toàn trong GitHub Actions (không cần LLM), còn phần tổng hợp chỉ chạy khi
    agent local (có Bash/Read/Edit thật) thực thi."""
    all_items = []
    for category, source_name, url, max_age_days, max_items in NEWS_FEEDS:
        try:
            raw = http_get(url, timeout=20)
        except Exception as e:
            log(f"news fetch fail ({source_name}): {e}")
            continue
        items = _parse_rss_items(raw, category, source_name)
        cutoff = (now_ict() - timedelta(days=max_age_days)).astimezone(timezone.utc).isoformat()
        fresh = sorted((it for it in items if it["publishedAt"] >= cutoff),
                       key=lambda x: x["publishedAt"], reverse=True)[:max_items]
        all_items.extend(fresh)
        log(f"news OK ({source_name}): {len(items)} fetched, {len(fresh)} kept")

    seen: dict[str, dict] = {}
    for it in all_items:
        key = it["title"].strip().lower()
        if key not in seen or it["publishedAt"] > seen[key]["publishedAt"]:
            seen[key] = it
    result = sorted(seen.values(), key=lambda x: x["publishedAt"], reverse=True)
    return result


def write_news_raw() -> None:
    items = fetch_news_raw()
    payload = {
        "generatedAtIct": now_ict().isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }
    NEWS_RAW_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"wrote {NEWS_RAW_JSON.relative_to(ROOT)} ({len(items)} items)")


def fetch_world_markets() -> dict:
    """Giá thật cho trang Thế giới (the-gioi.html), qua cùng Yahoo Finance chart
    API đang dùng cho VN-Index/DXY. Trước đây trang này chỉ có số tĩnh baked
    vào src/data/worldInstruments.js (không có automation nào cập nhật), nên
    Nikkei/HSI/S&P... đứng yên nhiều ngày dù thị trường thật đã biến động."""
    quotes = {}
    for wid, sym in WORLD_SYMBOLS.items():
        q = fetch_yahoo_quote(sym)
        if q:
            quotes[wid] = {
                "price": q["price"], "prev": q["prev"],
                "chg": q["chg"], "pct": q["pct"], "date": q["date"],
            }
        else:
            log(f"world market {wid} ({sym}) fail")
    log(f"world markets OK {len(quotes)}/{len(WORLD_SYMBOLS)}")
    return quotes


def write_world_live() -> None:
    quotes = fetch_world_markets()

    # Ô USD/VND của Vietcombank trên trang Thế giới vẫn là số tĩnh baked trong
    # worldInstruments.js từ 04/08 (nhãn "mua CK 04/08"). Yahoo không có tỷ giá
    # niêm yết của một ngân hàng VN cụ thể, nên lấy từ chính bảng giá VCB đã
    # fetch cho live.json — không thêm request, không thêm nguồn.
    live_now = load_previous()
    vcb = (live_now.get("usdVndVcb") or {}) if isinstance(live_now, dict) else {}
    vcb_day = (vcb.get("asof") or "")[:10] or None
    for wid, key, what in (("USDVND", "buyTransfer", "mua CK"),
                           ("USDVND_CB", "sell", "bán ra")):
        if vcb.get(key):
            quotes[wid] = {"price": vcb[key], "prev": None, "chg": None,
                           "pct": None, "date": vcb_day}
            log(f"world market {wid} = {vcb[key]:,.0f} (Vietcombank {what})")

    payload = {"generatedAtIct": now_ict().isoformat(timespec="seconds"), "quotes": quotes}
    WORLD_LIVE_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"wrote {WORLD_LIVE_JSON.relative_to(ROOT)} ({len(quotes)} symbols)")


def parse_json_object(raw: str) -> dict:
    raw = (raw or "").strip()
    if not raw:
        return {}
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    # lấy object đầu tiên nếu model thêm text
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            return {}
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else {}


def load_grok_fill() -> dict:
    """JSON do Grok API / người ghi vào public/data/grok-fill.json."""
    if not GROK_FILL.exists():
        return {}
    try:
        raw = GROK_FILL.read_text(encoding="utf-8").strip()
        if not raw or raw == "{}":
            return {}
        data = parse_json_object(raw)
        if not data:
            log("grok-fill.json: empty/invalid")
            return {}
        log(f"grok-fill loaded asof={data.get('asof')} keys={list(data.keys())}")
        return data
    except Exception as e:
        log(f"grok-fill read fail: {e}")
        return {}


def save_grok_fill(data: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    GROK_FILL.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"wrote {GROK_FILL.relative_to(ROOT)}")


def missing_fields_for_grok(live: dict) -> list[str]:
    """Các field dashboard cần nhưng API free chưa live."""
    q = live.get("quality") or {}
    want = []
    # luôn xin Grok lấp nếu chưa live
    checklist = [
        ("margin", live.get("margin")),
        ("vnYields", live.get("vnYields")),
        ("breadth", live.get("breadth")),
        ("usdVnd", live.get("usdVnd")),
        ("foreign", live.get("foreign")),
        ("proprietary", live.get("proprietary")),
    ]
    for name, val in checklist:
        if q.get(name) == "live":
            continue
        if val in (None, {}, []):
            want.append(name)
        else:
            # có data cũ nhưng muốn refresh proxy nếu stale > 3 ngày — đơn giản: vẫn xin refresh
            want.append(name)
    # nếu API free fail
    for name in ("usYields", "vnIndex", "dxy", "fgUs"):
        if q.get(name) != "live":
            want.append(name)
    # unique preserve order
    seen = set()
    out = []
    for w in want:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def fetch_grok_auto_fill(live: dict) -> dict:
    """
    Gọi xAI Grok API để điền field còn thiếu → dict merge được.
    Cần env XAI_API_KEY. Không có key → {}.
    """
    api_key = os.environ.get("XAI_API_KEY") or os.environ.get("GROK_API_KEY")
    if not api_key:
        log("Grok auto: skip (no XAI_API_KEY secret)")
        return {}

    need = missing_fields_for_grok(live)
    if not need:
        log("Grok auto: nothing missing")
        return {}

    # context: số API đã live — Grok không được bịa đè
    context = {
        "asofApi": live.get("asof"),
        "qualityApi": live.get("quality"),
        "vnIndex": live.get("vnIndex"),
        "usYields": live.get("usYields"),
        "dxy": live.get("dxy"),
        "fgUs": live.get("fgUs"),
        "needFields": need,
    }

    system = (
        "You are a data assistant for a non-profit Vietnam market dashboard. "
        "Return ONLY one JSON object, no markdown. "
        "Use quality values: proxy|live|stale|missing. "
        "Do NOT invent numbers. If unsure, omit the field or set null. "
        "Prefer public market figures for the latest HOSE session (ICT). "
        "Units: debt/gtgd in billion VND (tỷ đồng); yields in percent."
    )
    user = (
        "Fill ONLY these fields if you have reliable public knowledge: "
        f"{need}.\n"
        "Do not override fields already marked live in qualityApi.\n"
        f"API context already fetched:\n{json.dumps(context, ensure_ascii=False)}\n\n"
        "JSON schema keys allowed: schemaVersion, asof, sourceNotes, quality, "
        "vnIndex, usYields, vnYields, margin, breadth, usdVnd, foreign, proprietary, fgUs, dxy, notes.\n"
        "margin.days[].debt is tỷ đồng. breadth.all has a,d,u,ceil,floor,total.\n"
        "proprietary is { net, note }: net tự doanh (proprietary trading) mua/bán "
        "ròng của các CTCK trên HOSE, phiên gần nhất, đơn vị tỷ VND — chỉ điền nếu "
        "có nguồn công khai, đây là số RẤT hiếm khi báo chí VN công bố nên thường "
        "nên bỏ trống hơn là đoán.\n"
        "Return pure JSON."
    )

    body = {
        "model": XAI_MODEL,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    req = urllib.request.Request(
        f"{XAI_API}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": UA,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90, context=CTX) as r:
            resp = json.loads(r.read().decode("utf-8", "replace"))
        content = (
            resp.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        data = parse_json_object(content)
        if not data:
            log("Grok auto: empty/invalid JSON response")
            return {}
        # force proxy for grok-sourced fields that aren't explicitly live
        q = data.setdefault("quality", {})
        for f in need:
            if f in data and q.get(f) not in ("live", "proxy", "stale", "missing"):
                q[f] = "proxy"
            if f in data and not q.get(f):
                q[f] = "proxy"
        data.setdefault("sourceNotes", []).append(f"xAI {XAI_MODEL} auto-fill")
        data.setdefault("asof", live.get("asof") or now_ict().date().isoformat())
        save_grok_fill(data)
        log(f"Grok auto OK fields={list(data.keys())}")
        return data
    except Exception as e:
        log(f"Grok auto fail: {e}")
        return {}


def _q(d: dict, key: str, default: str = "missing") -> str:
    q = d.get("quality") if isinstance(d.get("quality"), dict) else {}
    return str(q.get(key) or default)


def merge_grok_fill(live: dict, grok: dict) -> dict:
    """
    Merge Grok research fill.
    - API quality == live  → không bị Grok ghi đè
    - Còn lại (stale/missing/proxy) → Grok được điền, quality = proxy (hoặc theo file)
    - margin / vnYields / breadth / usdVnd / foreign: Grok điền nếu có
    - Chỉ áp dụng khi grok-fill.json thực sự là của phiên hôm nay (asof khớp
      live["asof"]) — nếu không, file đã cũ (ví dụ agent WebSearch không chạy
      được, để lại grok-fill.json từ nhiều ngày trước) thì bỏ qua hoàn toàn,
      tránh lặp lại vô hạn cùng một số liệu cũ dưới nhãn "proxy" mỗi ngày.
    """
    if not grok:
        return live

    grok_asof = grok.get("asof")
    grok_is_current = bool(grok_asof) and grok_asof == live.get("asof")
    if not grok_is_current:
        log(f"grok-fill.json asof={grok_asof} khác phiên hôm nay ({live.get('asof')}) — bỏ qua, không tái sử dụng.")
        return live

    gq = grok.get("quality") if isinstance(grok.get("quality"), dict) else {}
    notes = list(live.get("notes") or [])
    src = grok.get("sourceNotes") or grok.get("notes") or []
    if isinstance(src, list):
        notes.extend([f"Grok: {s}" for s in src if s])
    notes.append(f"Merged public/data/grok-fill.json asof={grok_asof}")

    def api_live(field: str) -> bool:
        return (live.get("quality") or {}).get(field) == "live"

    # --- fields Grok luôn được điền nếu có (không có free API ổn định) ---
    for field in ("margin", "vnYields", "breadth", "usdVnd", "foreign", "proprietary"):
        if grok.get(field) not in (None, {}, []):
            live[field] = grok[field]
            live.setdefault("quality", {})[field] = gq.get(field) or "proxy"
            log(f"grok fill → {field} ({live['quality'][field]})")

    # --- fields API free: chỉ lấy Grok khi API không live ---
    for field, key in (
        ("usYields", "usYields"),
        ("fgUs", "fgUs"),
        ("vnIndex", "vnIndex"),
        ("dxy", "dxy"),
    ):
        if api_live(field):
            continue
        if grok.get(key) not in (None, {}, []):
            live[key] = grok[key]
            live.setdefault("quality", {})[field] = gq.get(field) or "proxy"
            log(f"grok fill (API stale) → {field}")

    live["grokFillAsof"] = grok_asof
    live["notes"] = notes
    return live


def build_live(prev: dict, grok: dict | None = None) -> dict:
    quality = {}
    us_yields, us_asof = fetch_us_treasury_yields(prev)
    quality["usYields"] = "live" if us_yields and us_asof else "stale"

    fg_us, fg_at = fetch_fg_us(prev)
    quality["fgUs"] = "live" if fg_us and fg_at else "stale"

    vn_idx, vn_at = fetch_vn_index(prev)
    quality["vnIndex"] = "live" if vn_idx and vn_at else "stale"

    dxy, dxy_at = fetch_dxy(prev)
    quality["dxy"] = "live" if dxy is not None and dxy_at else "stale"

    # trade date: prefer VN index session date else ICT today
    trade_date = (vn_idx or {}).get("date") or now_ict().date().isoformat()

    # margin / usdVnd / foreign / proprietary: chưa có free API — luôn là bản
    # sao của phiên trước cho tới khi Grok/agent điền được số thật của hôm nay
    # (xem merge_grok_fill). Đánh dấu rõ "stale" thay vì im lặng mang nguyên
    # trạng thái quality cũ theo, để history_row_from_live() không ghi nhầm các
    # phiên này là "proxy" mới khi thực ra chỉ là số liệu cũ lặp lại.
    for field in ("margin", "usdVnd", "proprietary"):
        quality[field] = "stale" if prev.get(field) else "missing"

    # vnYields: có nguồn từ 2026-09-12 — lãi suất trúng thầu TPCP của Kho bạc
    # Nhà nước, lấy từ kết quả đấu thầu HNX (xem automation/vn_bond_yields.py).
    # quality = "proxy", KHÔNG phải "live": đây là lợi suất sơ cấp, chỉ đổi vào
    # ngày có đấu thầu, không phải đường cong thứ cấp từng phiên. Trước đó field
    # này "missing" 161/170 phiên và frontend vẽ 5 hằng số nướng trong file.
    vn_yields, quality["vnYields"] = fetch_vn_yields(prev)

    # breadth: có nguồn free (đếm từng mã HOSE) từ 2026-09-06 — không còn phụ
    # thuộc grok-fill. Thất bại thì fetch_breadth() tự trả số phiên trước.
    breadth, quality["breadth"] = fetch_breadth(trade_date, prev)

    # foreign: cùng API finfo, cộng từ từng mã (không thêm nguồn). Từ 2026-09-12.
    foreign, quality["foreign"] = fetch_foreign(trade_date, prev)

    # usdVndVcb: tỷ giá Vietcombank. Key RIÊNG, không trộn vào `usdVnd` (tỷ giá
    # trung tâm NHNN) — xem docstring fetch_usd_vnd_vcb.
    usd_vcb, quality["usdVndVcb"] = fetch_usd_vnd_vcb(trade_date, prev)

    live = {
        "schemaVersion": "1.0",
        "generatedAtIct": now_ict().isoformat(timespec="seconds"),
        "asof": trade_date,
        "quality": quality,
        "usYields": us_yields or prev.get("usYields"),
        "usYieldsAsof": us_asof or prev.get("usYieldsAsof"),
        "fgUs": fg_us or prev.get("fgUs"),
        "fgUsFetchedAt": fg_at or prev.get("fgUsFetchedAt"),
        "vnIndex": vn_idx or prev.get("vnIndex"),
        "vnIndexFetchedAt": vn_at or prev.get("vnIndexFetchedAt"),
        "dxy": dxy if dxy is not None else prev.get("dxy"),
        "dxyFetchedAt": dxy_at or prev.get("dxyFetchedAt"),
        # margin / VN yields / breadth: free API yếu — prev hoặc Grok
        "vnYields": vn_yields or prev.get("vnYields"),
        "margin": prev.get("margin"),
        "breadth": breadth,
        "usdVnd": prev.get("usdVnd"),
        "foreign": foreign or prev.get("foreign"),
        "usdVndVcb": usd_vcb or prev.get("usdVndVcb"),
        "proprietary": prev.get("proprietary"),
        "notes": [
            "Nguồn free: US Treasury CSV, Yahoo Finance (VN-Index/DXY), CNN Fear & Greed.",
            "Grok fill: public/data/grok-fill.json (proxy) — không ghi đè field quality=live.",
        ],
    }
    return merge_grok_fill(live, grok or {})


def write_outputs(live: dict) -> None:
    # do not edit public/data/live.json by hand — it is regenerated by this script
    DATA.mkdir(parents=True, exist_ok=True)
    LIVE_JSON.write_text(json.dumps(live, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {
        "ok": True,
        "generatedAtIct": live.get("generatedAtIct"),
        "asof": live.get("asof"),
        "quality": live.get("quality"),
    }
    META_JSON.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"wrote {LIVE_JSON.relative_to(ROOT)}")


def history_row_from_live(live: dict) -> dict:
    """Project the full `live` payload down to a compact daily history row.
    See automation/README.md for the schema. fgVn is left null here: computing
    it needs a real multi-month breadth history, which only exists once this
    function has been accumulating rows for a while (see dashboardEngine.js's
    fgVietnam(), which needs 130 prior sessions)."""
    q = live.get("quality") or {}
    vn = live.get("vnIndex") or {}
    us_yields = {str(int(r["x"])): r["y"] for r in (live.get("usYields") or []) if r.get("y") is not None}
    vn_yields = {str(int(r["x"])): r["y"] for r in (live.get("vnYields") or []) if r.get("y") is not None}
    margin_days = (live.get("margin") or {}).get("days") or []
    margin_last = margin_days[-1] if margin_days else {}
    breadth = live.get("breadth") or {}
    breadth_all = breadth.get("all") or {}
    fg_us = live.get("fgUs") or {}

    return {
        "date": live.get("asof"),
        "vnIndex": vn.get("price"),
        "vnIndexPct": vn.get("pct"),
        "dxy": live.get("dxy"),
        "usYields": us_yields or None,
        "vnYields": vn_yields or None,
        "fgUs": fg_us.get("score"),
        "fgVn": None,
        "margin": margin_last.get("debt"),
        "marginNet": margin_last.get("net"),
        "breadth": (
            {"a": breadth_all.get("a"), "d": breadth_all.get("d"), "u": breadth_all.get("u"),
             "gtgd": breadth.get("gtgd")}
            if breadth_all else None
        ),
        "usdVndCentral": (live.get("usdVnd") or {}).get("central"),
        "foreignNet": (live.get("foreign") or {}).get("net"),
        # Key riêng, KHÔNG phải usdVndCentral: đó là tỷ giá trung tâm NHNN,
        # còn đây là tỷ giá NHTM của Vietcombank. Nối chung một chuỗi sẽ tạo
        # bậc nhảy 1-2,5% vô hình giữa biểu đồ.
        "usdVndVcbTransfer": (live.get("usdVndVcb") or {}).get("buyTransfer"),
        "quality": {k: q.get(k, "missing") for k in HISTORY_QUALITY_FIELDS},
    }


def load_history_year(year: int) -> dict:
    path = HISTORY_DIR / f"{year}.jsonl"
    rows: dict = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                if row.get("date"):
                    rows[row["date"]] = row
            except json.JSONDecodeError:
                continue
    return rows


def write_history_year(year: int, rows: dict) -> None:
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    path = HISTORY_DIR / f"{year}.jsonl"
    with path.open("w", encoding="utf-8") as f:
        for d in sorted(rows):
            f.write(json.dumps(rows[d], ensure_ascii=False) + "\n")
    log(f"wrote {path.relative_to(ROOT)} n={len(rows)}")


def update_history_index(years: set) -> None:
    existing = set()
    if HISTORY_INDEX.exists():
        try:
            existing = set(json.loads(HISTORY_INDEX.read_text(encoding="utf-8")).get("years") or [])
        except Exception:
            pass
    all_years = sorted(existing | years)
    HISTORY_INDEX.write_text(
        json.dumps({"years": all_years}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def append_history(live: dict) -> None:
    """Upsert today's row into public/data/history/<year>.jsonl. Idempotent —
    running this twice for the same date (morning + after-close, or a manual
    rerun) updates the row in place instead of duplicating it."""
    date = live.get("asof")
    if not date:
        log("append_history: skip (no asof date)")
        return
    year = int(date[:4])
    rows = load_history_year(year)
    rows[date] = history_row_from_live(live)
    write_history_year(year, rows)
    update_history_index({year})
    log(f"append_history: upserted {date} (n={len(rows)} rows in {year}.jsonl)")


def main(skip_fetch: bool = False, auto_grok: bool = True) -> int:
    log(
        f"start ICT={now_ict().isoformat(timespec='seconds')} "
        f"skip_fetch={skip_fetch} auto_grok={auto_grok}"
    )
    prev = load_previous()
    grok_file = load_grok_fill()

    if skip_fetch:
        live = dict(prev) if prev else {
            "schemaVersion": "1.0",
            "asof": now_ict().date().isoformat(),
            "quality": {},
            "notes": [],
        }
        live["generatedAtIct"] = now_ict().isoformat(timespec="seconds")
        live = merge_grok_fill(live, grok_file)
    else:
        # 1) free APIs  2) optional Grok API for gaps  3) merge file grok-fill
        live = build_live(prev, grok=None)  # APIs only first
        if auto_grok:
            grok_api = fetch_grok_auto_fill(live)
            if grok_api:
                live = merge_grok_fill(live, grok_api)
        if grok_file:
            live = merge_grok_fill(live, grok_file)

    write_outputs(live)
    append_history(live)
    if not skip_fetch:
        try:
            write_news_raw()
        except Exception as e:
            log(f"news raw fetch fail (non-fatal): {e}")
        try:
            write_world_live()
        except Exception as e:
            log(f"world markets fetch fail (non-fatal): {e}")
    q = live.get("quality") or {}
    live_count = sum(1 for v in q.values() if v == "live")
    proxy_count = sum(1 for v in q.values() if v == "proxy")
    log(f"done live={live_count} proxy={proxy_count} quality={q}")
    if live_count == 0 and proxy_count == 0 and not prev:
        log("WARN: no live/proxy data and no previous snapshot")
    return 0


if __name__ == "__main__":
    skip = "--grok-only" in sys.argv or "--skip-fetch" in sys.argv
    # --no-grok: chỉ free API; mặc định bật Grok nếu có XAI_API_KEY
    auto = "--no-grok" not in sys.argv
    sys.exit(main(skip_fetch=skip, auto_grok=auto))
