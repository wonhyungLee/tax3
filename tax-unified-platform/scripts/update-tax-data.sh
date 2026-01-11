#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"
TARGET="$DATA_DIR/last-update.txt"

mkdir -p "$DATA_DIR"

if [[ -n "${TAX_DATA_URL:-}" ]]; then
  echo "Fetching tax data from \$TAX_DATA_URL..."
  curl -fsSL "$TAX_DATA_URL" -o "$DATA_DIR/latest.json"
  echo "updated_from_url=$TAX_DATA_URL" > "$TARGET"
else
  echo "No TAX_DATA_URL provided. Touching timestamp file."
  date -u +"updated_at=%Y-%m-%dT%H:%M:%SZ" > "$TARGET"
fi

echo "Data update complete: $TARGET"
