"""Flask backend for serving yfinance metrics."""
from __future__ import annotations

from http import HTTPStatus

from flask import Flask, jsonify, request

from stock_analysis import build_metrics_response_with_session

app = Flask(__name__)


@app.get("/api/metrics")
def metrics() -> tuple[dict, int]:
    symbol = request.args.get("symbol", "").strip()
    if not symbol:
        return (
            {
                "metrics": {},
                "companyName": None,
                "symbol": None,
                "errorMessage": "Bitte ein Symbol angeben.",
            },
            HTTPStatus.BAD_REQUEST,
        )

    payload = build_metrics_response_with_session(symbol)
    if payload.get("errorMessage"):
        return payload, HTTPStatus.BAD_REQUEST

    return payload, HTTPStatus.OK


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
