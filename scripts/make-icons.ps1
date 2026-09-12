# Genera los iconos PNG del PWA (Casas del Parque 7)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\icons"
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function S([double]$v) { return [single]$v }

function New-Icon([int]$size, [string]$name, [bool]$maskable) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    # Fondo
    if ($maskable) {
        $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 20, 83, 45))
        $g.FillRectangle($b, $rect)
    } else {
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $r = [single]([math]::Max(8, $size * 0.22))
        $d = $r * 2
        $path.AddArc(0, 0, $d, $d, 180, 90)
        $path.AddArc($size - $d, 0, $d, $d, 270, 90)
        $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
        $path.AddArc(0, $size - $d, $d, $d, 90, 90)
        $path.CloseFigure()
        $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            $rect,
            [System.Drawing.Color]::FromArgb(255, 20, 83, 45),
            [System.Drawing.Color]::FromArgb(255, 22, 101, 52),
            [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
        $g.FillPath($br, $path)
        $path.Dispose()
        $br.Dispose()
    }

    $sunC = [System.Drawing.Color]::FromArgb(255, 251, 191, 36)
    $sunBrush = New-Object System.Drawing.SolidBrush($sunC)
    $cx = S($size * 0.5); $sunCy = S($size * 0.22); $sunR = S($size * 0.075)
    $g.FillEllipse($sunBrush, $cx - $sunR, $sunCy - $sunR, $sunR * 2, $sunR * 2)
    $sunBrush.Dispose()

    $goldBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 251, 191, 36))
    $penW = S([math]::Max(2, $size * 0.05))

    # Techo (triangulo)
    $p1 = New-Object System.Drawing.PointF((S($size * 0.20)), (S($size * 0.52)))
    $p2 = New-Object System.Drawing.PointF((S($size * 0.50)), (S($size * 0.24)))
    $p3 = New-Object System.Drawing.PointF((S($size * 0.80)), (S($size * 0.52)))
    $roof = [System.Drawing.PointF[]]@($p1, $p2, $p3)
    $goldPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 251, 191, 36), $penW)
    $goldPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $goldPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $goldPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawLines($goldPen, $roof)

    # Cuerpo (relleno dorado)
    $g.FillRectangle($goldBrush, [single]($size * 0.24), [single]($size * 0.52), [single]($size * 0.52), [single]($size * 0.28))

    # Puerta
    $doorBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 20, 83, 45))
    $g.FillRectangle($doorBrush, [single]($size * 0.42), [single]($size * 0.62), [single]($size * 0.16), [single]($size * 0.18))

    $doorBrush.Dispose()
    $goldBrush.Dispose()
    $goldPen.Dispose()

    $file = Join-Path $outDir $name
    $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "OK $name ($size x $size)"
}

New-Icon 512 "icon-512.png" $false
New-Icon 192 "icon-192.png" $false
New-Icon 180 "icon-180.png" $false
New-Icon 512 "icon-maskable-512.png" $true