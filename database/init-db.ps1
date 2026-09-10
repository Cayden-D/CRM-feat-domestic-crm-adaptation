param(
  [string]$HostName = '127.0.0.1',
  [int]$Port = 5432,
  [string]$AdminUser = 'mac',
  [string]$DatabaseName = 'ai_crm'
)

$ErrorActionPreference = 'Stop'

if (-not $env:CRM_DB_PASSWORD) {
  throw 'Set the CRM_DB_PASSWORD environment variable before running this script.'
}

$env:PGPASSWORD = $env:CRM_DB_PASSWORD
try {
  $exists = psql -h $HostName -p $Port -U $AdminUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName'"
  if ($exists -ne '1') {
    psql -h $HostName -p $Port -U $AdminUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DatabaseName ENCODING 'UTF8' TEMPLATE template0"
  }

  psql -h $HostName -p $Port -U $AdminUser -d $DatabaseName -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename varchar(255) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"

  Get-ChildItem -LiteralPath "$PSScriptRoot\migrations" -Filter '*.sql' |
    Sort-Object Name |
    ForEach-Object {
      $migrationName = $_.Name
      $applied = psql -h $HostName -p $Port -U $AdminUser -d $DatabaseName -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$migrationName'"
      if ($applied -ne '1') {
        Write-Host "Applying $migrationName..."
        psql -h $HostName -p $Port -U $AdminUser -d $DatabaseName -v ON_ERROR_STOP=1 -f $_.FullName
        if ($LASTEXITCODE -ne 0) { throw "Migration failed: $migrationName" }
        psql -h $HostName -p $Port -U $AdminUser -d $DatabaseName -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations (filename) VALUES ('$migrationName')"
      }
      else {
        Write-Host "Skipping $migrationName (already applied)."
      }
    }
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
