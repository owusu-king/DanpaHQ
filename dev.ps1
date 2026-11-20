<#
.SYNOPSIS
  Start Danpa HQ for local development: services in Docker, the web app on this machine.

.DESCRIPTION
  Starts PostgreSQL, Redis, media storage, the API, the worker and the
  scheduler with Docker Compose, then runs the Next.js web app on the host
  with Turbopack. In a container on a Windows file share the web app has to
  poll for changes with webpack and pages take seconds to compile; on the host
  they compile in well under a second and reload as you save.

  Press Ctrl+C to stop the web app. The Docker services keep running; stop
  them with `docker compose stop`.

.PARAMETER Build
  Rebuild the Docker images first, as `docker compose up --build` would.

.EXAMPLE
  .\dev.ps1
.EXAMPLE
  .\dev.ps1 -Build
#>
param([switch]$Build)

# Native tools (docker, npm) report progress on stderr. Windows PowerShell turns
# redirected stderr into errors, so failures are judged by exit code instead.
$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot

function Assert-Command([string]$Name, [string]$Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Host "$Name was not found. $Hint" -ForegroundColor Red
    exit 1
  }
}
Assert-Command "docker" "Install Docker Desktop and start it."
Assert-Command "npm" "Install Node.js 22 or later."

if (-not (Test-Path -LiteralPath ".env")) {
  Write-Host "No .env yet: copying .env.example." -ForegroundColor Yellow
  Copy-Item -LiteralPath ".env.example" -Destination ".env" -ErrorAction Stop
}

# 1. The services. The web container is an opt-in profile, so it is not among them.
Write-Host "Starting Docker services..." -ForegroundColor Cyan
$composeArgs = @("compose", "up", "-d")
if ($Build) { $composeArgs += "--build" }
& docker @composeArgs
if ($LASTEXITCODE -ne 0) { Write-Host "docker compose up failed." -ForegroundColor Red; exit $LASTEXITCODE }

# A web container left over from before would hold port 3000.
& docker compose --profile docker-web rm --stop --force web 2>&1 | Out-Null

$busy = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  $owner = (Get-Process -Id ($busy | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue).ProcessName
  Write-Host "Port 3000 is already in use (by $owner). Stop it and run this again." -ForegroundColor Red
  exit 1
}

# npm's PowerShell shim garbles its arguments when called from a script, so
# call the command shim on Windows.
$npm = if ($env:OS -eq "Windows_NT") { "npm.cmd" } else { "npm" }

# 2. Web dependencies, reinstalled only when package-lock.json changes.
Set-Location -LiteralPath (Join-Path $PSScriptRoot "web")
$stamp = "node_modules\.danpahq-host-lock.sha256"
$lockHash = (Get-FileHash -LiteralPath "package-lock.json" -Algorithm SHA256 -ErrorAction Stop).Hash
$installed = if (Test-Path -LiteralPath $stamp) { (Get-Content -LiteralPath $stamp -Raw).Trim() } else { "" }
if (-not (Test-Path -LiteralPath "node_modules") -or $installed -ne $lockHash) {
  Write-Host "Installing web dependencies..." -ForegroundColor Cyan
  & $npm ci
  if ($LASTEXITCODE -ne 0) { Write-Host "npm ci failed." -ForegroundColor Red; exit $LASTEXITCODE }
  Set-Content -LiteralPath $stamp -Value $lockHash -Encoding ascii
}

# 3. The web app, in the foreground.
Write-Host ""
Write-Host "Web app:  http://localhost:3000" -ForegroundColor Green
Write-Host "API:      http://localhost:8000" -ForegroundColor Green
Write-Host "Ctrl+C stops the web app; 'docker compose stop' stops the services." -ForegroundColor DarkGray
Write-Host ""
& $npm run dev -- --hostname localhost
exit $LASTEXITCODE
