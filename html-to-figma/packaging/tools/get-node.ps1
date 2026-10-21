# Загрузка портативного Node.js для обработчика HTML → Figma.
# Скачивает официальный архив с nodejs.org, сверяет SHA-256 с SHASUMS256.txt того же
# выпуска и кладёт node.exe в папку runtime\ рядом с start-windows.cmd.
# Ничего не устанавливает в систему и не меняет PATH.
$ErrorActionPreference = 'Stop'
$ver = 'v22.22.0'
$arch = 'x64'
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arch = 'arm64' }
elseif (-not [Environment]::Is64BitOperatingSystem) { $arch = 'x86' }
$name = "node-$ver-win-$arch"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root 'runtime'

Write-Host ''
Write-Host 'Node.js 20+ не найден.'
Write-Host "Можно скачать портативный Node.js $ver ($arch, ~30 МБ) с https://nodejs.org в папку:"
Write-Host "  $dest"
$answer = Read-Host 'Скачать? [Д/н]'
if ($answer -match '^(н|n|no|нет)$') { exit 1 }

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("h2f-node-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force $tmp | Out-Null
  $zip = Join-Path $tmp "$name.zip"
  Write-Host "Скачиваю $name.zip ..."
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$ver/$name.zip" -OutFile $zip
  $sums = Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$ver/SHASUMS256.txt"
  $text = if ($sums.Content -is [byte[]]) { [Text.Encoding]::ASCII.GetString($sums.Content) } else { [string]$sums.Content }
  $line = ($text -split "`n") | Where-Object { $_ -match ("\s" + [Regex]::Escape("$name.zip") + "\s*$") } | Select-Object -First 1
  if (-not $line) { throw "В SHASUMS256.txt нет строки для $name.zip" }
  $expected = ($line.Trim() -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
  if ($actual -ne $expected) { throw "Контрольная сумма не совпала: $actual вместо $expected" }
  Write-Host 'Контрольная сумма совпала. Распаковываю ...'
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force $dest | Out-Null
  Copy-Item -Force (Join-Path $tmp "$name\node.exe") (Join-Path $dest 'node.exe')
  Copy-Item -Force (Join-Path $tmp "$name\LICENSE") (Join-Path $dest 'LICENSE-node.txt') -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $tmp
  Write-Host "Готово: $dest\node.exe"
} catch {
  Write-Host ''
  Write-Host ('Не удалось скачать Node.js: ' + $_.Exception.Message)
  Write-Host 'Установите Node.js LTS вручную с https://nodejs.org и снова запустите start-windows.cmd.'
  exit 1
}
