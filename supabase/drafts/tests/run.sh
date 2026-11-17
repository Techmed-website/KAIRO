#!/usr/bin/env bash
# Run the cbt draft schema + behaviour tests against a throwaway database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres [SCHEMA_FILE=path.sql] supabase/drafts/tests/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="cbt_test_$$"
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/00_supabase_stub.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "${SCHEMA_FILE:-$here/../cbt_v1_schema.sql}"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/01_engine_test.sql"
