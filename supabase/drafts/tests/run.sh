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
for f in $(ls "$mig"/202611[1-2][0-9]*_cbt_*.sql 2>/dev/null | sort -u); do
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/01_engine_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/02_practice_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/03_app_support_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/04_leaderboard_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/05_leaderboard_scores_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/06_explanation_pipeline_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/07_review_predict_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/08_paper_rankings_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/09_daily_takeover_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/10_public_quizzes_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/11_daily_builder_test.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/12_runner_support_test.sql"
