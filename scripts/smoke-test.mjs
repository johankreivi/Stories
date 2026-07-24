import { access, readFile } from "node:fs/promises";
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
  return path.join(outputRoot, url.replace(/^\.\//, "").split("/").join(path.sep));
}

async function main() {
  const html = await readFile(path.join(outputRoot, "index.html"), "utf8");
  assert(html.includes("./assets/app.js"), "index.html saknar app.js.");
  assert(html.includes("./assets/styles.css"), "index.html saknar styles.css.");

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

  console.log(`✓ Röktestet lyckades för ${library.stories.length} saga.`);
}

main().catch((error) => {
  console.error(`Röktestet misslyckades: ${error.message}`);
  process.exitCode = 1;
});
