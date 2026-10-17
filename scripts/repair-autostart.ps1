param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference='Stop'
$resolvedExecutable=(Resolve-Path -LiteralPath $Executable).Path
if([IO.Path]::GetFileName($resolvedExecutable) -ne 'Local Route.exe'){throw 'Expected Local Route.exe'}
& schtasks.exe /Create /TN 'Local Route AutoStart' /TR ('"'+$resolvedExecutable+'" --autostart') /SC ONLOGON /RL HIGHEST /F
exit $LASTEXITCODE
