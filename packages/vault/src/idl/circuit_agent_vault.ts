/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/circuit_agent_vault.json`.
 */
export type CircuitAgentVault = {
  "address": "9AmhsDD9AwUM57pLwYsmNWhjdAP5vTy2HXxqbdKRaxXA",
  "metadata": {
    "name": "circuitAgentVault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "closeVault",
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
                "path": "vault.agentSeed",
                "account": "vault"
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
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.agentSeed",
                "account": "vault"
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
          "name": "systemProgram",
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
      "name": "initVault",
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
                "path": "agentSeed"
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "agentSeed",
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
          "name": "maxTradeLamports",
          "type": "u64"
        },
        {
          "name": "dailyLimitLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setDelegate",
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
                "path": "vault.agentSeed",
                "account": "vault"
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
          "name": "newDelegate",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "setRoutes",
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
                "path": "vault.agentSeed",
                "account": "vault"
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
      "name": "setRule",
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
                "path": "vault.agentSeed",
                "account": "vault"
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
          "name": "maxAge",
          "type": "i64"
        },
        {
          "name": "inMint",
          "type": "pubkey"
        },
        {
          "name": "outMint",
          "type": "pubkey"
        },
        {
          "name": "maxSlippageBps",
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
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.agentSeed",
                "account": "vault"
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
          "name": "vaultInput",
          "writable": true
        },
        {
          "name": "vaultOutput",
          "writable": true
        },
        {
          "name": "swapProgram"
        },
        {
          "name": "tokenProgram"
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
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minOut",
          "type": "u64"
        },
        {
          "name": "swapData",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "unwrapSol",
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
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.agentSeed",
                "account": "vault"
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
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "updateConfig",
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
                "path": "vault.agentSeed",
                "account": "vault"
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
          "name": "maxTradeLamports",
          "type": "u64"
        },
        {
          "name": "dailyLimitLamports",
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
                "path": "vault.agentSeed",
                "account": "vault"
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
      "name": "wrapSol",
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
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.agentSeed",
                "account": "vault"
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
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
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
      "name": "vault",
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
      "name": "delegateSet",
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
      "name": "deposited",
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
      "name": "routesSet",
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
      "name": "ruleSet",
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
      "name": "solUnwrapped",
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
      "name": "solWrapped",
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
      "name": "tradeExecuted",
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
      "name": "vaultInitialized",
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
      "name": "withdrawn",
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
      "name": "notOwner",
      "msg": "only the vault owner may perform this action"
    },
    {
      "code": 6001,
      "name": "insufficientFunds",
      "msg": "amount exceeds the withdrawable balance (rent-exempt minimum is protected)"
    },
    {
      "code": 6002,
      "name": "badAmount",
      "msg": "amount must be greater than zero"
    },
    {
      "code": 6003,
      "name": "overflow",
      "msg": "arithmetic overflow"
    },
    {
      "code": 6004,
      "name": "notDelegate",
      "msg": "only the vault delegate may trade"
    },
    {
      "code": 6005,
      "name": "paused",
      "msg": "trading is paused"
    },
    {
      "code": 6006,
      "name": "overTradeCap",
      "msg": "amount_in exceeds the per-trade cap (or is zero)"
    },
    {
      "code": 6007,
      "name": "badMinOut",
      "msg": "min_out must be greater than zero"
    },
    {
      "code": 6008,
      "name": "overDailyCap",
      "msg": "trade exceeds the daily cap"
    },
    {
      "code": 6009,
      "name": "foreignVaultAccount",
      "msg": "the swap may not touch another vault-owned token account"
    },
    {
      "code": 6010,
      "name": "inputIncreased",
      "msg": "vault input balance increased — not a swap"
    },
    {
      "code": 6011,
      "name": "outputDecreased",
      "msg": "vault output balance decreased — value left the vault"
    },
    {
      "code": 6012,
      "name": "slippage",
      "msg": "received less than min_out (value left the vault / slippage)"
    },
    {
      "code": 6013,
      "name": "approvalGranted",
      "msg": "an approval/delegate was granted on a vault account"
    },
    {
      "code": 6014,
      "name": "authorityChanged",
      "msg": "a vault account's authority/mint/ownership changed"
    },
    {
      "code": 6015,
      "name": "notOwnerOrDelegate",
      "msg": "only the vault owner or delegate may wrap/unwrap"
    },
    {
      "code": 6016,
      "name": "notWsol",
      "msg": "the account is not a wrapped-SOL (native mint) account"
    },
    {
      "code": 6017,
      "name": "tooManyRoutes",
      "msg": "at most 4 allowed route programs"
    },
    {
      "code": 6018,
      "name": "routeNotAllowed",
      "msg": "swap program is not in the vault's route allowlist"
    },
    {
      "code": 6019,
      "name": "badRule",
      "msg": "invalid rule (op must be 0..=4; max_age required when active)"
    },
    {
      "code": 6020,
      "name": "noOracleSig",
      "msg": "no Ed25519 oracle-signature instruction found in the transaction"
    },
    {
      "code": 6021,
      "name": "wrongOracle",
      "msg": "the signed price is not from the vault's committed oracle"
    },
    {
      "code": 6022,
      "name": "badAttestation",
      "msg": "malformed oracle attestation / Ed25519 instruction"
    },
    {
      "code": 6023,
      "name": "wrongFeed",
      "msg": "the attestation is for a different price feed"
    },
    {
      "code": 6024,
      "name": "staleAttestation",
      "msg": "the oracle price is stale (outside the freshness window)"
    },
    {
      "code": 6025,
      "name": "ruleNotSatisfied",
      "msg": "the trade is not justified by the committed rule (price condition not met)"
    },
    {
      "code": 6026,
      "name": "wrongDirection",
      "msg": "the trade's mints don't match the rule's pinned direction"
    },
    {
      "code": 6027,
      "name": "priceFloor",
      "msg": "min_out is below the oracle-attested execution floor (bad rate)"
    },
    {
      "code": 6028,
      "name": "lamportsDecreased",
      "msg": "the swap debited the vault's native lamports"
    }
  ],
  "types": [
    {
      "name": "delegateSet",
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
      "name": "deposited",
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
      "name": "routesSet",
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
      "name": "ruleSet",
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
      "name": "solUnwrapped",
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
      "name": "solWrapped",
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
      "name": "tradeExecuted",
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
      "name": "vault",
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
            "name": "agentSeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxTradeLamports",
            "type": "u64"
          },
          {
            "name": "dailyLimitLamports",
            "type": "u64"
          },
          {
            "name": "dayStartTs",
            "type": "i64"
          },
          {
            "name": "daySpentLamports",
            "type": "u64"
          },
          {
            "name": "lastTradeTs",
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
            "name": "ruleFeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "ruleOp",
            "type": "u8"
          },
          {
            "name": "ruleThreshold",
            "type": "i64"
          },
          {
            "name": "ruleMaxAge",
            "type": "i64"
          },
          {
            "name": "ruleInMint",
            "type": "pubkey"
          },
          {
            "name": "ruleOutMint",
            "type": "pubkey"
          },
          {
            "name": "maxSlippageBps",
            "type": "u16"
          },
          {
            "name": "allowedPrograms",
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
      "name": "vaultInitialized",
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
      "name": "withdrawn",
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
