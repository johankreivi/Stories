# Sagan om de 107 spelen – ljudbok med Mattias

Paketet skapar tio MP3-filer och synkroniserade WebVTT-undertexter med den
svenska neuralrösten `sv-SE-MattiasNeural`.

## Snabbstart i Windows

1. Packa upp zip-filen.
2. Dubbelklicka på `Skapa-ljudbok.cmd`.
3. Vänta medan verktyget och ljudspåren hämtas/skapas.
4. De färdiga MP3-filerna hamnar i mappen `ljud`.
5. WebVTT-filer med samma basnamn skapas i mappen `kapitel`.

Om Windows blockerar skriptet som osignerat ska du inte starta det med bara
`.\Skapa-ljudbok.ps1`. Öppna PowerShell i den uppackade mappen och kör i stället:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Skapa-ljudbok.ps1
```

Alternativt kan du dubbelklicka på `Skapa-ljudbok.cmd`, som redan använder
den tillfälliga inställningen `ExecutionPolicy Bypass`.

## Krav

- Windows 10 eller 11
- Node.js installerat: https://nodejs.org/
- Internetanslutning under ljudgenereringen

Ingen API-nyckel behövs. Första körningen installerar `node-edge-tts` lokalt
i paketets egen verktygsmapp.

## Berättarröst

- Röst: Mattias
- Språk: svenska
- Tempo: 7 procent långsammare än normalt
- Format: MP3, 24 kHz, 96 kbit/s, mono

Du kan ändra tempot i `Skapa-ljudbok.ps1` genom att justera `$Rate`.
Exempel: `-12%` blir långsammare och `+5%` blir snabbare.

## Korrigeringar i version 2

- Windows PowerShell 5.1 feltolkar ibland UTF-8-text i skriptfiler.
- `node-edge-tts` kommandoradsverktyg kan ignorera `--filepath` och skapa
  `output.mp3` i fel mapp.

Paketet använder därför ett litet Node-skript som läser varje kapitel som UTF-8
och skriver direkt till rätt MP3-fil.

## Synkroniserade undertexter

TTS-tjänstens ordgränser sparas samtidigt som varje ljudfil skapas. Generatorn
slår ihop ordgränserna till korta, läsbara textsegment och skriver en `.vtt`-fil
med samma basnamn som kapitlet. En äldre MP3-fil ersätts först när både nytt
ljud och nya tidskoder har skapats utan fel.
