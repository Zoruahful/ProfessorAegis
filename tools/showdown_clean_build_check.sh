#!/usr/bin/env bash
set -euo pipefail

BOT_ROOT="/home/zoruah/Storage/Home/Development/Discord/Bots/Professor-Aegis"
SHOWDOWN_DIR="$BOT_ROOT/pokemon-showdown"

cd "$SHOWDOWN_DIR"

echo "[Aegis] Cleaning Pokémon Showdown dist..."
rm -rf dist

echo "[Aegis] Installing dependencies..."
npm install

echo "[Aegis] Building Pokémon Showdown..."
npm run build

echo "[Aegis] Checking generated files..."
node --check dist/data/text/moves.js
node --check dist/data/learnsets.js

echo "[Aegis] Checking BattleStream export..."
node -e "const {BattleStream}=require('./dist/sim/battle-stream'); if (typeof BattleStream !== 'function') { console.error('BattleStream is not a function:', typeof BattleStream); process.exit(1); } console.log('BattleStream:', typeof BattleStream);"

echo "[Aegis] Showdown clean build check passed."
echo "[Aegis] Restart from bot root with: pm2 restart all --update-env"
