[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[a-z0-9]+(?:-[a-z0-9]+)*$")]
    [string]$StorySlug,

    [string]$Voice = "sv-SE-MattiasNeural",
    [string]$Language = "sv-SE",
    [string]$Rate = "-2%",
    [string]$OutputFormat = "audio-24khz-96kbitrate-mono-mp3"
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = Split-Path -Parent $ScriptRoot
$StoryRoot = Join-Path (Join-Path $RepositoryRoot "Stories") $StorySlug
$ChapterDirectory = Join-Path $StoryRoot "kapitel"
$OutputDirectory = Join-Path $StoryRoot "ljud"
$ToolDirectory = Join-Path $ScriptRoot ".tts-verktyg"
$Generator = Join-Path $ScriptRoot "generate-chapter.cjs"

try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [Console]::OutputEncoding
}
catch {
    # Äldre PowerShell-versioner kan använda sin befintliga teckenkodning.
}

if (-not (Test-Path -LiteralPath $StoryRoot -PathType Container)) {
    throw "Sagan '$StorySlug' finns inte under Stories."
}
if (-not (Test-Path -LiteralPath $ChapterDirectory -PathType Container)) {
    throw "Mappen kapitel saknas i '$StorySlug'."
}
if (-not (Test-Path -LiteralPath $Generator -PathType Leaf)) {
    throw "TTS-generatorn saknas: $Generator"
}

$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
}
$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $NodeCommand) {
    $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
if (-not $NpmCommand -or -not $NodeCommand) {
    throw "Node.js och npm krävs för att skapa ljudboken."
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $ToolDirectory | Out-Null
$TtsModule = Join-Path $ToolDirectory "node_modules\node-edge-tts"
if (-not (Test-Path -LiteralPath $TtsModule -PathType Container)) {
    Write-Host "Installerar berättarrösten första gången..." -ForegroundColor DarkCyan
    & $NpmCommand.Source install --prefix $ToolDirectory node-edge-tts@1.2.10
    if ($LASTEXITCODE -ne 0) {
        throw "Kunde inte installera talverktyget."
    }
}

$Chapters = Get-ChildItem -LiteralPath $ChapterDirectory -Filter "*.txt" |
    Sort-Object Name
if (-not $Chapters) {
    throw "Inga TXT-kapitel hittades i '$ChapterDirectory'."
}

Write-Host ""
Write-Host ("Skapar ljud för: {0}" -f $StorySlug) -ForegroundColor Cyan
Write-Host ("Röst: {0}, hastighet: {1}" -f $Voice, $Rate) -ForegroundColor Yellow
Write-Host ""

$Completed = 0
foreach ($Chapter in $Chapters) {
    $OutputName = $Chapter.BaseName + ".mp3"
    $OutputPath = Join-Path $OutputDirectory $OutputName
    $SubtitlePath = Join-Path $ChapterDirectory ($Chapter.BaseName + ".vtt")
    Write-Host ("Läser in: {0}" -f $Chapter.BaseName) -ForegroundColor Green

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
            (Test-Path -LiteralPath $OutputPath) -and
            ((Get-Item -LiteralPath $OutputPath).Length -gt 1000) -and
            (Test-Path -LiteralPath $SubtitlePath) -and
            ((Get-Item -LiteralPath $SubtitlePath).Length -gt 20)

        if (-not $Succeeded -and $Attempt -lt 3) {
            Start-Sleep -Seconds (2 * $Attempt)
        }
    }
    if (-not $Succeeded) {
        throw "Kunde inte skapa '$OutputName' efter tre försök."
    }
    $Completed++
}

Write-Host ""
Write-Host ("Klart: {0} ljudfiler och synkroniserade undertexter." -f $Completed) -ForegroundColor Cyan
