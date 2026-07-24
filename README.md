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

## Synkroniserade undertexter

Den medföljande ljudgeneratorn skapar MP3 och WebVTT i samma TTS-körning. Det
gör att tidskoderna följer exakt det ljud som sparas:

```powershell
npm.cmd run generate:audio
```

WebVTT-filerna placeras i sagans `kapitel`-mapp. Skapa inte nya tidskoder genom
att köra TTS separat mot en äldre MP3-fil; ljud och tidskoder ska alltid
genereras tillsammans.

## Publicering

Arbetsflödet i `.github/workflows/pages.yml` bygger och publicerar sidan när
ändringar skickas till `main` eller `master`. Aktivera **GitHub Actions** som
källa under repositoryts **Settings → Pages**.
