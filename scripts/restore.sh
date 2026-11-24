#!/bin/sh
set -eu
: "${RESTORE_DATABASE_URL:?Set the URL of a NEW empty restore database}"
: "${1:?Provide an archive path}"
export PGDATABASE="$RESTORE_DATABASE_URL"
count=$(psql --dbname="$PGDATABASE" -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','v','m','S','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'")
test "$count" = 0 || { echo 'Restore target is not empty' >&2; exit 1; }
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$PGDATABASE" "$1"
