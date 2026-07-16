import json
import unittest

from circuit.x402 import (
    circ_raw_from_usd,
    format_circ,
    parse_402,
    parse_accepted_tokens,
    X402Client,
    HttpResponse,
    PaymentRequiredError,
    SpendCapError,
    PayTokenCapRequiredError,
    RecipientNotAllowedError,
    X402RequestError,
)

QUOTE = {"payment": {"recipient": "T", "amountRaw": "300000000", "amountDisplay": "300.00 CIRC"}}


def resp(status, body):
    return HttpResponse(status, json.dumps(body).encode())


class FakeWallet:
    def __init__(self):
        self.calls = []

    def send_circ(self, recipient, amount_raw):
        self.calls.append((recipient, amount_raw))
        return "SIG123"


class TestX402(unittest.TestCase):
    def test_circ_raw_from_usd_golden(self):
        # GOLDEN VECTORS — byte-identical to circuit-data-api/tests/pricing.test.js + @circuit-llm/x402.
        # Raw-unit ceil: charged fair value, never bumped to the next whole CIRC token.
        self.assertEqual(circ_raw_from_usd(0.0001, 0.0001), 1_000_000)    # 1 CIRC
        self.assertEqual(circ_raw_from_usd(0.0015, 0.001), 1_500_000)     # 1.5 CIRC (old: 2)
        self.assertEqual(circ_raw_from_usd(0.00001, 0.0001), 100_000)     # 0.1 CIRC (old: 1, 10x over)
        self.assertEqual(circ_raw_from_usd(0.03, 0.0001), 300_000_000)    # 300 CIRC
        self.assertEqual(circ_raw_from_usd(0.00015, 0.0001), 1_500_000)   # 1.5 CIRC fair (not 2)
        self.assertEqual(circ_raw_from_usd(0.0001, 0), 1_000_000)         # fallback rate

    def test_format_circ(self):
        self.assertEqual(format_circ(300_000_000), "300.00")

    def test_parse_402(self):
        q = parse_402(QUOTE)
        self.assertEqual(q["recipient"], "T")
        self.assertEqual(q["amount_raw"], 300_000_000)
        self.assertIsNone(parse_402({"error": "x"}))
        self.assertIsNone(parse_402(None))

    def test_pay_and_retry(self):
        n = {"i": 0}
        sent = {}
        w = FakeWallet()

        def transport(method, url, headers, body, timeout):
            n["i"] += 1
            if n["i"] == 1:
                return resp(402, QUOTE)
            sent["hdr"] = headers.get("X-Payment-Signature")
            return resp(200, {"ok": True})

        c = X402Client(wallet=w, transport=transport)
        r = c.get_json("http://x", method="POST")
        self.assertTrue(r["data"]["ok"])
        self.assertEqual(r["payment_tx"], "SIG123")
        self.assertEqual(sent["hdr"], "SIG123")
        self.assertEqual(w.calls, [("T", 300_000_000)])

    def test_no_wallet_raises(self):
        c = X402Client(transport=lambda *a: resp(402, QUOTE))
        with self.assertRaises(PaymentRequiredError):
            c.get_json("http://x")

    def test_spend_cap_blocks_payment(self):
        w = FakeWallet()
        c = X402Client(wallet=w, max_spend_raw=100_000_000, transport=lambda *a: resp(402, QUOTE))
        with self.assertRaises(SpendCapError):
            c.get_json("http://x")
        self.assertEqual(w.calls, [])

    def test_http_error(self):
        c = X402Client(transport=lambda *a: resp(404, {"error": "nope"}))
        with self.assertRaises(X402RequestError):
            c.get_json("http://x")


USDC = {"mint": "USDCmint", "recipient": "COLLECTOR", "amountRaw": "250000", "decimals": 6, "tokenProgram": "spl", "symbol": "USDC"}


def body402(accepted):
    return {"payment": {"recipient": "T", "amountRaw": "300000000", "amountDisplay": "300.00 CIRC"}, "acceptedTokens": accepted}


class FakeTokenWallet:
    def __init__(self):
        self.calls = []

    def send_circ(self, recipient, amount_raw):
        self.calls.append(("circ", recipient, amount_raw)); return "CIRC_SIG"

    def send_token(self, mint, recipient, amount_raw, decimals, token_program):
        self.calls.append(("token", mint, recipient, amount_raw, decimals, token_program)); return "TOKEN_SIG"


class TestPayToken(unittest.TestCase):
    """Mirror of the JS @circuit-llm/x402 payToken smoke suite — same behavior, same fail-closed cap."""

    def _two_step(self, b402):
        n = {"i": 0}

        def transport(method, url, headers, body, timeout):
            n["i"] += 1
            if n["i"] == 1:
                return resp(402, b402)
            assert headers.get("X-Payment-Signature")
            return resp(200, {"ok": True})
        return transport

    def test_pay_in_token(self):
        w = FakeTokenWallet()
        c = X402Client(wallet=w, pay_token="USDCmint", max_pay_token_raw=500_000,
                       allowed_recipients=["COLLECTOR"], transport=self._two_step(body402([USDC])))
        r = c.get_json("http://x")
        self.assertEqual(r["payment_tx"], "TOKEN_SIG")
        self.assertEqual(w.calls, [("token", "USDCmint", "COLLECTOR", 250000, 6, "spl")])
        self.assertEqual(r["quote"]["token"], "USDCmint")
        self.assertEqual(r["quote"]["amount_display"], "0.2500 USDC")

    def test_fallback_to_circ_when_not_offered(self):
        w = FakeTokenWallet()
        c = X402Client(wallet=w, pay_token="USDCmint", transport=self._two_step(body402([])))
        r = c.get_json("http://x")
        self.assertEqual(r["payment_tx"], "CIRC_SIG")
        self.assertEqual(w.calls[0][0], "circ")

    def test_fail_closed_without_cap(self):
        w = FakeTokenWallet()
        c = X402Client(wallet=w, pay_token="USDCmint", transport=lambda *a: resp(402, body402([USDC])))
        with self.assertRaises(PayTokenCapRequiredError):
            c.get_json("http://x")
        self.assertEqual(w.calls, [])

    def test_per_call_cap_enforced(self):
        w = FakeTokenWallet()
        c = X402Client(wallet=w, pay_token="USDCmint", max_pay_token_raw=100_000,
                       transport=lambda *a: resp(402, body402([USDC])))
        with self.assertRaises(SpendCapError):
            c.get_json("http://x")
        self.assertEqual(w.calls, [])

    def test_recipient_guard(self):
        w = FakeTokenWallet()
        c = X402Client(wallet=w, pay_token="USDCmint", max_pay_token_raw=500_000,
                       allowed_recipients=["SOMEONE_ELSE"], transport=lambda *a: resp(402, body402([USDC])))
        with self.assertRaises(RecipientNotAllowedError):
            c.get_json("http://x")
        self.assertEqual(w.calls, [])

    def test_parse_accepted_tokens(self):
        toks = parse_accepted_tokens(body402([USDC]))
        self.assertEqual(len(toks), 1)
        self.assertEqual(toks[0]["mint"], "USDCmint")
        self.assertEqual(toks[0]["amount_raw"], 250000)
        self.assertEqual(toks[0]["token_program"], "spl")
        self.assertEqual(parse_accepted_tokens({}), [])


if __name__ == "__main__":
    unittest.main()
