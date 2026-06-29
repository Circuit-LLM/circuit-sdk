// Vendored Anchor IDL for circuit-agent-vault, inlined as a TS module so the package builds to a single
// dist file with no JSON import attributes (tsup's dts step does not support them). Regenerate from
// the vault repo: anchor build, then wrap target/idl/circuit_agent_vault.json. Program id is embedded.
const idl: unknown = {
  "address": "9AmhsDD9AwUM57pLwYsmNWhjdAP5vTy2HXxqbdKRaxXA",
  "metadata": {
    "name": "circuit_agent_vault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "close_vault",
      "docs": [
        "OWNER-ONLY. Close the vault and return ALL remaining lamports to the owner (Anchor `close`).",
        "Phase 1 is SOL-only; Phase 3 adds a guard that token balances are zero before close."
      ],
      "discriminator": [
        141,
        103,
        17,
        126,
        72,
        75,
        29,
        29
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.agent_seed",
                "account": "Vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "deposit",
      "docs": [
        "Fund the vault with SOL. Anyone may deposit (it's the owner's address either way); the",
        "owner is the only one who can ever take it back out."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "Vault"
              },
              {
                "kind": "account",
                "path": "vault.agent_seed",
                "account": "Vault"
              }
            ]
          }
        },
        {
          "name": "depositor",
          "writable": true,
          "signer": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "init_vault",
      "docs": [
        "Create a vault. The signer becomes the sovereign OWNER; `delegate` is the agent key that",
        "will (Phase 2) be allowed to trade but never withdraw. One vault per (owner, agent_seed)."
      ],
      "discriminator": [
        77,
        79,
        85,
        150,
        33,
        217,
        52,
        106
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "agent_seed"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "agent_seed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "delegate",
          "type": "pubkey"
        },
        {
          "name": "max_trade_lamports",
          "type": "u64"
        },
        {
          "name": "daily_limit_lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "set_delegate",
      "docs": [
        "OWNER-ONLY. Rotate or revoke the agent's trading key. Bumps `epoch` so a stale delegate is",
        "fenced out (Phase 2 trades check it)."
      ],
      "discriminator": [
        242,
        30,
        46,
        76,
        108,
        235,
        128,
        181
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.agent_seed",
                "account": "Vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "new_delegate",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "set_routes",
      "docs": [
        "OWNER-ONLY. Set the route allowlist (up to 4 swap programs). Pass an empty list to clear it",
        "(back to any-program / guard-only). Defense in depth: lock trading to audited routers so the",
        "guard isn't the sole boundary."
      ],
      "discriminator": [
        95,
        172,
        119,
        157,
        123,
        127,
        91,
        208
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.agent_seed",
                "account": "Vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "programs",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    },
    {
      "name": "set_rule",
      "docs": [
        "OWNER-ONLY. Commit (or clear) the Verified-Intents price rule. `op == 0` disables it. When set,",
        "every trade must present a fresh `oracle`-signed price for `feed` satisfying `price <op> threshold`",
        "(verified via an Ed25519 sibling instruction). This is enforced by the chain, not a server."
      ],
      "discriminator": [
        237,
        148,
        178,
        172,
        127,
        70,
        114,
        103
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.agent_seed",
                "account": "Vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "oracle",
          "type": "pubkey"
        },
        {
          "name": "feed",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "op",
          "type": "u8"
        },
        {
          "name": "threshold",
          "type": "i64"
        },
        {
          "name": "max_age",
          "type": "i64"
        },
        {
          "name": "in_mint",
          "type": "pubkey"
        },
        {
          "name": "out_mint",
          "type": "pubkey"
        },
        {
          "name": "max_slippage_bps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "trade",
      "docs": [
        "DELEGATE-ONLY. Execute a swap through ANY program (the agent supplies the program + accounts +",
        "data via remaining_accounts), then GUARD the result on the vault's OWN accounts:",
        "• the vault spends at most `amount_in` of the input, and",
        "• receives at least `min_out` of the output  ← the anti-theft line, and",
        "• no OTHER vault-owned token account is involved, and",
        "• NO approval/authority/ownership changed (catches approve / setAuthority that move no balance).",
        "The route is untrusted; the OUTCOME is verified. That's what makes \"trade anything, can't",
        "extract\" true. (Phase 2: cap is in input base units; SOL-notional + slippage-vs-quote is Phase 3.)"
      ],
      "discriminator": [
        178,
        144,
        26,
        216,
        241,
        187,
        206,
        130
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "Vault"
              },
              {
                "kind": "account",
                "path": "vault.agent_seed",
                "account": "Vault"
              }
            ]
          }
        },
        {
          "name": "delegate",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault_input",
          "writable": true
        },
        {
          "name": "vault_output",
          "writable": true
        },
        {
          "name": "swap_program"
        },
        {
          "name": "token_program"
        },
        {
          "name": "instructions",
          "docs": [
            "(Verified Intents). Address-checked; only read when a rule is active."
          ],
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount_in",
          "type": "u64"
        },
        {
          "name": "min_out",
          "type": "u64"
        },
        {
          "name": "swap_data",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "unwrap_sol",
      "docs": [
        "OWNER-ONLY. Close the vault's wSOL account, returning ALL its lamports (rent + wrapped SOL) to the",
        "vault PDA as native SOL — destination is the vault ONLY, never arbitrary. Owner-only (not delegate):",
        "the agent trades in wSOL and never needs to unwrap; restricting it removes a delegate rent-griefing",
        "vector (repeatedly closing the wSOL account) at no cost to the trading flow (audit hardening)."
      ],
      "discriminator": [
        99,
        40,
        14,
        105,
        45,
        107,
        172,
        201
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "Vault"
              },
              {
                "kind": "account",
                "path": "vault.agent_seed",
                "account": "Vault"
              }
            ]
          }
        },
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "wsol",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "update_config",
      "docs": [
        "OWNER-ONLY. Update trading policy + the pause kill-switch. Withdraw still works when paused",
        "(the owner is always sovereign over their funds)."
      ],
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.agent_seed",
                "account": "Vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "max_trade_lamports",
          "type": "u64"
        },
        {
          "name": "daily_limit_lamports",
          "type": "u64"
        },
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "OWNER-ONLY. Move SOL out of the vault to the owner. The rent-exempt minimum is protected",
        "so the account stays alive. This is the only exit in Phase 1; the delegate has no path here."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.agent_seed",
                "account": "Vault"
              }
            ]
          }
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "wrap_sol",
      "docs": [
        "OWNER-or-DELEGATE. Fund the vault's wSOL trading account with `amount` SOL from the ACTOR's",
        "wallet (system transfer + sync_native). wSOL is what DEXes trade; the agent then swaps it for",
        "tokens via `trade`. Typically the owner calls this to provide trading capital (the agent has no",
        "funds of its own). The wSOL account is authority'd by the vault, so the actor can't redirect it."
      ],
      "discriminator": [
        47,
        62,
        155,
        172,
        131,
        205,
        37,
        201
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "Vault"
              },
              {
                "kind": "account",
                "path": "vault.agent_seed",
                "account": "Vault"
              }
            ]
          }
        },
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "wsol",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "Vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "DelegateSet",
      "discriminator": [
        103,
        126,
        239,
        131,
        201,
        31,
        212,
        253
      ]
    },
    {
      "name": "Deposited",
      "discriminator": [
        111,
        141,
        26,
        45,
        161,
        35,
        100,
        57
      ]
    },
    {
      "name": "RoutesSet",
      "discriminator": [
        187,
        180,
        223,
        221,
        112,
        127,
        192,
        36
      ]
    },
    {
      "name": "RuleSet",
      "discriminator": [
        141,
        22,
        70,
        140,
        45,
        27,
        175,
        119
      ]
    },
    {
      "name": "SolUnwrapped",
      "discriminator": [
        251,
        11,
        67,
        67,
        145,
        148,
        119,
        192
      ]
    },
    {
      "name": "SolWrapped",
      "discriminator": [
        13,
        17,
        193,
        193,
        199,
        177,
        177,
        23
      ]
    },
    {
      "name": "TradeExecuted",
      "discriminator": [
        41,
        110,
        64,
        129,
        60,
        79,
        179,
        80
      ]
    },
    {
      "name": "VaultInitialized",
      "discriminator": [
        180,
        43,
        207,
        2,
        18,
        71,
        3,
        75
      ]
    },
    {
      "name": "Withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "NotOwner",
      "msg": "only the vault owner may perform this action"
    },
    {
      "code": 6001,
      "name": "InsufficientFunds",
      "msg": "amount exceeds the withdrawable balance (rent-exempt minimum is protected)"
    },
    {
      "code": 6002,
      "name": "BadAmount",
      "msg": "amount must be greater than zero"
    },
    {
      "code": 6003,
      "name": "Overflow",
      "msg": "arithmetic overflow"
    },
    {
      "code": 6004,
      "name": "NotDelegate",
      "msg": "only the vault delegate may trade"
    },
    {
      "code": 6005,
      "name": "Paused",
      "msg": "trading is paused"
    },
    {
      "code": 6006,
      "name": "OverTradeCap",
      "msg": "amount_in exceeds the per-trade cap (or is zero)"
    },
    {
      "code": 6007,
      "name": "BadMinOut",
      "msg": "min_out must be greater than zero"
    },
    {
      "code": 6008,
      "name": "OverDailyCap",
      "msg": "trade exceeds the daily cap"
    },
    {
      "code": 6009,
      "name": "ForeignVaultAccount",
      "msg": "the swap may not touch another vault-owned token account"
    },
    {
      "code": 6010,
      "name": "InputIncreased",
      "msg": "vault input balance increased — not a swap"
    },
    {
      "code": 6011,
      "name": "OutputDecreased",
      "msg": "vault output balance decreased — value left the vault"
    },
    {
      "code": 6012,
      "name": "Slippage",
      "msg": "received less than min_out (value left the vault / slippage)"
    },
    {
      "code": 6013,
      "name": "ApprovalGranted",
      "msg": "an approval/delegate was granted on a vault account"
    },
    {
      "code": 6014,
      "name": "AuthorityChanged",
      "msg": "a vault account's authority/mint/ownership changed"
    },
    {
      "code": 6015,
      "name": "NotOwnerOrDelegate",
      "msg": "only the vault owner or delegate may wrap/unwrap"
    },
    {
      "code": 6016,
      "name": "NotWsol",
      "msg": "the account is not a wrapped-SOL (native mint) account"
    },
    {
      "code": 6017,
      "name": "TooManyRoutes",
      "msg": "at most 4 allowed route programs"
    },
    {
      "code": 6018,
      "name": "RouteNotAllowed",
      "msg": "swap program is not in the vault's route allowlist"
    },
    {
      "code": 6019,
      "name": "BadRule",
      "msg": "invalid rule (op must be 0..=4; max_age required when active)"
    },
    {
      "code": 6020,
      "name": "NoOracleSig",
      "msg": "no Ed25519 oracle-signature instruction found in the transaction"
    },
    {
      "code": 6021,
      "name": "WrongOracle",
      "msg": "the signed price is not from the vault's committed oracle"
    },
    {
      "code": 6022,
      "name": "BadAttestation",
      "msg": "malformed oracle attestation / Ed25519 instruction"
    },
    {
      "code": 6023,
      "name": "WrongFeed",
      "msg": "the attestation is for a different price feed"
    },
    {
      "code": 6024,
      "name": "StaleAttestation",
      "msg": "the oracle price is stale (outside the freshness window)"
    },
    {
      "code": 6025,
      "name": "RuleNotSatisfied",
      "msg": "the trade is not justified by the committed rule (price condition not met)"
    },
    {
      "code": 6026,
      "name": "WrongDirection",
      "msg": "the trade's mints don't match the rule's pinned direction"
    },
    {
      "code": 6027,
      "name": "PriceFloor",
      "msg": "min_out is below the oracle-attested execution floor (bad rate)"
    },
    {
      "code": 6028,
      "name": "LamportsDecreased",
      "msg": "the swap debited the vault's native lamports"
    }
  ],
  "types": [
    {
      "name": "DelegateSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Deposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "RoutesSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "count",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "RuleSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "op",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "SolUnwrapped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "SolWrapped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "TradeExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "received",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Vault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "agent_seed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "max_trade_lamports",
            "type": "u64"
          },
          {
            "name": "daily_limit_lamports",
            "type": "u64"
          },
          {
            "name": "day_start_ts",
            "type": "i64"
          },
          {
            "name": "day_spent_lamports",
            "type": "u64"
          },
          {
            "name": "last_trade_ts",
            "type": "i64"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "rule_feed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "rule_op",
            "type": "u8"
          },
          {
            "name": "rule_threshold",
            "type": "i64"
          },
          {
            "name": "rule_max_age",
            "type": "i64"
          },
          {
            "name": "rule_in_mint",
            "type": "pubkey"
          },
          {
            "name": "rule_out_mint",
            "type": "pubkey"
          },
          {
            "name": "max_slippage_bps",
            "type": "u16"
          },
          {
            "name": "allowed_programs",
            "type": {
              "array": [
                "pubkey",
                4
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "VaultInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "Withdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
export default idl;
