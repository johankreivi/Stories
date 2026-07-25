# Sagostund

Sagostund är en statisk ljudboksspelare för GitHub Pages. Varje saga består av
kapiteltexter, ljudfiler och kapitelbilder. Webbplatsen hittar och validerar
innehållet automatiskt när den byggs.

## Bygg och förhandsgranska

Krav: Node.js 20 eller senare.

```powershell
npm.cmd run build
npm.cmd run preview
```

Öppna sedan `http://localhost:4173`.

`npm.cmd test` bygger sidan och kontrollerar att genererade manifest, ljudfiler,
bilder och undertexter går att läsa.

## Lägg till en saga

Skapa en ny mapp direkt under `Stories`:

```text
Stories/
  min-saga/
    saga.json
    bilder/
      00-omslag.png
      01_02-forsta-bilden.png
      03-andra-bilden.png
    kapitel/
      01-inledning.txt
      01-inledning.vtt
      02-fortsattning.txt
      02-fortsattning.vtt
      03-slut.txt
      03-slut.vtt
    ljud/
      01-inledning.mp3
      02-fortsattning.mp3
      03-slut.mp3
```

Regler:

- Text, ljud och undertext ska ha samma basnamn.
- Kapitelnummer ska börja på `01` och vara sammanhängande.
- `00-` i bildmappen är sagans omslag.
- Siffrorna före bildens första bindestreck anger vilka kapitel bilden gäller
  för. `01_02` betyder exempelvis kapitel 1 och 2.
- `saga.json` anger titel, beskrivning, språk och berättare.

Kör `npm.cmd run validate` innan du publicerar. Samma kontroll körs automatiskt av
GitHub Pages-arbetsflödet.

### Visningsnummer och låsta böcker

Källfilerna börjar alltid på `01`, men en bok kan visa andra kapitelnummer:

```json
{
  "chapterNumberStart": 0
}
```

Om kapitelrubriken ska visas men inte läsas upp läggs den i `chapterTitles`,
med kapitlets basnamn som nyckel. Då kan TXT-filen börja direkt med
berättartexten:

```json
{
  "chapterTitles": {
    "01-inledning": "Inledning"
  }
}
```

Ett lösenordslås anges med en saltad PBKDF2-SHA-256-hash i `saga.json`. Se
`Stories/den-stora-presentationen/saga.json` som exempel. Lösenordet sparas
aldrig i klartext och en lyckad upplåsning gäller bara i den aktuella
webbläsarfliken.

Observera att en statisk webbplats inte kan göra mediefiler hemliga. Låset är en
åtkomstspärr i gränssnittet, medan filer i ett publikt repository fortfarande
kan hittas av en teknisk användare.

## Synkroniserade undertexter

Den medföljande ljudgeneratorn skapar MP3 och WebVTT i samma TTS-körning. Det
gör att tidskoderna följer exakt det ljud som sparas:

```powershell
npm.cmd run generate:audio
```

För valfri saga med standardstrukturen:

```powershell
npm.cmd run generate:story -- -StorySlug min-saga
```

WebVTT-filerna placeras i sagans `kapitel`-mapp. Skapa inte nya tidskoder genom
att köra TTS separat mot en äldre MP3-fil; ljud och tidskoder ska alltid
genereras tillsammans.

## Chromecast och fokuserad uppspelning

Cast-knappen visas i Chrome när en Chromecast-enhet finns på samma nätverk.
Spelaren skickar hela kapitelkön, kapitelbilder och svenska WebVTT-spår till
Google Cast Default Media Receiver. GitHub Pages använder HTTPS, vilket krävs
för den här webbläsarintegrationen.

Knappen **Dölj navigation** eller tangenten `N` döljer sidhuvud och sidfot under
uppspelning. Inställningen sparas lokalt och knappen i spelaren finns kvar så
att navigationen alltid kan återställas.

## Publicering

Arbetsflödet i `.github/workflows/pages.yml` bygger och publicerar sidan när
ändringar skickas till `main` eller `master`. Aktivera **GitHub Actions** som
källa under repositoryts **Settings → Pages**.
