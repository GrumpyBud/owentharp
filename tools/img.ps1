# Decode (incl. HEIC via WIC), centre-crop to a target aspect with an optional
# focal bias, downscale, and write JPEG. Never upscales beyond the source.
param(
  [Parameter(Mandatory=$true)][string]$Src,
  [Parameter(Mandatory=$true)][string]$Dst,
  [int]$TargetW = 1600,
  [int]$TargetH = 1000,
  [double]$FocusX = 0.5,
  [double]$FocusY = 0.5,
  [int]$Quality = 88,
  [int]$Rotate = 0,
  [switch]$NoCrop
)

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$stream = [System.IO.File]::OpenRead($Src)
try {
  $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create(
    $stream, 'None', 'OnLoad')
  [System.Windows.Media.Imaging.BitmapSource]$img = $decoder.Frames[0]

  if ($Rotate -ne 0) {
    $rt = New-Object System.Windows.Media.RotateTransform($Rotate)
    $img = New-Object System.Windows.Media.Imaging.TransformedBitmap($img, $rt)
  }

  $w = $img.PixelWidth; $h = $img.PixelHeight
  $srcRatio = $w / $h

  if ($NoCrop) {
    $cw = $w; $ch = $h; $x = 0; $y = 0
    $aspect = $srcRatio
  } else {
    $aspect = $TargetW / $TargetH
    if ($srcRatio -gt $aspect) {
      $ch = $h; $cw = [int][math]::Round($h * $aspect)
    } else {
      $cw = $w; $ch = [int][math]::Round($w / $aspect)
    }
    if ($cw -gt $w) { $cw = $w }
    if ($ch -gt $h) { $ch = $h }
    $x = [int][math]::Round(($w - $cw) * $FocusX)
    $y = [int][math]::Round(($h - $ch) * $FocusY)
    if ($x -lt 0) { $x = 0 }; if ($x -gt ($w - $cw)) { $x = $w - $cw }
    if ($y -lt 0) { $y = 0 }; if ($y -gt ($h - $ch)) { $y = $h - $ch }
    $rect = New-Object System.Windows.Int32Rect($x, $y, $cw, $ch)
    $img = New-Object System.Windows.Media.Imaging.CroppedBitmap($img, $rect)
  }

  # never upscale
  $outW = [math]::Min($TargetW, $cw)
  if ($NoCrop) { $outH = [int][math]::Round($outW / $aspect) }
  else         { $outH = [int][math]::Round($outW * $TargetH / $TargetW) }

  if ($outW -ne $cw -or $outH -ne $ch) {
    $st = New-Object System.Windows.Media.ScaleTransform(($outW / $cw), ($outH / $ch))
    $img = New-Object System.Windows.Media.Imaging.TransformedBitmap($img, $st)
  }

  $enc = New-Object System.Windows.Media.Imaging.JpegBitmapEncoder
  $enc.QualityLevel = $Quality
  $enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($img))
  $out = [System.IO.File]::Open($Dst, 'Create')
  try { $enc.Save($out) } finally { $out.Close() }

  $size = (Get-Item $Dst).Length
  "{0,-26} {1}x{2} -> crop {3}x{4} @({5},{6}) -> {7}x{8}  {9} KB" -f `
    (Split-Path $Dst -Leaf), $w, $h, $cw, $ch, $x, $y, $img.PixelWidth, $img.PixelHeight, [int]($size/1KB)
} finally {
  $stream.Close()
}
