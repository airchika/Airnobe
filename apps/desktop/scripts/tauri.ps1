$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path -LiteralPath $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

$tauri = Join-Path $PSScriptRoot "..\..\..\node_modules\.bin\tauri.cmd"
& $tauri @args
exit $LASTEXITCODE
