#!/usr/bin/env bash
# يختبر supabase/schema.sql على PostgreSQL محلي مع محاكاة بيئة Supabase.
# الاستخدام: bash supabase/tests/run.sh   (يتطلب صلاحية إنشاء قاعدة بيانات)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DB="${TEST_DB:-timetable_test}"
PSQL="${PSQL:-psql}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
$PSQL -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/mock_supabase.sql"
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/../schema.sql"
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/../schema.sql"   # قابل لإعادة التشغيل
$PSQL -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/rls_test.sql"
