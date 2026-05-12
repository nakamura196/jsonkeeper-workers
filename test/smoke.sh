#!/usr/bin/env bash
# Smoke test for jsonkeeper-workers.
# Usage:
#   BASE=https://jsonkeeper.<your-subdomain>.workers.dev ./test/smoke.sh
#   BASE=http://127.0.0.1:8787 ./test/smoke.sh
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8787}"
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

loc_from() { grep -i '^location:' "$1" | awk '{print $2}' | tr -d '\r'; }

echo "1/4 root"
curl -sS "$BASE/" | head -c 200; echo

echo "2/4 POST anonymous"
curl -sS -D "$TMP" -o /dev/null -X POST \
  -H 'Content-Type: application/json' \
  -d '{"hello":"workers"}' "$BASE/api"
LOC=$(loc_from "$TMP")
echo "  Location: $LOC"
test -n "$LOC" || { echo "FAIL: no Location header"; exit 1; }

echo "3/4 GET back"
GOT=$(curl -sS "$LOC")
echo "  Body: $GOT"
echo "$GOT" | grep -q '"hello":"workers"' || { echo "FAIL: body mismatch"; exit 1; }

echo "4/4 POST Curation (JSON-LD @id rewrite)"
curl -sS -D "$TMP" -o /dev/null -X POST \
  -H 'Content-Type: application/ld+json' \
  -d '{"@type":"http://codh.rois.ac.jp/iiif/curation/1#Curation","@id":"about:blank","label":"x"}' \
  "$BASE/api"
CUR_LOC=$(loc_from "$TMP")
BODY=$(curl -sS "$CUR_LOC")
echo "  Body: $BODY"
echo "$BODY" | grep -q "\"@id\":\"$CUR_LOC\"" || { echo "FAIL: @id not rewritten"; exit 1; }

echo "OK"
