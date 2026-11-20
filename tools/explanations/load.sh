#!/usr/bin/env bash
# Load a prepared explanation file through the single-use loader (migration 20261120000000).
# Usage: SUPABASE_ANON_KEY=... TOKEN_FILE=path tools/explanations/load.sh content/explanations/merged/load_2015_pilot.json
set -euo pipefail
python3 -I -c "import json,sys; print(json.dumps({'p_token': open(sys.argv[1]).read().strip(), 'p_rows': json.load(open(sys.argv[2]))}))" "$TOKEN_FILE" "$1" |
  curl -sS -X POST "https://unbgborbhxzsotaieiun.supabase.co/rest/v1/rpc/cbt_load_explanations_once" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H "Content-Type: application/json" --data-binary @-
echo
