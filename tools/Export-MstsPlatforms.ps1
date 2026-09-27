param(
    [Parameter(Mandatory = $true)] [string]$GameRoot,
    [Parameter(Mandatory = $true)] [string]$RouteName,
    [string]$TrackDatabaseFile = '',
    [string]$Ids = ''
)

$ErrorActionPreference = 'Stop'
$openRailsRoot = Join-Path $GameRoot 'ORDP6063'
[Environment]::CurrentDirectory = $openRailsRoot
Get-ChildItem -LiteralPath $openRailsRoot -Filter '*.dll' | ForEach-Object {
    try { [Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null } catch { }
}
$formats = [Reflection.Assembly]::LoadFrom((Join-Path $openRailsRoot 'Orts.Formats.Msts.dll'))
$databaseType = $formats.GetType('Orts.Formats.Msts.TrackDatabaseFile', $true)
$constructor = $databaseType.GetConstructor([Type[]]@([string]))
$routeRoot = Join-Path (Join-Path $GameRoot 'ROUTES') $RouteName
if ([string]::IsNullOrWhiteSpace($TrackDatabaseFile)) { $TrackDatabaseFile = "$RouteName.TDB" }
$trackPath = Join-Path $routeRoot $TrackDatabaseFile
if (-not (Test-Path -LiteralPath $trackPath)) { throw "Track database not found: $trackPath" }
[object[]]$arguments = @([string]$trackPath)
$database = $constructor.Invoke($arguments).TrackDB
$idValues = @($Ids -split ',' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [uint32]$_ })

foreach ($item in $database.TrItemTable) {
    if ($null -eq $item -or $item.GetType().FullName -ne 'Orts.Formats.Msts.PlatformItem') { continue }
    if ($idValues.Count -gt 0 -and -not ($idValues -contains $item.TrItemId) -and -not ($idValues -contains $item.LinkedPlatformItemId)) { continue }
    [pscustomobject]@{
        Id = $item.TrItemId; LinkedId = $item.LinkedPlatformItemId; Station = $item.Station; ItemName = $item.ItemName
        TileX = $item.TileX; TileZ = $item.TileZ; X = $item.X; Y = $item.Y; Z = $item.Z
    }
}
