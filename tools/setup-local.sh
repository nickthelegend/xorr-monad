#!/usr/bin/env bash
#
# Wire a freshly deployed XORR to the local fork: fund the vault with real AUSD,
# point the web app at the new addresses, and start the keeper on its own account.
#
# Assumes anvil is forking Monad mainnet:
#   anvil --fork-url https://rpc.monad.xyz --block-time 0.3 --chain-id 143
#
# Usage: tools/setup-local.sh [vaultAusdUnits] [playerAusdUnits]
set -euo pipefail


ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC=${RPC_URL:-http://127.0.0.1:8545}
DEPLOYMENT="$ROOT/packages/contracts/deployments/143.json"

VAULT_FUND=${1:-3000000000}   # $3,000
PLAYER_FUND=${2:-500000000}   # $500

# anvil dev accounts: 0 owner/LP, 1 player, 2 keeper
OWNER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
PLAYER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
KEEPER_PK=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
KEEPER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# Real Agora AUSD on Monad mainnet, and a real holder to source it from on the fork.
AUSD=0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a
WHALE=0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5

jqf() { python3 -c "import json,sys;print(json.load(open('$DEPLOYMENT'))['$1'])"; }
ORACLE=$(jqf oracle); VAULT=$(jqf vault); RANGE=$(jqf rangeMarket); ROOM=$(jqf roomMarket)
# The keeper publishes to the feed, not to the router that dispatches to it.
FEED=$(python3 -c "import json;d=json.load(open('$DEPLOYMENT'));print(d.get('feedOracle') or d['oracle'])")
DEPLOY_BLOCK=$(jqf deployBlock)

echo "→ funding from a real AUSD holder"
cast rpc --rpc-url "$RPC" anvil_impersonateAccount "$WHALE" >/dev/null
cast rpc --rpc-url "$RPC" anvil_setBalance "$WHALE" 0x56BC75E2D63100000 >/dev/null

# Take what the holder actually has, not what we hoped for.
#
# This is a real address on a forked chain, and repeated setups draw it down. Asking
# for a fixed amount worked until it did not, and then failed with a raw
# ERC20InsufficientBalance in the middle of a script whose next steps quietly carried
# on with stale addresses.
HELD=$(cast call --rpc-url "$RPC" "$AUSD" "balanceOf(address)(uint256)" "$WHALE" 2>/dev/null | awk '{print $1+0}')
HELD=${HELD:-0}
WANTED=$((VAULT_FUND + PLAYER_FUND))
if [ "$HELD" -lt "$WANTED" ]; then
  echo "   holder has $HELD units, wanted $WANTED — scaling down"
  # Keep the player's share whole where possible; the vault takes the remainder.
  if [ "$HELD" -gt "$PLAYER_FUND" ]; then
    VAULT_FUND=$((HELD - PLAYER_FUND))
  else
    PLAYER_FUND=$((HELD / 2))
    VAULT_FUND=$((HELD - PLAYER_FUND))
  fi
fi
if [ "$VAULT_FUND" -le 0 ] || [ "$PLAYER_FUND" -le 0 ]; then
  echo "   The AUSD holder on this fork is empty." >&2
  echo "   Repeated setups draw it down; restart anvil to reset the fork:" >&2
  echo "     pnpm chain" >&2
  exit 1
fi

cast send --rpc-url "$RPC" --unlocked --from "$WHALE" "$AUSD" \
  "transfer(address,uint256)(bool)" "$OWNER" "$VAULT_FUND" >/dev/null
cast send --rpc-url "$RPC" --unlocked --from "$WHALE" "$AUSD" \
  "transfer(address,uint256)(bool)" "$PLAYER" "$PLAYER_FUND" >/dev/null
cast rpc --rpc-url "$RPC" anvil_stopImpersonatingAccount "$WHALE" >/dev/null

echo "→ seeding the vault"
cast send --rpc-url "$RPC" --private-key "$OWNER_PK" "$AUSD" \
  "approve(address,uint256)(bool)" "$VAULT" "$VAULT_FUND" >/dev/null
cast send --rpc-url "$RPC" --private-key "$OWNER_PK" "$VAULT" \
  "deposit(uint256)(uint256)" "$VAULT_FUND" >/dev/null

echo "→ authorising the keeper"
cast send --rpc-url "$RPC" --private-key "$OWNER_PK" "$FEED" \
  "setUpdater(address,bool)" "$KEEPER" true >/dev/null

echo "→ pointing the web app at the deployment"
cat > "$ROOT/apps/web/.env.local" <<ENV
# Local fork of Monad mainnet (chain 143), started with:
#   anvil --fork-url https://rpc.monad.xyz --block-time 0.3 --chain-id 143
#
# Real Monad state, real Agora AUSD, real deployed XORR contracts, real signed
# transactions, 300ms blocks. No real money moves.
NEXT_PUBLIC_CHAIN_ID=143
# The browser reaches the chain through the app's own /api/rpc proxy: no CORS, and the
# upstream endpoint never ships in the client bundle.
NEXT_PUBLIC_RPC_URL=/api/rpc
RPC_UPSTREAM=$RPC
# Local fork only: lets the node sign for its own unlocked dev accounts.
XORR_ALLOW_UNLOCKED_ACCOUNTS=1
NEXT_PUBLIC_AUSD=$AUSD
NEXT_PUBLIC_ORACLE=$ORACLE
NEXT_PUBLIC_KURU_ORACLE=$(jqf kuruOracle)
NEXT_PUBLIC_KURU_BOOK=$(jqf kuruBook)
NEXT_PUBLIC_VAULT=$VAULT
NEXT_PUBLIC_RANGE_MARKET=$RANGE
NEXT_PUBLIC_ROOM_MARKET=$ROOM
NEXT_PUBLIC_DEPLOY_BLOCK=$DEPLOY_BLOCK
ENV

echo "→ restarting the keeper on its own account"
pkill -f "tools/keeper.mjs" 2>/dev/null || true
sleep 1
( cd "$ROOT" && PRIVATE_KEY="$KEEPER_PK" nohup node tools/keeper.mjs > /tmp/keeper.log 2>&1 & )
sleep 8

echo
echo "vault     $VAULT  $(cast call --rpc-url "$RPC" "$VAULT" 'totalAssets()(uint256)') AUSD units"
echo "player    $PLAYER  $(cast call --rpc-url "$RPC" "$AUSD" 'balanceOf(address)(uint256)' "$PLAYER") AUSD units"
echo "keeper    $(grep -c published /tmp/keeper.log || echo 0) price publications so far"
