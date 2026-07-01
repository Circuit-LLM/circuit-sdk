# circuit-py

The Python consume client for the [Circuit](https://circuitllm.xyz) ecosystem — **x402-paid
decentralized inference + data**, settled per call in CIRC. No API keys: a wallet is the account
and the meter. (The TypeScript SDK lives in this repo's [`packages/`](../packages); this mirrors its
consume surface for Python.)

Stdlib-only core — bring your own `PaymentWallet` (anything with `send_circ(recipient, amount_raw) -> str`,
e.g. built on `solders`) to actually pay.

```python
from circuit import Inference, Data

ai = Inference(wallet=my_wallet)          # pays CIRC per call (x402), automatically
out = ai.chat([{"role": "user", "content": "hi"}])
print(out["content"])

px = Data(wallet=my_wallet).token_price("8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump")
```

Cap per-call spend with `max_spend_raw=...`, or set `internal_key=...` to bypass payment on trusted
hosts. The HTTP transport is injectable (`transport=...`) for testing without a network.

```bash
python3 -m unittest discover -s tests   # run from this directory
```

**Scope:** `Inference` (chat, list_models) + `Data` (typed endpoints) + the `X402Client` spine.
Streaming, a built-in Solana wallet, and the node/agent surfaces are currently TypeScript-only.
