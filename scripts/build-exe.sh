#!/usr/bin/env bash
# ============================================================================
# nashat-vpn — build a single double-clickable Windows EXE (Node SEA)
#
#   bash scripts/build-exe.sh
#
# Output: dist/NashatVPN.exe  (+ sing-box.exe copied beside it)
# Ship both files together — NashatVPN.exe finds its engine automatically.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> [1/5] Bundling CLI with esbuild"
npx esbuild cli/vpn.js --bundle --platform=node --target=node22 \
    --outfile=dist/nashat-vpn-cli.js

echo "==> [2/5] Generating SEA blob"
node --experimental-sea-config sea-config.json

echo "==> [3/5] Copying Node runtime as NashatVPN.exe"
cp "$(command -v node)" dist/NashatVPN.exe

echo "==> [4/5] Injecting the app into the EXE"
npx postject dist/NashatVPN.exe NODE_SEA_BLOB dist/sea-prep.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

echo "==> [5/5] Placing engine next to the EXE"
cp engine/sing-box.exe dist/sing-box.exe

echo
ls -la dist/ | grep -E 'NashatVPN|sing-box'
echo
echo "Done. Distribute dist/NashatVPN.exe + dist/sing-box.exe together."
echo "Try it:  ./dist/NashatVPN.exe status"
