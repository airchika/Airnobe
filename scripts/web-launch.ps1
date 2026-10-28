param([ValidateSet('start', 'stop', 'restart')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
try {
    $repoDirectory = Split-Path -Parent $PSScriptRoot
    $nodeCommand = (Get-Command node -ErrorAction Stop).Source
    $runtimeDirectory = Join-Path $repoDirectory '.airnobe-web'
    New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
    $scriptPath = Join-Path $PSScriptRoot 'web.mjs'
    if ($Action -eq 'stop') {
        & $nodeCommand $scriptPath stop
        exit $LASTEXITCODE
    }
    $logSuffix = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $process = Start-Process -FilePath $nodeCommand -ArgumentList @(('"' + $scriptPath + '"'), $Action) -WorkingDirectory $repoDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory "$logSuffix.out.log") -RedirectStandardError (Join-Path $runtimeDirectory "$logSuffix.err.log")
    Start-Sleep -Seconds 2
    if ($process.HasExited -and $process.ExitCode -ne 0) {
        Get-Content -LiteralPath (Join-Path $runtimeDirectory "$logSuffix.err.log")
        throw 'Airnobe failed to start. Check .airnobe-web logs.'
    }
    Write-Host 'Airnobe is starting. Logs: .airnobe-web'
} catch {
    Write-Host $_ -ForegroundColor Red
    exit 1
}
