import json
import unittest

from circuit.x402 import HttpResponse
from circuit.inference import Inference
from circuit.data import Data

QUOTE = {"payment": {"recipient": "T", "amountRaw": "10000000", "amountDisplay": "10 CIRC"}}


def resp(status, body):
    return HttpResponse(status, json.dumps(body).encode())


class FakeWallet:
    def send_circ(self, recipient, amount_raw):
        return "PAY"


class TestInference(unittest.TestCase):
    def test_chat_pays_then_returns_content(self):
        n = {"i": 0}

        def t(method, url, headers, body, timeout):
            n["i"] += 1
            if n["i"] == 1:
                return resp(402, QUOTE)
            return resp(200, {"choices": [{"message": {"content": " Hi "}}], "usage": {"completion_tokens": 1}})

        ai = Inference(wallet=FakeWallet(), transport=t)
        r = ai.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(r["content"], "Hi")
        self.assertEqual(r["payment_tx"], "PAY")
        self.assertEqual(r["usage"]["completion_tokens"], 1)

    def test_list_models(self):
        ai = Inference(transport=lambda *a: resp(200, {"data": [{"id": "circuit"}, {"id": "qwen"}]}))
        self.assertEqual(ai.list_models(), ["circuit", "qwen"])

    def test_internal_key_header(self):
        seen = {}

        def t(method, url, headers, body, timeout):
            seen["key"] = headers.get("X-Internal-Key")
            return resp(200, {"choices": [{"message": {"content": "ok"}}]})

        ai = Inference(transport=t, internal_key="SECRET")
        ai.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(seen["key"], "SECRET")


class TestData(unittest.TestCase):
    def test_token_price_builds_query(self):
        seen = {}

        def t(method, url, headers, body, timeout):
            seen["url"] = url
            return resp(200, {"price": 0.04})

        d = Data(base_url="https://api.test", transport=t)
        r = d.token_price("MINT")
        self.assertEqual(r["price"], 0.04)
        self.assertEqual(seen["url"], "https://api.test/api/token-price?mint=MINT")

    def test_paid_endpoint_pays(self):
        n = {"i": 0}

        def t(method, url, headers, body, timeout):
            n["i"] += 1
            return resp(402, QUOTE) if n["i"] == 1 else resp(200, {"v": 1})

        d = Data(wallet=FakeWallet(), base_url="https://api.test", transport=t)
        self.assertEqual(d.market_overview()["v"], 1)


if __name__ == "__main__":
    unittest.main()
