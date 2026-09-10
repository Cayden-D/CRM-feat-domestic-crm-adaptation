#!/usr/bin/env bash
set -euo pipefail

HostName="${1:-127.0.0.1}"
Port="${2:-5432}"
AdminUser="${3:-mac}"
DatabaseName="${4:-ai_crm}"

if [[ -z "${CRM_DB_PASSWORD:-}" ]]; then
  echo "Set the CRM_DB_PASSWORD environment variable before running this script." >&2
  exit 1
fi

export PGPASSWORD="$CRM_DB_PASSWORD"

cleanup() {
  unset PGPASSWORD
}
trap cleanup EXIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

exists="$(psql -h "$HostName" -p "$Port" -U "$AdminUser" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName'")"
if [[ "$exists" != "1" ]]; then
  psql -h "$HostName" -p "$Port" -U "$AdminUser" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE $DatabaseName ENCODING 'UTF8' TEMPLATE template0"
fi

psql -h "$HostName" -p "$Port" -U "$AdminUser" -d "$DatabaseName" -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename varchar(255) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"

for file in "$MIGRATIONS_DIR"/*.sql; do
  [[ -e "$file" ]] || continue
  migrationName="$(basename "$file")"

  applied="$(psql -h "$HostName" -p "$Port" -U "$AdminUser" -d "$DatabaseName" -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$migrationName'")"
  if [[ "$applied" != "1" ]]; then
    echo "Applying $migrationName..."
    psql -h "$HostName" -p "$Port" -U "$AdminUser" -d "$DatabaseName" -v ON_ERROR_STOP=1 -f "$file"
    psql -h "$HostName" -p "$Port" -U "$AdminUser" -d "$DatabaseName" -v ON_ERROR_STOP=1 \
      -c "INSERT INTO schema_migrations (filename) VALUES ('$migrationName')"
  else
    echo "Skipping $migrationName (already applied)."
  fi
done