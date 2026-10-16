"""Daily-only compatibility adapter for this project's `ashare` provider key.

Original implementation, MIT licensed. The key is retained for MCP compatibility;
this module is not the upstream Ashare library. Never switch adjustment modes.
"""
from __future__ import annotations

import datetime as dt
import re
import pandas as pd
import requests


def _arguments(symbol, end_date, count, frequency):
    if not re.fullmatch(r"(?:sh|sz)\d{6}", symbol) or frequency != "1d":
        raise ValueError("Only explicit Shanghai/Shenzhen daily requests are supported")
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 3000:
        raise ValueError("count must be an integer from 1 to 3000")
    end = dt.date.fromisoformat(str(end_date)[:10]) if end_date else dt.date.today()
    return end.isoformat()


def _json(url, params):
    response = requests.get(url, params=params, timeout=10, verify=True, allow_redirects=False)
    response.raise_for_status()
    if response.status_code != 200 or len(response.content) > 3_000_000:
        raise ValueError("Unexpected upstream response")
    return response.json()


def _frame(records, end, count):
    frame = pd.DataFrame.from_records(records, columns=["date", "open", "high", "low", "close", "volume"])
    frame["date"] = pd.to_datetime(frame["date"], errors="raise")
    for column in ["open", "high", "low", "close", "volume"]:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    frame = frame.set_index("date").sort_index()
    return frame.loc[frame.index <= pd.Timestamp(end)].tail(count)


def get_price_sina(symbol, end_date="", count=10, frequency="1d"):
    end = _arguments(symbol, end_date, count, frequency)
    # The endpoint returns recent rows; the caller already requests a span from
    # its start date through today. It may return less history than requested.
    payload = _json("https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData", {
        "symbol": symbol, "scale": "240", "ma": "5", "datalen": str(count),
    })
    if not isinstance(payload, list):
        raise ValueError("Sina did not return a daily series")
    records = [{"date": row["day"], **{key: row[key] for key in ["open", "high", "low", "close", "volume"]}} for row in payload]
    return _frame(records, end, count)


def get_price_day_tx(symbol, end_date="", count=10, frequency="1d"):
    end = _arguments(symbol, end_date, count, frequency)
    if count > 640:
        raise ValueError("Tencent daily requests support at most 640 rows")
    payload = _json("https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get", {
        "param": f"{symbol},day,,{end},{count},qfq",
    })
    series = payload.get("data", {}).get(symbol, {}).get("qfqday")
    if not isinstance(series, list):
        raise ValueError("Tencent did not return the requested qfq series")
    records = [{"date": row[0], "open": row[1], "close": row[2], "high": row[3], "low": row[4], "volume": row[5]} for row in series]
    return _frame(records, end, count)
