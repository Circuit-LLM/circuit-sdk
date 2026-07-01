"""Default Circuit configuration (mirrors @circuit-llm/core). Inject overrides per client."""

CIRC_MINT = "8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump"
CIRC_TOKEN_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
CIRC_DECIMALS = 6

DEFAULT_CONFIG = {
    "endpoints": {
        "inference": "https://inference.circuitllm.xyz/v1",
        "data": "https://api.circuitllm.xyz",
    },
    "rpc_url": "https://api.mainnet-beta.solana.com",
    "circ_mint": CIRC_MINT,
    "circ_decimals": CIRC_DECIMALS,
    "model": "circuit",
}
