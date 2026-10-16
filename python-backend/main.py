"""Optional financial adapters behind a small authenticated HTTP service.

Deploy this directory on a persistent Python/Docker cloud host, separately from
Sites. No stock-data account or personal API key is used. FINANCE_BACKEND_TOKEN
is an access credential for this private service, not a vendor API key.
"""
from __future__ import annotations
import datetime as dt
import hmac
import importlib.metadata
import math
import multiprocessing as mp
import os
import socket
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, model_validator

app = FastAPI(title="Finance Sources Backend", version="1.0.0")

class HistoryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["akshare", "efinance", "ashare", "baostock"]
    symbol: str
    start_date: dt.date
    end_date: dt.date
    adjust: Literal["none", "qfq", "hfq"] = "none"

    @model_validator(mode="after")
    def validate_query(self):
        import re
        self.symbol = self.symbol.strip().lower()
        if not re.fullmatch(r"(sh(?:600|601|603|605|688|689)|sz(?:000|001|002|003|300|301))\d{3}", self.symbol):
            raise ValueError("multi-source history currently supports Shanghai/Shenzhen A-shares only")
        if self.start_date > self.end_date:
            raise ValueError("start_date must not exceed end_date")
        if (self.end_date - self.start_date).days > 6 * 366:
            raise ValueError("query at most six years at once")
        return self

def numeric(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None

def dataframe_rows(frame, mapping, indexed=False):
    output = []
    for index, values in frame.iterrows():
        row = {}
        for target, source in mapping.items():
            value = index if target == "date" and indexed else values.get(source)
            row[target] = str(value)[:10] if target == "date" else numeric(value)
        if row.get("date"):
            output.append(row)
    return output

def fetch_history(query):
    # Many community adapters have no request timeout. Bound calls here as well
    # as in the parent process. Never disable certificate verification.
    import requests
    original = requests.sessions.Session.request
    def bounded(session, method, url, **kwargs):
        kwargs.setdefault("timeout", 10)
        kwargs["verify"] = True
        return original(session, method, url, **kwargs)
    requests.sessions.Session.request = bounded
    socket.setdefaulttimeout(10)
    symbol = query["symbol"]
    code = symbol[2:]
    provider = query["provider"]
    adjust = query["adjust"]
    start, end = query["start_date"], query["end_date"]
    source = "unknown"
    units = {"prices": "CNY", "volume_raw": "source-specific; excluded from cross-check", "amount_raw": "source-specific; excluded from cross-check"}
    if provider == "akshare":
        import akshare as ak
        frame = ak.stock_zh_a_hist_tx(symbol=symbol, start_date=start.replace("-", ""), end_date=end.replace("-", ""), adjust={"none":"", "qfq":"qfq", "hfq":"hfq"}[adjust], timeout=10)
        data = dataframe_rows(frame, {"date":"date", "open":"open", "close":"close", "high":"high", "low":"low", "volume_raw":"volume", "amount_raw":"amount"})
        source = "tencent"
        units.update(volume_raw="shares (AKShare normalization)", amount_raw="CNY (AKShare normalization)")
    elif provider == "efinance":
        raise ValueError("efinance history route disabled after removal of its underlying data source")
    elif provider == "ashare":
        from adapters import daily as Ashare
        count = min(3000, (dt.date.today() - dt.date.fromisoformat(start)).days + 30)
        if count < 1:
            data = []
        elif adjust == "none":
            # get_price() switches from Sina unadjusted to Tencent qfq on failure.
            # Choose the explicit function to preserve the requested convention.
            frame = Ashare.get_price_sina(symbol, end_date=end, count=count, frequency="1d")
            data = dataframe_rows(frame, {"date":"", "open":"open", "close":"close", "high":"high", "low":"low", "volume_raw":"volume"}, indexed=True)
            source = "sina"
        elif adjust == "qfq":
            frame = Ashare.get_price_day_tx(symbol, end_date=end, count=min(count,640), frequency="1d")
            data = dataframe_rows(frame, {"date":"", "open":"open", "close":"close", "high":"high", "low":"low", "volume_raw":"volume"}, indexed=True)
            source = "tencent"
        else:
            raise ValueError("Ashare does not expose hfq in the reviewed adapter")
    else:
        import baostock as bs
        login = bs.login()
        if login.error_code != "0":
            raise RuntimeError("BaoStock anonymous login failed")
        try:
            result = bs.query_history_k_data_plus(symbol[:2] + "." + code, "date,open,high,low,close,volume,amount,tradestatus", start_date=start, end_date=end, frequency="d", adjustflag={"none":"3", "qfq":"2", "hfq":"1"}[adjust])
            if result.error_code != "0":
                raise RuntimeError("BaoStock history query failed")
            data = []
            while result.next():
                raw = dict(zip(result.fields, result.get_row_data()))
                if raw.get("tradestatus") == "0":
                    continue  # Suspended non-trading rows are not comparable OHLC.
                data.append({"date":raw.get("date"), "open":numeric(raw.get("open")), "close":numeric(raw.get("close")), "high":numeric(raw.get("high")), "low":numeric(raw.get("low")), "volume_raw":numeric(raw.get("volume")), "amount_raw":numeric(raw.get("amount"))})
            if result.error_code != "0":
                raise RuntimeError("BaoStock query interrupted")
        finally:
            bs.logout()
        source = "baostock"
        units.update(volume_raw="shares", amount_raw="CNY")
    data = [r for r in data if start <= r["date"] <= end]
    return {"provider":provider,"symbol":symbol,"adjust":adjust,"currency":"CNY","frequency":"daily","underlying_source":source,"data":data,"units":units,"retrieved_at":dt.datetime.now(dt.timezone.utc).isoformat()}

def child_fetch(query, pipe):
    try:
        pipe.send({"ok":True,"result":fetch_history(query)})
    except Exception as exc:
        # Avoid returning URLs, credentials, or arbitrary upstream bodies.
        pipe.send({"ok":False,"error":type(exc).__name__})
    finally:
        pipe.close()

@app.get("/health")
def health():
    versions = {}
    for name in ["akshare", "efinance", "baostock"]:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    return {"version":"1.2.0","libraries":versions,"ashare_compatible_adapter":True,"disabled_history_providers":["efinance"],"upstream_connectivity_verified":False}

@app.post("/history")
def history_endpoint(query: HistoryRequest, authorization: str | None = Header(default=None)):
    secret = os.environ.get("FINANCE_BACKEND_TOKEN", "")
    if not secret:
        raise HTTPException(503, "Backend access token not configured")
    expected = "Bearer " + secret
    if not authorization or not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(401, "Authentication required")
    if query.provider == "efinance":
        raise HTTPException(503, "efinance history route disabled")
    parent, child = mp.Pipe(duplex=False)
    process = mp.Process(target=child_fetch, args=(query.model_dump(mode="json"),child),daemon=True)
    process.start()
    child.close()
    try:
        if not parent.poll(20):
            raise HTTPException(504, "Upstream query timed out")
        message = parent.recv()
        if not message["ok"]:
            raise HTTPException(502, "Upstream query failed: " + message["error"])
        return message["result"]
    finally:
        parent.close()
        if process.is_alive():
            process.terminate()
        process.join(timeout=2)

