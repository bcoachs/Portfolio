"""Stock analysis utilities backed by yfinance."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Union

import pandas as pd
import requests
import yfinance as yf


@dataclass(frozen=True)
class MetricResult:
    value: Optional[float]
    status: str
    threshold: str
    note: Optional[str] = None


def _safe_info(ticker: yf.Ticker) -> Dict[str, Any]:
    try:
        info = ticker.info or {}
    except Exception:
        return {}
    return info


def _create_yfinance_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/121.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        }
    )
    return session


def _looks_like_isin(symbol: str) -> bool:
    if len(symbol) != 12:
        return False
    return symbol[:2].isalpha() and symbol.isalnum()


def _resolve_isin_to_ticker(symbol: str, session: requests.Session) -> str:
    if not _looks_like_isin(symbol):
        return symbol
    try:
        response = session.get(
            "https://query2.finance.yahoo.com/v1/finance/search",
            params={"q": symbol, "quotesCount": 6, "newsCount": 0},
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return symbol

    quotes = payload.get("quotes") or []
    for quote in quotes:
        if quote.get("quoteType") == "EQUITY" and quote.get("symbol"):
            return str(quote["symbol"])
    if quotes and quotes[0].get("symbol"):
        return str(quotes[0]["symbol"])
    return symbol


def _value_or_na(value: Optional[Any]) -> Union[float, str, Any]:
    if value is None:
        return "N/A"
    return value


def get_stock_data(symbol: str) -> Dict[str, Any]:
    """
    Fetch stock data via yfinance using a configured requests session.
    Supports ISIN inputs by resolving them to ticker symbols.
    Missing data is returned as 'N/A' instead of raising errors.
    """
    session = _create_yfinance_session()
    resolved_symbol = _resolve_isin_to_ticker(symbol.strip().upper(), session)
    try:
        yf_ticker = yf.Ticker(resolved_symbol, session=session)
        info = _safe_info(yf_ticker)
    except Exception:
        info = {}

    return {
        "symbol": resolved_symbol,
        "companyName": _value_or_na(info.get("shortName") or info.get("longName")),
        "currency": _value_or_na(info.get("currency")),
        "exchange": _value_or_na(info.get("exchange")),
        "sector": _value_or_na(info.get("sector")),
        "industry": _value_or_na(info.get("industry")),
        "currentPrice": _value_or_na(info.get("currentPrice")),
        "marketCap": _value_or_na(info.get("marketCap")),
    }


def _latest_column(df: Optional[pd.DataFrame]) -> Optional[Any]:
    if df is None or df.empty:
        return None
    columns = list(df.columns)
    try:
        return max(columns)
    except Exception:
        return columns[0]


def _find_row_value(
    df: Optional[pd.DataFrame],
    row_names: Iterable[str],
) -> Optional[float]:
    if df is None or df.empty:
        return None
    latest = _latest_column(df)
    if latest is None:
        return None
    normalized = {str(idx).strip().lower(): idx for idx in df.index}
    for name in row_names:
        key = name.strip().lower()
        if key in normalized:
            value = df.loc[normalized[key], latest]
            if pd.isna(value):
                return None
            return float(value)
    return None


def _metric_status(
    value: Optional[float],
    *,
    good_min: Optional[float] = None,
    good_max: Optional[float] = None,
    label: str,
) -> MetricResult:
    if value is None:
        return MetricResult(value, "Beobachten", label, "Daten fehlen")
    if good_min is not None and value < good_min:
        return MetricResult(value, "Kritisch", label, "unter Grenzwert")
    if good_max is not None and value > good_max:
        return MetricResult(value, "Kritisch", label, "über Grenzwert")
    return MetricResult(value, "Gut", label)


def _calculate_fcf(
    cashflow: Optional[pd.DataFrame],
) -> Optional[float]:
    free_cash_flow = _find_row_value(cashflow, ["Free Cash Flow"])
    if free_cash_flow is not None:
        return free_cash_flow

    operating_cf = _find_row_value(
        cashflow,
        [
            "Operating Cash Flow",
            "Total Cash From Operating Activities",
        ],
    )
    capex = _find_row_value(cashflow, ["Capital Expenditure", "Capital Expenditures"])
    if operating_cf is None or capex is None:
        return None
    return operating_cf + capex


def _calculate_dividends_paid(
    info: Dict[str, Any],
    cashflow: Optional[pd.DataFrame],
) -> Optional[float]:
    dividends_paid = _find_row_value(
        cashflow,
        ["Dividends Paid", "Cash Dividends Paid"],
    )
    if dividends_paid is not None:
        return abs(dividends_paid)

    dividend_rate = info.get("dividendRate")
    shares_outstanding = info.get("sharesOutstanding")
    if dividend_rate and shares_outstanding:
        return float(dividend_rate) * float(shares_outstanding)
    return None


def _calculate_interest_coverage(income_stmt: Optional[pd.DataFrame]) -> Optional[float]:
    operating_income = _find_row_value(
        income_stmt,
        ["Operating Income", "Operating Income or Loss"],
    )
    interest_expense = _find_row_value(
        income_stmt,
        ["Interest Expense", "Interest Expense Non Operating"],
    )
    if operating_income is None or interest_expense is None:
        return None
    if interest_expense == 0:
        return None
    return operating_income / abs(interest_expense)


def analyze_stock(
    ticker: str,
    *,
    as_frame: bool = False,
) -> Union[Dict[str, Any], pd.DataFrame]:
    """
    Analyze a stock with yfinance and return key KPIs plus an overall rating.

    KPIs:
    - FCF-Payout (Dividend / Free Cashflow) < 70%
    - Net Debt / EBITDA < 2.5
    - ROIC/ROE > 12%
    - Interest Coverage (Operating Income / Interest Expense) > 5
    """
    yf_ticker = yf.Ticker(ticker)
    info = _safe_info(yf_ticker)

    cashflow = getattr(yf_ticker, "cashflow", None)
    income_stmt = getattr(yf_ticker, "income_stmt", None)

    free_cash_flow = _calculate_fcf(cashflow)
    dividends_paid = _calculate_dividends_paid(info, cashflow)
    fcf_payout = None
    if free_cash_flow and free_cash_flow != 0 and dividends_paid is not None:
        fcf_payout = dividends_paid / free_cash_flow

    net_debt = info.get("netDebt")
    ebitda = info.get("ebitda")
    debt_to_ebitda = None
    if net_debt is not None and ebitda not in (None, 0):
        debt_to_ebitda = float(net_debt) / float(ebitda)

    roic = info.get("returnOnCapitalEmployed")
    roe = info.get("returnOnEquity")
    profitability = None
    profitability_label = "ROIC"
    if roic is not None:
        profitability = float(roic)
    elif roe is not None:
        profitability = float(roe)
        profitability_label = "ROE"

    interest_coverage = _calculate_interest_coverage(income_stmt)

    metrics = {
        "fcf_payout": _metric_status(
            fcf_payout,
            good_max=0.7,
            label="< 70%",
        ),
        "debt_to_ebitda": _metric_status(
            debt_to_ebitda,
            good_max=2.5,
            label="< 2,5",
        ),
        "profitability": _metric_status(
            profitability,
            good_min=0.12,
            label="> 12%",
        ),
        "interest_coverage": _metric_status(
            interest_coverage,
            good_min=5.0,
            label="> 5",
        ),
    }

    critical = sum(1 for metric in metrics.values() if metric.status == "Kritisch")
    missing = sum(1 for metric in metrics.values() if metric.note == "Daten fehlen")

    if critical >= 2:
        rating = "Kritisch"
    elif critical == 1 or missing:
        rating = "Beobachten"
    else:
        rating = "Gut"

    result = {
        "ticker": ticker,
        "company": info.get("shortName") or info.get("longName"),
        "currency": info.get("currency"),
        "profitability_basis": profitability_label,
        "rating": rating,
        "metrics": {
            key: {
                "value": metric.value,
                "status": metric.status,
                "threshold": metric.threshold,
                "note": metric.note,
            }
            for key, metric in metrics.items()
        },
    }

    if as_frame:
        frame = pd.DataFrame(result["metrics"]).T
        frame.index.name = "metric"
        return frame

    return result


def build_metrics_response(symbol: str) -> Dict[str, Any]:
    """Build the JSON payload expected by the web app using yfinance."""
    yf_ticker = yf.Ticker(symbol)
    info = _safe_info(yf_ticker)
    cashflow = getattr(yf_ticker, "cashflow", None)
    income_stmt = getattr(yf_ticker, "income_stmt", None)

    free_cash_flow = _calculate_fcf(cashflow)
    dividends_paid = _calculate_dividends_paid(info, cashflow)
    fcf_payout = None
    if free_cash_flow and free_cash_flow != 0 and dividends_paid is not None:
        fcf_payout = dividends_paid / free_cash_flow

    debt_to_ebitda = None
    net_debt = info.get("netDebt")
    ebitda = info.get("ebitda")
    if net_debt is not None and ebitda not in (None, 0):
        debt_to_ebitda = float(net_debt) / float(ebitda)

    roic = info.get("returnOnCapitalEmployed")
    if roic is None:
        roic = info.get("returnOnEquity")

    payload = {
        "metrics": {
            "dividendYield": _metric_entry(info.get("dividendYield")),
            "epsPayout": _metric_entry(info.get("payoutRatio")),
            "fcfPayout": _metric_entry(fcf_payout),
            "debtToEbitda": _metric_entry(debt_to_ebitda),
            "interestCoverage": _metric_entry(_calculate_interest_coverage(income_stmt)),
            "roic": _metric_entry(roic),
            "dividendGrowth": _metric_entry(None),
        },
        "companyName": info.get("shortName") or info.get("longName") or symbol,
        "symbol": info.get("symbol") or symbol,
        "errorMessage": None,
    }
    return payload


def _metric_entry(value: Optional[float]) -> Dict[str, Any]:
    return {
        "value": None if value is None else float(value),
        "source": "yfinance",
        "date": pd.Timestamp.utcnow().date().isoformat(),
    }
