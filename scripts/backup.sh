#!/bin/sh
set -eu
: "${DATABASE_URL:?Set the private database URL}"
: "${1:?Provide an archive path outside the repository}"
umask 077
test ! -e "$1" || { echo 'Archive exists' >&2; exit 1; }
temp=$(mktemp "$1.partial.XXXXXX")
trap 'rm -f "$temp"' EXIT
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$temp"
pg_restore --list "$temp" >/dev/null
mv "$temp" "$1"
