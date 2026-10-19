# Descarga los modelos "fast" de tessdata_fast (Apache-2.0,
# https://github.com/tesseract-ocr/tessdata_fast) para los idiomas de la
# app que todavía no están en vendor/tessdata/ (eng y spa ya venían en el
# repositorio) y los comprime a .gz, mismo formato que los ya existentes --
# Tesseract.js espera <idioma>.traineddata.gz en vendor/tessdata/.
#
# Uso: ejecutar desde la RAÍZ del proyecto (donde está la carpeta vendor\):
#   powershell -ExecutionPolicy Bypass -File scripts\download-tessdata-fast.ps1

$ErrorActionPreference = 'Stop'

$langs = 'cat', 'eus', 'glg', 'fra', 'deu', 'por', 'hin', 'chi_sim', 'rus', 'jpn'
$destDir = Join-Path (Get-Location) 'vendor\tessdata'

if (-not (Test-Path (Join-Path (Get-Location) 'vendor'))) {
    Write-Error "No se encuentra la carpeta 'vendor' en el directorio actual. Ejecuta este script desde la raiz del proyecto IDENTIFLY."
    exit 1
}
if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir | Out-Null
}

foreach ($lang in $langs) {
    $gzFile = Join-Path $destDir "$lang.traineddata.gz"
    if (Test-Path $gzFile) {
        Write-Host "$lang.traineddata.gz ya existe, se omite."
        continue
    }

    $url = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/$lang.traineddata"
    $tmpFile = Join-Path $env:TEMP "$lang.traineddata"

    Write-Host "Descargando $lang..."
    Invoke-WebRequest -Uri $url -OutFile $tmpFile -UseBasicParsing

    $inStream = [System.IO.File]::OpenRead($tmpFile)
    $outStream = [System.IO.File]::Create($gzFile)
    $gzStream = New-Object System.IO.Compression.GZipStream($outStream, [System.IO.Compression.CompressionLevel]::Optimal)
    try {
        $inStream.CopyTo($gzStream)
    } finally {
        $gzStream.Close()
        $outStream.Close()
        $inStream.Close()
    }
    Remove-Item $tmpFile

    $size = (Get-Item $gzFile).Length
    Write-Host "  -> $gzFile ($size bytes)"
}

Write-Host ""
Write-Host "Listo. Comprueba que los 10 archivos existen en vendor\tessdata\:"
Write-Host ($langs -join ', ')
Write-Host "Si falta alguno, el escaner cae automaticamente a ingles para ese idioma (ver getOcrLangs/recognizeWithPsm en index.html) -- no rompe nada, solo pierde precision en ese idioma hasta que se vuelva a ejecutar este script."
