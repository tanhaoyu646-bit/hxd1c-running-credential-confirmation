param(
    [Parameter(Mandatory = $true)]
    [string]$GameRoot,

    [Parameter(Mandatory = $true)]
    [string]$ShapePath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [int]$SubObjectMask = 1
)

$ErrorActionPreference = 'Stop'
$openRailsRoot = Join-Path $GameRoot 'ORDP6063'
$formatsAssembly = Join-Path $openRailsRoot 'Orts.Formats.Msts.dll'

[Environment]::CurrentDirectory = $openRailsRoot
Get-ChildItem -LiteralPath $openRailsRoot -Filter '*.dll' | ForEach-Object {
    try { [Reflection.Assembly]::LoadFrom($_.FullName) | Out-Null } catch { }
}

$formats = [Reflection.Assembly]::LoadFrom($formatsAssembly)
$shapeType = $formats.GetType('Orts.Formats.Msts.ShapeFile', $true)
$shapeConstructor = $shapeType.GetConstructor([Type[]]@([string], [bool]))
[object[]]$shapeArguments = @($ShapePath, [bool]$false)
$shape = $shapeConstructor.Invoke($shapeArguments).shape
if ($shape.lod_controls.Count -eq 0 -or $shape.lod_controls[0].distance_levels.Count -eq 0) {
    throw 'The shape contains no usable LOD.'
}

function Add-Float([System.Collections.Generic.List[double]]$list, [double]$value) {
    $list.Add([Math]::Round($value, 6))
}

$materials = New-Object System.Collections.Generic.List[object]
for ($materialIndex = 0; $materialIndex -lt $shape.prim_states.Count; $materialIndex++) {
    $state = $shape.prim_states[$materialIndex]
    $textureName = $null
    if ($null -ne $state.tex_idxs -and $state.tex_idxs.Length -gt 0) {
        $textureIndex = [int]$state.tex_idxs[0]
        if ($textureIndex -ge 0 -and $textureIndex -lt $shape.textures.Count) {
            $imageIndex = [int]$shape.textures[$textureIndex].iImage
            if ($imageIndex -ge 0 -and $imageIndex -lt $shape.images.Count) {
                $textureName = [IO.Path]::GetFileNameWithoutExtension([string]$shape.images[$imageIndex]) + '.png'
            }
        }
    }
    $materials.Add([pscustomobject]@{
        name = [string]$state.Name
        texture = $textureName
        alphaTestMode = [int]$state.alphatestmode
        zBias = [double]$state.ZBias
    })
}

$distanceLevel = $shape.lod_controls[0].distance_levels[0]
$subObjectCount = [int]$distanceLevel.sub_objects.Count
$selectedSubObjects = New-Object System.Collections.Generic.List[int]
$groups = [ordered]@{}
$minimum = @( [double]::PositiveInfinity, [double]::PositiveInfinity, [double]::PositiveInfinity )
$maximum = @( [double]::NegativeInfinity, [double]::NegativeInfinity, [double]::NegativeInfinity )

for ($subObjectIndex = 0; $subObjectIndex -lt $subObjectCount; $subObjectIndex++) {
    if (($SubObjectMask -band (1 -shl $subObjectIndex)) -eq 0) { continue }
    $selectedSubObjects.Add($subObjectIndex)
    $subObject = $distanceLevel.sub_objects[$subObjectIndex]
    foreach ($primitive in $subObject.primitives) {
        if (-not $primitive.indexed_trilist) { continue }
        $materialIndex = [int]$primitive.prim_state_idx
        $key = [string]$materialIndex
        if (-not $groups.Contains($key)) {
            $groups[$key] = [ordered]@{
                materialIndex = $materialIndex
                positions = New-Object System.Collections.Generic.List[double]
                uvs = New-Object System.Collections.Generic.List[double]
            }
        }
        $group = $groups[$key]
        foreach ($triangle in $primitive.indexed_trilist.vertex_idxs) {
            foreach ($vertexIndex in @([int]$triangle.c, [int]$triangle.b, [int]$triangle.a)) {
                $vertex = $subObject.vertices[$vertexIndex]
                $point = $shape.points[[int]$vertex.ipoint]
                $position = @(-[double]$point.X, [double]$point.Y, [double]$point.Z)
                for ($axis = 0; $axis -lt 3; $axis++) {
                    $minimum[$axis] = [Math]::Min($minimum[$axis], $position[$axis])
                    $maximum[$axis] = [Math]::Max($maximum[$axis], $position[$axis])
                    Add-Float $group.positions $position[$axis]
                }
                if ($null -ne $vertex.vertex_uvs -and $vertex.vertex_uvs.Length -gt 0) {
                    $uv = $shape.uv_points[[int]$vertex.vertex_uvs[0]]
                    Add-Float $group.uvs ([double]$uv.U)
                    Add-Float $group.uvs ([double]$uv.V)
                } else {
                    Add-Float $group.uvs 0
                    Add-Float $group.uvs 0
                }
            }
        }
    }
}

if ($selectedSubObjects.Count -eq 0 -or $groups.Count -eq 0) {
    throw "SubObjectMask $SubObjectMask selected no renderable geometry from $subObjectCount sub-objects."
}

$outputGroups = @($groups.GetEnumerator() | ForEach-Object {
    [pscustomobject]@{
        materialIndex = $_.Value.materialIndex
        positions = $_.Value.positions.ToArray()
        uvs = $_.Value.uvs.ToArray()
    }
})

$result = [ordered]@{
    format = 'msts-signal-asset-v1'
    source = [ordered]@{
        fileName = [IO.Path]::GetFileName($ShapePath)
        sha256 = (Get-FileHash -LiteralPath $ShapePath -Algorithm SHA256).Hash
        subObjectMask = $SubObjectMask
        selectedLod = 0
        coordinateTransform = 'three = (-mstsX, mstsY, mstsZ)'
    }
    summary = [ordered]@{
        sourceSubObjectCount = $subObjectCount
        selectedSubObjects = $selectedSubObjects.ToArray()
        selectionDistance = [double]$distanceLevel.distance_level_header.dlevel_selection
        triangleCount = [int](($outputGroups | ForEach-Object { $_.positions.Count / 9 } | Measure-Object -Sum).Sum)
        bounds = [ordered]@{
            minimum = @($minimum | ForEach-Object { [Math]::Round($_, 6) })
            maximum = @($maximum | ForEach-Object { [Math]::Round($_, 6) })
        }
    }
    materials = $materials.ToArray()
    groups = $outputGroups
}

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }
$json = $result | ConvertTo-Json -Depth 10 -Compress
[IO.File]::WriteAllText($OutputPath, $json, [Text.UTF8Encoding]::new($false))
Write-Output "Exported mask $SubObjectMask ($($selectedSubObjects.Count)/$subObjectCount sub-objects) and $($result.summary.triangleCount) triangles to $OutputPath"
