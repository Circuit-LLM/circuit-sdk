#!/usr/bin/env bash
# Publish all @circuit-llm/* packages to npm in dependency order (leaves first, meta last),
# so no package is ever published before something it depends on.
#
# Prerequisites:
#   - npm login  (an account with publish rights on the @circuit-llm scope)
#   - a clean, committed working tree at the version you intend to publish
#
# Usage:
#   scripts/publish.sh --dry-run      # inspect what would publish, change nothing
#   scripts/publish.sh                # publish for real
#   scripts/publish.sh --otp 123456   # pass a 2FA one-time password through to npm
#
# Each `npm publish` runs the package's prepack (tsup build), so dist/ is always fresh.
# circuit-py publishes to PyPI separately (see RELEASE.md).
set -euo pipefail

cd "$(dirname "$0")/.."

# Tiers — every package's internal deps live in an earlier tier.
TIERS=(
  "core x402 bundle vault"     # zero internal deps
  "attest wallet node onchain" # need core / x402
  "inference data"             # need core / x402 / attest
  "agent plugins"              # agent: inference/data/attest · plugins: core/data/x402
  "sdk"                        # the meta-package — depends on all
)

for tier in "${TIERS[@]}"; do
  for pkg in $tier; do
    echo "==> npm publish @circuit-llm/$pkg $*"
    npm publish -w "@circuit-llm/$pkg" "$@"
  done
done

echo
echo "Done. TypeScript packages published in dependency order."
echo "Remember: circuit-py goes to PyPI separately (python -m build && twine upload)."
