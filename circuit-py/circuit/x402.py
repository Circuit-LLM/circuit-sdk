"""The x402 micropayment client (Python) — pay any x402 endpoint in CIRC.

Mirrors @circuit-llm/x402: on a 402, parse the quote, pay CIRC from a wallet, retry with
X-Payment-Signature. Stdlib-only; the HTTP transport and the wallet are both injectable
(so this is testable with no network and no Solana dependency).
"""
from __future__ import annotations

import json
import math
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol

from .config import CIRC_DECIMALS, CIRC_MINT

FALLBACK_CIRC_USD = 0.0001
_TRANSIENT = {429, 500, 502, 503, 504}


# ── pricing / quote ──────────────────────────────────────────────────────────

def circ_raw_from_usd(usd_price: float, circ_usd: float) -> int:
    """Raw CIRC base units for a USD price at a CIRC/USD rate. Rounds UP in RAW units
    (NOT to a whole CIRC token) so a request is charged its fair value — byte-identical
    to the server (circuit-data-api/lib/pricing.js) + @circuit-llm/x402. Pure + deterministic."""
    rate = circ_usd if circ_usd > 0 else FALLBACK_CIRC_USD
    return math.ceil((usd_price / rate) * (10 ** CIRC_DECIMALS))


def format_circ(raw: int) -> str:
    return f"{raw / (10 ** CIRC_DECIMALS):.2f}"


def parse_402(body: Any, path: Optional[str] = None) -> Optional[dict]:
    """Parse a 402 response body's `payment` block into a typed quote, or None."""
    pay = (body or {}).get("payment") if isinstance(body, dict) else None
    if not pay or not pay.get("recipient") or pay.get("amountRaw") is None:
        return None
    try:
        amount_raw = int(pay["amountRaw"])
    except (TypeError, ValueError):
        return None
    return {
        "recipient": str(pay["recipient"]),
        "amount_raw": amount_raw,
        "amount_display": pay.get("amountDisplay") or f"{format_circ(amount_raw)} CIRC",
        "token": pay.get("token") or CIRC_MINT,
        "path": path,
        "raw": pay,
    }


def parse_accepted_tokens(body: Any) -> list:
    """Parse a 402's `acceptedTokens` list (x402 Universal Adapter) — registered tokens the gate
    will accept in place of CIRC. Returns [] if absent, skipping entries without a usable amount."""
    lst = (body or {}).get("acceptedTokens") if isinstance(body, dict) else None
    if not isinstance(lst, list):
        return []
    out = []
    for t in lst:
        if not isinstance(t, dict) or not t.get("mint") or not t.get("recipient") or t.get("amountRaw") is None:
            continue
        try:
            amount_raw = int(t["amountRaw"])
        except (TypeError, ValueError):
            continue
        out.append({
            "mint": str(t["mint"]),
            "recipient": str(t["recipient"]),
            "amount_raw": amount_raw,
            "decimals": t.get("decimals", 6),
            "token_program": t.get("tokenProgram", "spl"),
            "symbol": t.get("symbol"),
            "price_usd": t.get("priceUsd"),
        })
    return out


# ── errors ───────────────────────────────────────────────────────────────────

class PaymentRequiredError(Exception):
    def __init__(self, quote: Optional[dict]):
        super().__init__(f"Payment required: {(quote or {}).get('amount_display', '?')} (no wallet)")
        self.quote = quote


class SpendCapError(Exception):
    def __init__(self, quote: dict, cap_raw: int):
        super().__init__(f"Quoted {quote['amount_display']} exceeds the spend cap of {cap_raw} raw")
        self.quote = quote
        self.cap_raw = cap_raw


class PayTokenCapRequiredError(Exception):
    """pay_token set but no max_pay_token_raw — a foreign amount isn't CIRC-denominated, so the CIRC
    caps can't bound it; the client fails closed rather than pay an unbounded amount an endpoint dictates."""
    def __init__(self, quote: dict):
        super().__init__(f"pay_token is set but no max_pay_token_raw ceiling was configured — refusing to pay {quote['amount_display']} unbounded")
        self.quote = quote


class RecipientNotAllowedError(Exception):
    def __init__(self, quote: dict):
        super().__init__(f"402 recipient {quote['recipient']} is not in the allowed set — refusing to pay")
        self.quote = quote


class BudgetExceededError(Exception):
    def __init__(self, quote: dict, spent_raw: int, budget_raw: int):
        super().__init__(f"Paying {quote['amount_raw']} would exceed the budget ({spent_raw}/{budget_raw} raw spent)")
        self.quote = quote


class X402RequestError(Exception):
    def __init__(self, status: int, body: Any):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


# ── wallet + transport ───────────────────────────────────────────────────────

class PaymentWallet(Protocol):
    def send_circ(self, recipient: str, amount_raw: int) -> str: ...


@dataclass
class HttpResponse:
    status: int
    body: bytes
    headers: dict = field(default_factory=dict)


Transport = Callable[[str, str, dict, Optional[bytes], float], HttpResponse]


def default_transport(method: str, url: str, headers: dict, body: Optional[bytes], timeout: float) -> HttpResponse:
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return HttpResponse(r.status, r.read(), dict(r.headers))
    except urllib.error.HTTPError as e:  # 402/4xx/5xx carry a body we need
        return HttpResponse(e.code, e.read(), dict(e.headers or {}))


# ── client ───────────────────────────────────────────────────────────────────

class X402Client:
    def __init__(
        self,
        wallet: Optional[PaymentWallet] = None,
        max_spend_raw: Optional[int] = None,
        on_pay: Optional[Callable[[dict], None]] = None,
        transport: Optional[Transport] = None,
        timeout: float = 120.0,
        retry_delay: float = 2.0,
        pay_token: Optional[str] = None,
        max_pay_token_raw: Optional[int] = None,
        max_total_pay_token_raw: Optional[int] = None,
        allowed_recipients: Optional[list] = None,
    ):
        self.wallet = wallet
        self.max_spend_raw = max_spend_raw
        self.on_pay = on_pay
        self.transport = transport or default_transport
        self.timeout = timeout
        self.retry_delay = retry_delay
        # x402 Universal Adapter: pay a registered token instead of CIRC.
        self.pay_token = pay_token
        self.max_pay_token_raw = max_pay_token_raw
        self.max_total_pay_token_raw = max_total_pay_token_raw
        self.allowed_recipients = set(allowed_recipients) if allowed_recipients else None
        self._spent_pay_token_raw = 0

    def request(self, request_fn: Callable[[dict], HttpResponse]):
        """Generic pay-and-retry. request_fn(extra_headers) -> HttpResponse.
        Returns (response, payment_tx | None, quote | None)."""
        resp = request_fn({})
        if resp.status != 402:
            return resp, None, None
        try:
            body = json.loads(resp.body or b"{}")
        except json.JSONDecodeError:
            body = {}
        quote = parse_402(body)
        if not quote:
            raise X402RequestError(402, "402 without usable payment requirements")
        if not self.wallet:
            raise PaymentRequiredError(quote)

        # x402 Universal Adapter: if configured to pay a registered token AND this 402 offers it,
        # transfer that token instead of CIRC. Foreign amounts aren't CIRC-denominated, so the CIRC
        # caps don't apply — fail closed on a missing token cap, enforce it, pin the recipient, and
        # bound the cumulative token spend before moving funds.
        if self.pay_token and hasattr(self.wallet, "send_token"):
            tk = next((a for a in parse_accepted_tokens(body) if a["mint"] == self.pay_token), None)
            if tk:
                digits = min(tk["decimals"], 4)
                token_quote = {
                    **quote, "recipient": tk["recipient"], "amount_raw": tk["amount_raw"], "token": tk["mint"],
                    "amount_display": f"{tk['amount_raw'] / (10 ** tk['decimals']):.{digits}f} {tk.get('symbol') or 'token'}",
                }
                if self.max_pay_token_raw is None:
                    raise PayTokenCapRequiredError(token_quote)
                if tk["amount_raw"] > self.max_pay_token_raw:
                    raise SpendCapError(token_quote, self.max_pay_token_raw)
                if self.allowed_recipients is not None and tk["recipient"] not in self.allowed_recipients:
                    raise RecipientNotAllowedError(token_quote)
                if self.max_total_pay_token_raw is not None and self._spent_pay_token_raw + tk["amount_raw"] > self.max_total_pay_token_raw:
                    raise BudgetExceededError(token_quote, self._spent_pay_token_raw, self.max_total_pay_token_raw)
                if self.on_pay:
                    self.on_pay(token_quote)
                tx = self.wallet.send_token(tk["mint"], tk["recipient"], tk["amount_raw"], tk["decimals"], tk["token_program"])
                self._spent_pay_token_raw += tk["amount_raw"]
                resp = request_fn({"X-Payment-Signature": tx})
                if resp.status in _TRANSIENT:
                    time.sleep(self.retry_delay)
                    resp = request_fn({"X-Payment-Signature": tx})
                return resp, tx, token_quote
            # pay_token set but this endpoint doesn't offer it → fall through to the CIRC path.

        if self.max_spend_raw is not None and quote["amount_raw"] > self.max_spend_raw:
            raise SpendCapError(quote, self.max_spend_raw)
        if self.on_pay:
            self.on_pay(quote)
        tx = self.wallet.send_circ(quote["recipient"], quote["amount_raw"])
        resp = request_fn({"X-Payment-Signature": tx})
        if resp.status in _TRANSIENT:
            time.sleep(self.retry_delay)
            resp = request_fn({"X-Payment-Signature": tx})
        return resp, tx, quote

    def get_json(self, url: str, method: str = "GET", headers: Optional[dict] = None, body: Optional[bytes] = None) -> dict:
        """Pay-and-parse-JSON. Raises X402RequestError on a non-2xx final response."""
        def rf(extra: dict) -> HttpResponse:
            return self.transport(method, url, {**(headers or {}), **extra}, body, self.timeout)

        resp, tx, quote = self.request(rf)
        try:
            data = json.loads(resp.body) if resp.body else None
        except json.JSONDecodeError:
            data = resp.body
        if resp.status >= 400:
            raise X402RequestError(resp.status, data)
        return {"data": data, "payment_tx": tx, "quote": quote, "status": resp.status}
