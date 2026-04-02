#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[guard] checking backend reserved property writes..."
if rg -n \
  --glob 'internal/**/*.go' \
  --glob '!**/*_test.go' \
  'properties\s*\[(("x")|("y")|("collapsed"))\]\s*=' \
  internal >/tmp/treemindmap_guard_backend.txt; then
  cat /tmp/treemindmap_guard_backend.txt
  echo "[guard] backend writes reserved keys into properties"
  exit 1
fi

echo "[guard] checking frontend legacy property reads..."
if rg -n \
  --glob 'frontend/src/**/*.ts' \
  --glob 'frontend/src/**/*.tsx' \
  --glob '!frontend/src/generated/**' \
  --glob '!frontend/src/lib/nodeFields.ts' \
  --glob '!frontend/src/**/*.test.ts' \
  --glob '!frontend/src/**/*.test.tsx' \
  'properties\?\.(x|y|collapsed)|properties\.(x|y|collapsed)|properties\[(("x")|("y")|("collapsed"))\]' \
  frontend/src >/tmp/treemindmap_guard_frontend.txt; then
  cat /tmp/treemindmap_guard_frontend.txt
  echo "[guard] frontend uses legacy properties.x/y/collapsed path outside adapter"
  exit 1
fi

echo "[guard] node layout guard passed"
