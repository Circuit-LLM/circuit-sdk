"""Typed client for the Circuit Data API, paid per call in CIRC (x402).

Free endpoints (quote/prices/status/probe) return 200; paid endpoints answer 402 and
the X402Client pays + retries. Catalog from circuit-data-api.
"""
from __future__ import annotations

from typing import Optional, Union
from urllib.parse import urlencode

from .config import DEFAULT_CONFIG
from .x402 import X402Client, PaymentWallet, Transport


def _csv(x: Union[str, list]) -> str:
    return ",".join(x) if isinstance(x, list) else x


class Data:
    def __init__(
        self,
        x402: Optional[X402Client] = None,
        wallet: Optional[PaymentWallet] = None,
        config: Optional[dict] = None,
        base_url: Optional[str] = None,
        internal_key: Optional[str] = None,
        transport: Optional[Transport] = None,
        max_spend_raw: Optional[int] = None,
        pay_token: Optional[str] = None,
        max_pay_token_raw: Optional[int] = None,
        max_total_pay_token_raw: Optional[int] = None,
        allowed_recipients: Optional[list] = None,
    ):
        self.x402 = x402 or X402Client(
            wallet=wallet, transport=transport, max_spend_raw=max_spend_raw,
            pay_token=pay_token, max_pay_token_raw=max_pay_token_raw,
            max_total_pay_token_raw=max_total_pay_token_raw, allowed_recipients=allowed_recipients,
        )
        cfg = config or DEFAULT_CONFIG
        self.base = (base_url or cfg["endpoints"]["data"]).rstrip("/")
        self.internal_key = internal_key

    def _headers(self) -> dict:
        return {"X-Internal-Key": self.internal_key} if self.internal_key else {}

    def get(self, path: str, query: Optional[dict] = None):
        """GET any data-api path (paying CIRC if it answers 402); returns the parsed body."""
        qs = ""
        if query:
            clean = {k: v for k, v in query.items() if v is not None}
            if clean:
                qs = "?" + urlencode(clean)
        return self.x402.get_json(f"{self.base}{path}{qs}", headers=self._headers())["data"]

    # free
    def quote(self):
        return self.get("/api/quote")

    def prices(self, mints):
        return self.get("/api/prices", {"mints": _csv(mints)})

    def status(self):
        return self.get("/api/status")

    def probe(self, source):
        return self.get("/api/probe", {"source": source})

    # token
    def token_price(self, mint):
        return self.get("/api/token-price", {"mint": mint})

    def token_prices(self, mints):
        return self.get("/api/token-prices", {"mints": _csv(mints)})

    def token_info(self, mint):
        return self.get("/api/token-info", {"mint": mint})

    def token_security(self, mint):
        return self.get("/api/token-security", {"mint": mint})

    def token_trending(self):
        return self.get("/api/token-trending")

    def scan(self, mint):
        return self.get("/api/scan", {"mint": mint})

    # wallet
    def wallet_analytics(self, wallet):
        return self.get("/api/wallet-analytics", {"wallet": wallet})

    def wallet_pnl(self, wallet):
        return self.get("/api/wallet-pnl", {"wallet": wallet})

    # market / defi / chain
    def market_overview(self):
        return self.get("/api/market-overview")

    def market_sentiment(self):
        return self.get("/api/market-sentiment")

    def new_tokens(self):
        return self.get("/api/new-tokens")

    def defi_overview(self):
        return self.get("/api/defi-overview")

    def yields(self):
        return self.get("/api/yields")

    def network_stats(self):
        return self.get("/api/network-stats")

    def news(self):
        return self.get("/api/news")

    def top_pools(self):
        return self.get("/api/top-pools")
