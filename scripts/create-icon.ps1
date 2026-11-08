$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$directory=Join-Path $PSScriptRoot '..\ui\assets'
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$bitmap=New-Object System.Drawing.Bitmap(256,256)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$source=[System.Drawing.Image]::FromFile((Join-Path $directory 'hero-app-icon.png'))
$graphics.DrawImage($source,0,0,256,256)
$png=Join-Path $directory 'icon.png'
$bitmap.Save($png,[System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose();$source.Dispose();$bitmap.Dispose()
$imageBytes=[System.IO.File]::ReadAllBytes($png)
$stream=New-Object System.IO.MemoryStream
$writer=New-Object System.IO.BinaryWriter($stream)
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]1)
$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0)
$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$imageBytes.Length);$writer.Write([uint32]22)
$writer.Write($imageBytes);$writer.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $directory 'icon.ico'),$stream.ToArray())
$writer.Dispose();$stream.Dispose()
Write-Output 'Hero Boost icon generated.'
