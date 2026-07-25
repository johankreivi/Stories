import { access, readFile } from "node:fs/promises";
import { pbkdf2Sync } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "dist");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function outputPathFromUrl(url) {
  const pathname = url.split(/[?#]/, 1)[0];
  return path.join(
    outputRoot,
    pathname.replace(/^\.\//, "").split("/").join(path.sep)
  );
}

async function main() {
  const html = await readFile(path.join(outputRoot, "index.html"), "utf8");
  const appSource = await readFile(
    path.join(outputRoot, "assets", "app.js"),
    "utf8"
  );
  const stylesSource = await readFile(
    path.join(outputRoot, "assets", "styles.css"),
    "utf8"
  );
  assert(
    html.includes("./assets/app.js?v="),
    "index.html saknar versionsmärkt app.js."
  );
  assert(
    html.includes("./assets/styles.css?v="),
    "index.html saknar versionsmärkt styles.css."
  );
  assert(
    appSource.includes('cache: "no-store"'),
    "Bibliotek och sagomanifest måste hämtas utan gammal HTTP-cache."
  );
  assert(
    appSource.includes("./player-settings.js?v=") &&
      appSource.includes("./cast-queue.js?v="),
    "Spelarens delmoduler måste vara versionsmärkta."
  );
  assert(
    html.includes("cast_sender.js?loadCastFramework=1"),
    "index.html saknar Google Cast SDK."
  );
  assert(
    /<button[\s\S]*?id="castButton"/.test(html) &&
      !html.includes("<google-cast-launcher"),
    "Cast-kontrollen måste vara en vanlig knapp vars hela yta går att trycka på."
  );
  assert(
    appSource.includes("async function requestCastSession") &&
      appSource.includes("context.requestSession()"),
    "Cast-knappen måste öppna Google Casts enhetsväljare."
  );
  assert(html.includes('id="navigationButton"'), "Knappen för dolda kontroller saknas.");
  assert(
    appSource.includes("function setControlsHidden") &&
      stylesSource.includes(
        ".player-shell.is-controls-hidden .control-panel"
      ) &&
      !stylesSource.includes("body.is-navigation-hidden .app-header"),
    "Döljknappen ska dölja uppspelningskontrollerna, inte sidans navigation."
  );
  assert(html.includes('id="unlockDialog"'), "Dialogen för låsta böcker saknas.");

  const loadChapterStart = appSource.indexOf("async function loadChapter");
  const loadChapterEnd = appSource.indexOf(
    "\nasync function selectStory",
    loadChapterStart
  );
  const loadChapterSource = appSource.slice(loadChapterStart, loadChapterEnd);
  const mediaLoadIndex = loadChapterSource.indexOf(
    "elements.narration.load()"
  );
  const playbackRateIndex = loadChapterSource.lastIndexOf(
    "applyLocalPlaybackRate()"
  );
  assert(
    mediaLoadIndex >= 0 && playbackRateIndex > mediaLoadIndex,
    "Uppspelningshastigheten måste återställas efter att kapitlets ljud har laddats."
  );
  for (const eventName of ["loadedmetadata", "canplay", "play", "playing"]) {
    assert(
      appSource.includes(
        `elements.narration.addEventListener("${eventName}", applyLocalPlaybackRate)`
      ),
      `Spelaren måste skydda uppspelningshastigheten vid ${eventName}.`
    );
  }
  const animationLoopStart = appSource.indexOf("function runAnimationLoop");
  const animationLoopEnd = appSource.indexOf(
    "\nfunction setControlsHidden",
    animationLoopStart
  );
  assert(
    appSource
      .slice(animationLoopStart, animationLoopEnd)
      .includes("applyLocalPlaybackRate()"),
    "Uppspelningsloopen måste återställa vald hastighet om webbläsaren nollställer den."
  );
  assert(
    appSource.includes("createCastLoadRequest(chrome.cast.media, items,") &&
      !appSource.includes("new chrome.cast.media.QueueLoadRequest("),
    "Chromecast måste använda den verifierade LoadRequest-kön."
  );

  const library = JSON.parse(
    await readFile(path.join(outputRoot, "data", "library.json"), "utf8")
  );
  assert(library.stories.length > 0, "Biblioteket innehåller inga sagor.");

  for (const entry of library.stories) {
    await access(outputPathFromUrl(entry.cover));
    const manifest = JSON.parse(
      await readFile(outputPathFromUrl(entry.manifest), "utf8")
    );
    assert(manifest.chapters.length === entry.chapterCount, `${entry.slug}: fel antal kapitel.`);
    assert(manifest.totalDuration > 0, `${entry.slug}: total speltid saknas.`);
    assert(
      entry.locked === Boolean(manifest.access),
      `${entry.slug}: låsstatusen skiljer sig mellan bibliotek och manifest.`
    );

    for (const chapter of manifest.chapters) {
      await Promise.all([
        access(outputPathFromUrl(chapter.image)),
        access(outputPathFromUrl(chapter.audio)),
        access(outputPathFromUrl(chapter.captions)),
        access(outputPathFromUrl(chapter.text))
      ]);
      const vtt = await readFile(outputPathFromUrl(chapter.captions), "utf8");
      assert(vtt.startsWith("WEBVTT"), `${entry.slug}/${chapter.id}: ogiltig WebVTT.`);
      assert(chapter.transcript.length > 0, `${entry.slug}/${chapter.id}: tom transkription.`);
    }
  }

  const presentation = library.stories.find(
    (story) => story.slug === "den-stora-presentationen"
  );
  assert(presentation?.locked, "Den stora presentationen ska vara låst.");
  const presentationManifest = JSON.parse(
    await readFile(outputPathFromUrl(presentation.manifest), "utf8")
  );
  assert(
    presentationManifest.chapters[0].displayNumber === 0 &&
      presentationManifest.chapters.at(-1).displayNumber === 11,
    "Den stora presentationen ska visa kapitel 0–11."
  );
  assert(
    presentationManifest.chapters.every(
      (chapter) =>
        chapter.audio.includes("?v=") && chapter.captions.includes("?v=")
    ),
    "Presentationens ljud och undertexter måste ha innehållsbaserade cacheversioner."
  );
  for (const chapter of presentationManifest.chapters) {
    const firstParagraph = chapter.transcript[0].replace(/[.!?]+$/, "");
    const chapterTitle = chapter.title.replace(/[.!?]+$/, "");
    assert(
      firstParagraph !== chapterTitle,
      `${chapter.id}: kapitelrubriken får inte ingå i den upplästa texten.`
    );
  }
  const accessConfig = presentationManifest.access;
  const derivedPassword = pbkdf2Sync(
    "107",
    Buffer.from(accessConfig.salt, "base64"),
    accessConfig.iterations,
    32,
    "sha256"
  );
  assert(
    derivedPassword.equals(Buffer.from(accessConfig.hash, "base64")),
    "Lösenordskonfigurationen för Den stora presentationen är ogiltig."
  );

  console.log(`✓ Röktestet lyckades för ${library.stories.length} saga.`);
}

main().catch((error) => {
  console.error(`Röktestet misslyckades: ${error.message}`);
  process.exitCode = 1;
});
