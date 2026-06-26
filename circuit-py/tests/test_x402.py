import json
import unittest

from circuit.x402 import (
    circ_raw_from_usd,
    format_circ,
    parse_402,
    X402Client,
    HttpResponse,
    PaymentRequiredError,
    SpendCapError,
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
    def test_circ_raw_from_usd_rounds_up(self):
        self.assertEqual(circ_raw_from_usd(0.03, 0.0001), 300_000_000)
        self.assertEqual(circ_raw_from_usd(0.00015, 0.0001), 2_000_000)  # 1.5 → ceil 2
        self.assertEqual(circ_raw_from_usd(0.0001, 0), 1_000_000)  # fallback rate

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


if __name__ == "__main__":
    unittest.main()
