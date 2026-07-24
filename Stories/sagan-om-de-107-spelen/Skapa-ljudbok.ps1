[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ChapterDirectory = Join-Path $Root "kapitel"
$OutputDirectory = Join-Path $Root "ljud"
$ToolDirectory = Join-Path $Root ".tts-verktyg"
$Generator = Join-Path $Root "generera-kapitel.cjs"
$Voice = "sv-SE-MattiasNeural"
$Language = "sv-SE"
$Rate = "-7%"
$OutputFormat = "audio-24khz-96kbitrate-mono-mp3"

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [Console]::OutputEncoding
}
catch {
    # Older hosts can ignore this. Script messages contain ASCII only.
}

Write-Host ""
Write-Host "Sagan om de 107 spelen" -ForegroundColor Cyan
Write-Host "Berattare: Mattias" -ForegroundColor Yellow
Write-Host ""

$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
}

$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $NodeCommand) {
    $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
}

if (-not $NpmCommand) {
    throw "Node.js saknas. Installera Node.js fran https://nodejs.org/ och kor sedan filen igen."
}

if (-not $NodeCommand) {
    throw "Kommandot node hittades inte. Installera om Node.js och kor sedan filen igen."
}

if (-not (Test-Path $Generator)) {
    throw "Filen generera-kapitel.cjs saknas i paketet."
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $ToolDirectory | Out-Null

$TtsModule = Join-Path $ToolDirectory "node_modules\node-edge-tts"

if (-not (Test-Path $TtsModule)) {
    Write-Host "Installerar berattarrosten forsta gangen..." -ForegroundColor DarkCyan
    & $NpmCommand.Source install --prefix $ToolDirectory node-edge-tts@1.2.10
    if ($LASTEXITCODE -ne 0) {
        throw "Kunde inte installera talverktyget."
    }
}

$Chapters = Get-ChildItem -Path $ChapterDirectory -Filter "*.txt" |
    Sort-Object Name

if (-not $Chapters) {
    throw "Inga kapitel hittades i $ChapterDirectory."
}

$Completed = 0
foreach ($Chapter in $Chapters) {
    $OutputName = [System.IO.Path]::GetFileNameWithoutExtension($Chapter.Name) + ".mp3"
    $OutputPath = Join-Path $OutputDirectory $OutputName
    $SubtitlePath = Join-Path $ChapterDirectory ($Chapter.BaseName + ".vtt")

    Write-Host ("Laser in: {0}" -f $Chapter.BaseName) -ForegroundColor Green

    $Succeeded = $false
    for ($Attempt = 1; $Attempt -le 3 -and -not $Succeeded; $Attempt++) {
        & $NodeCommand.Source `
            $Generator `
            $Chapter.FullName `
            $OutputPath `
            $Voice `
            $Language `
            $Rate `
            $OutputFormat

        $Succeeded = ($LASTEXITCODE -eq 0) -and
            (Test-Path $OutputPath) -and
            ((Get-Item $OutputPath).Length -gt 1000) -and
            (Test-Path $SubtitlePath) -and
            ((Get-Item $SubtitlePath).Length -gt 20)

        if (-not $Succeeded -and $Attempt -lt 3) {
            Write-Host "Tillfalligt fel. Forsoker igen..." -ForegroundColor Yellow
            Start-Sleep -Seconds (2 * $Attempt)
        }
    }

    if (-not $Succeeded) {
        throw "Kunde inte skapa $OutputName efter tre forsok."
    }

    $Completed++
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host ("Klart! {0} ljudfiler skapades i:" -f $Completed) -ForegroundColor Cyan
Write-Host $OutputDirectory -ForegroundColor White
Write-Host "Synkroniserade undertexter skapades i:" -ForegroundColor Cyan
Write-Host $ChapterDirectory -ForegroundColor White
Write-Host ""
