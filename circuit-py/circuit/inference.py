"""DLLM chat through the Circuit inference gateway, paid per call in CIRC (x402)."""
from __future__ import annotations

import json
from typing import Any, Optional

from .config import DEFAULT_CONFIG
from .x402 import X402Client, PaymentWallet, Transport


class Inference:
    def __init__(
        self,
        x402: Optional[X402Client] = None,
        wallet: Optional[PaymentWallet] = None,
        config: Optional[dict] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        internal_key: Optional[str] = None,
        transport: Optional[Transport] = None,
        max_spend_raw: Optional[int] = None,
    ):
        self.x402 = x402 or X402Client(wallet=wallet, transport=transport, max_spend_raw=max_spend_raw)
        cfg = config or DEFAULT_CONFIG
        self.base = (base_url or cfg["endpoints"]["inference"]).rstrip("/")
        self.model = model or cfg["model"]
        self.internal_key = internal_key

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.internal_key:
            h["X-Internal-Key"] = self.internal_key
        return h

    def chat(self, messages: list, model: Optional[str] = None, max_tokens: int = 512, temperature: float = 0.5) -> dict:
        """Non-streaming completion. Returns {content, usage, payment_tx, raw}."""
        body = json.dumps(
            {
                "model": model or self.model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": False,
            }
        ).encode()
        r = self.x402.get_json(f"{self.base}/chat/completions", method="POST", headers=self._headers(), body=body)
        data: Any = r["data"] or {}
        choices = data.get("choices") or [{}]
        content = ((choices[0].get("message") or {}).get("content") or "").strip()
        return {"content": content, "usage": data.get("usage"), "payment_tx": r["payment_tx"], "raw": data}

    def list_models(self) -> list:
        r = self.x402.get_json(f"{self.base}/models", headers=self._headers())
        return [m["id"] for m in ((r["data"] or {}).get("data") or [])]
