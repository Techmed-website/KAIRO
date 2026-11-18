#!/usr/bin/env bash
# Run the cbt behaviour tests against a throwaway database built from the real migrations.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/drafts/tests/run.sh
#   SCHEMA_FILE=path.sql  test only that file (old behaviour, engine tests only)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mig="$here/../../migrations"
db="cbt_test_$$"
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/00_supabase_stub.sql"
if [ -n "${SCHEMA_FILE:-}" ]; then
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$SCHEMA_FILE"
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/01_engine_test.sql"
  exit 0
fi
# Every cbt migration from the schema onwards, in order (the final drop of temporary loaders included).
for f in $(ls "$mig"/2026111[8-9]*_cbt_*.sql 2>/dev/null | sort -u); do
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/01_engine_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/02_practice_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/03_app_support_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/04_leaderboard_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/05_leaderboard_scores_test.sql"
