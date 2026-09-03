#!/usr/bin/env bash
#
# Bring the whole thing up with one command: fork, contracts, funding, keeper, app.
#
# Every step waits for the thing it started to actually answer before moving on, so a
# failure stops here with a named cause rather than three steps later with a confusing
# one. Re-running is safe: it reuses a fork that is already up.
#
# Usage: pnpm demo            # fork Monad mainnet, deploy, fund, serve on :3000
#        pnpm demo --fresh    # kill an existing fork first and start clean
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC=${RPC_URL:-http://127.0.0.1:8545}
PORT=${PORT:-3000}
FORK_URL=${FORK_URL:-https://rpc.monad.xyz}
OWNER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
KURU_BOOK=${KURU_MON_AUSD:-0x131a2e70a5b31a517a74b8c567149bc294470da9}
# Real Agora AUSD on Monad mainnet. Unset, the deploy quietly falls back to its own
# test token, and everything downstream that expects the real one breaks confusingly.
AUSD_ADDR=${AUSD:-0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a}
# Logs live beside the repo, not in /tmp: on a machine whose root volume is tight, a
# long fork run filling /tmp takes the whole toolchain down with it.
LOGS=${LOGS:-$ROOT/.xorr-logs}
mkdir -p "$LOGS"

step() { printf '\n\033[1m→ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# Wait for a command to succeed, or give up with the reason.
wait_for() {
  local what=$1 tries=$2; shift 2
  for _ in $(seq "$tries"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  fail "$what did not come up. See $LOGS/"
}

if [ "${1:-}" = "--fresh" ]; then
  step "stopping anything already running"
  pkill -f "tools/keeper.mjs" 2>/dev/null || true
  # Only our own fork on this port, never someone else's dev server.
  pkill -f "anvil --fork-url" 2>/dev/null || true
  sleep 1
fi

# ---------------------------------------------------------------- 1. the fork
if cast block-number --rpc-url "$RPC" >/dev/null 2>&1; then
  step "fork already up at $RPC (block $(cast block-number --rpc-url "$RPC"))"
else
  step "forking Monad mainnet at 300ms"
  command -v anvil >/dev/null || fail "anvil not found. Install Foundry: https://getfoundry.sh"
  nohup anvil --fork-url "$FORK_URL" --block-time 0.3 --chain-id 143 --silent \
    > "$LOGS/anvil.log" 2>&1 &
  wait_for "the fork" 60 cast block-number --rpc-url "$RPC"
  echo "  forked at block $(cast block-number --rpc-url "$RPC")"
fi

# ------------------------------------------------------------- 2. the contracts
step "deploying contracts (with Kuru's book wired in)"
( cd "$ROOT/packages/contracts" && \
  PRIVATE_KEY="$OWNER_PK" KURU_MON_AUSD="$KURU_BOOK" AUSD="$AUSD_ADDR" \
  forge script script/Deploy.s.sol:Deploy --broadcast --rpc-url "$RPC" \
  > "$LOGS/deploy.log" 2>&1 ) || { tail -30 "$LOGS/deploy.log"; fail "deploy failed"; }

DEPLOYMENT="$ROOT/packages/contracts/deployments/143.json"
[ -f "$DEPLOYMENT" ] || fail "deploy wrote no deployment file"
RANGE=$(python3 -c "import json;print(json.load(open('$DEPLOYMENT'))['rangeMarket'])")
KURU_ORACLE=$(python3 -c "import json;print(json.load(open('$DEPLOYMENT')).get('kuruOracle',''))")
echo "  rangeMarket $RANGE"
[ -n "$KURU_ORACLE" ] || fail "no kuruOracle in the deployment — KURU_MON_AUSD was not picked up, \
and the order-book integration would be silently absent"
echo "  kuruOracle  $KURU_ORACLE"

DEPLOYED_AUSD=$(python3 -c "import json;print(json.load(open('$DEPLOYMENT'))['ausd'])")
if [ "$(echo "$DEPLOYED_AUSD" | tr 'A-Z' 'a-z')" != "$(echo "$AUSD_ADDR" | tr 'A-Z' 'a-z')" ]; then
  fail "deploy used $DEPLOYED_AUSD, not the AUSD asked for ($AUSD_ADDR). That is the test \
token, so nothing downstream is running against the real stablecoin."
fi
echo "  ausd        $DEPLOYED_AUSD (real Agora AUSD)"

# ------------------------------------------------------ 3. funding and the keeper
step "funding the vault from a real AUSD holder, starting the keeper"
"$ROOT/tools/setup-local.sh" > "$LOGS/setup.log" 2>&1 \
  || { tail -20 "$LOGS/setup.log"; fail "setup failed"; }
tail -3 "$LOGS/setup.log"

step "waiting for the keeper's first price"
wait_for "the keeper" 40 grep -q published "$LOGS/keeper.log"
echo "  $(grep -c published "$LOGS/keeper.log") publication(s)"

# ------------------------------------------------------------------- 4. the app
step "building the console"
( cd "$ROOT" && pnpm --filter @xorr/web build > "$LOGS/build.log" 2>&1 ) \
  || { tail -25 "$LOGS/build.log"; fail "build failed"; }

step "serving on :$PORT"
( cd "$ROOT/apps/web" && nohup pnpm start -p "$PORT" > "$LOGS/web.log" 2>&1 & )
wait_for "the app" 40 curl -fsS "http://localhost:$PORT/api/health"

HEALTH=$(curl -fsS "http://localhost:$PORT/api/health")
echo
python3 - "$HEALTH" <<'PY'
import json, sys
h = json.loads(sys.argv[1])
print(f"  chain    {h['chain']['status']}  block {h['chain'].get('block','—')}")
print(f"  keeper   {h['keeper']['status']}  {h['keeper'].get('detail','')}")
print(f"  book     {h['book']['status']}  {h['book'].get('detail','')}")
PY

cat <<EOF

  Open http://localhost:$PORT

  Verify the claims:
    pnpm check:kuru     the price is Kuru's book, and a thin book returns nothing
    pnpm parity         1,728 quotes identical between Solidity and TypeScript
    pnpm check:chain    the deployed contract quotes what the SDK quotes
    pnpm check:edge     every round is vault-positive on four windows of real tape

  Logs in $LOGS/
EOF
