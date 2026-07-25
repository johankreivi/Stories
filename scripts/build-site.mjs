import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storiesRoot = path.join(root, "Stories");
const siteRoot = path.join(root, "site");
const outputRoot = path.join(root, "dist");
const validateOnly = process.argv.includes("--validate-only");
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function versionedUrl(url, content) {
  const version = createHash("sha256")
    .update(content)
    .digest("hex")
    .slice(0, 12);
  return `${url}?v=${version}`;
}

async function versionSiteAssets() {
  const htmlPath = path.join(outputRoot, "index.html");
  const appPath = path.join(outputRoot, "assets", "app.js");
  const stylesPath = path.join(outputRoot, "assets", "styles.css");
  const playerSettingsPath = path.join(
    outputRoot,
    "assets",
    "player-settings.js"
  );
  const castQueuePath = path.join(outputRoot, "assets", "cast-queue.js");
  const [html, rawAppSource, stylesSource, playerSettings, castQueue] =
    await Promise.all([
      readFile(htmlPath, "utf8"),
      readFile(appPath, "utf8"),
      readFile(stylesPath, "utf8"),
      readFile(playerSettingsPath, "utf8"),
      readFile(castQueuePath, "utf8")
    ]);
  const appSource = rawAppSource
    .replace(
      '"./player-settings.js"',
      `"${versionedUrl("./player-settings.js", playerSettings)}"`
    )
    .replace(
      '"./cast-queue.js"',
      `"${versionedUrl("./cast-queue.js", castQueue)}"`
    );
  await writeFile(appPath, appSource, "utf8");
  const versionedHtml = html
    .replace(
      'href="./assets/styles.css"',
      `href="${versionedUrl("./assets/styles.css", stylesSource)}"`
    )
    .replace(
      'src="./assets/app.js"',
      `src="${versionedUrl("./assets/app.js", appSource)}"`
    );
  await writeFile(htmlPath, versionedHtml, "utf8");
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toLocaleUpperCase("sv-SE") + word.slice(1))
    .join(" ");
}

function firstNonEmptyLine(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function paragraphsFromText(text) {
  return text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s*\r?\n\s*/g, " ").trim())
    .filter(Boolean);
}

function parseVttTimestamp(value) {
  const pieces = value.trim().split(":").map(Number);
  if (pieces.some((piece) => Number.isNaN(piece))) {
    return null;
  }
  if (pieces.length === 3) {
    return pieces[0] * 3600 + pieces[1] * 60 + pieces[2];
  }
  if (pieces.length === 2) {
    return pieces[0] * 60 + pieces[1];
  }
  return null;
}

function inspectVtt(raw, storySlug, chapterName) {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r/g, "");
  assert(
    normalized.startsWith("WEBVTT"),
    `${storySlug}/${chapterName}: undertexten måste börja med WEBVTT.`
  );

  const cues = [];
  const textSegments = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n").filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      continue;
    }

    const timingLine = lines[timingIndex];
    const [startValue, endWithSettings] = timingLine.split("-->");
    const endValue = endWithSettings.trim().split(/\s+/)[0];
    const start = parseVttTimestamp(startValue);
    const end = parseVttTimestamp(endValue);
    assert(
      start !== null && end !== null && end > start,
      `${storySlug}/${chapterName}: ogiltig tidskod "${timingLine}".`
    );
    assert(
      cues.length === 0 || start >= cues.at(-1).start,
      `${storySlug}/${chapterName}: tidskoderna ligger inte i ordning.`
    );
    cues.push({ start, end });
    textSegments.push(lines.slice(timingIndex + 1).join(" ").trim());
  }

  assert(
    cues.length > 0,
    `${storySlug}/${chapterName}: undertexten innehåller inga textsegment.`
  );

  return {
    cueCount: cues.length,
    firstStart: cues[0].start,
    lastEnd: cues.at(-1).end,
    text: textSegments.join(" ")
  };
}

function normalizeTranscript(text) {
  return text
    .normalize("NFC")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, "");
}

function parseFrameHeader(buffer, offset) {
  if (offset + 4 > buffer.length) {
    return null;
  }

  const header = buffer.readUInt32BE(offset);
  if (((header >>> 21) & 0x7ff) !== 0x7ff) {
    return null;
  }

  const versionBits = (header >>> 19) & 0x3;
  const layerBits = (header >>> 17) & 0x3;
  const bitrateIndex = (header >>> 12) & 0xf;
  const sampleRateIndex = (header >>> 10) & 0x3;
  const padding = (header >>> 9) & 0x1;

  if (
    versionBits === 1 ||
    layerBits !== 1 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleRateIndex === 3
  ) {
    return null;
  }

  const version1Bitrates = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320
  ];
  const version2Bitrates = [
    0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160
  ];
  const sampleRates = {
    3: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    0: [11025, 12000, 8000]
  };

  const isVersion1 = versionBits === 3;
  const bitrate = (isVersion1 ? version1Bitrates : version2Bitrates)[
    bitrateIndex
  ];
  const sampleRate = sampleRates[versionBits][sampleRateIndex];
  const samplesPerFrame = isVersion1 ? 1152 : 576;
  const coefficient = isVersion1 ? 144000 : 72000;
  const frameLength = Math.floor(
    (coefficient * bitrate) / sampleRate + padding
  );

  return { frameLength, samplesPerFrame, sampleRate };
}

function id3v2Size(buffer) {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "ID3") {
    return 0;
  }
  const flags = buffer[5];
  const size =
    ((buffer[6] & 0x7f) << 21) |
    ((buffer[7] & 0x7f) << 14) |
    ((buffer[8] & 0x7f) << 7) |
    (buffer[9] & 0x7f);
  return 10 + size + (flags & 0x10 ? 10 : 0);
}

function mp3Duration(buffer, label) {
  let offset = id3v2Size(buffer);
  const searchEnd = Math.min(buffer.length - 4, offset + 65536);
  while (offset < searchEnd && !parseFrameHeader(buffer, offset)) {
    offset += 1;
  }

  assert(offset < searchEnd, `${label}: kunde inte hitta några MP3-bildrutor.`);

  let seconds = 0;
  let frames = 0;
  while (offset + 4 <= buffer.length) {
    const frame = parseFrameHeader(buffer, offset);
    if (!frame || offset + frame.frameLength > buffer.length) {
      break;
    }
    seconds += frame.samplesPerFrame / frame.sampleRate;
    frames += 1;
    offset += frame.frameLength;
  }

  assert(frames > 0, `${label}: MP3-filen innehåller inget läsbart ljud.`);
  return Math.round(seconds * 1000) / 1000;
}

async function readOptionalJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw new Error(`${filePath}: kunde inte läsa JSON (${error.message}).`);
  }
}

async function ensureDirectory(directory, storySlug) {
  const info = await stat(directory).catch(() => null);
  assert(info?.isDirectory(), `${storySlug}: mappen ${path.basename(directory)} saknas.`);
}

function mapFilesByLowercase(files) {
  return new Map(files.map((file) => [file.name.toLocaleLowerCase(), file]));
}

async function scanStory(storyDirent) {
  const slug = storyDirent.name;
  assert(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),
    `${slug}: sagomappen måste ha ett URL-säkert namn med små bokstäver, siffror och bindestreck.`
  );

  const sourceRoot = path.join(storiesRoot, slug);
  const imageRoot = path.join(sourceRoot, "bilder");
  const chapterRoot = path.join(sourceRoot, "kapitel");
  const audioRoot = path.join(sourceRoot, "ljud");
  await Promise.all([
    ensureDirectory(imageRoot, slug),
    ensureDirectory(chapterRoot, slug),
    ensureDirectory(audioRoot, slug)
  ]);

  const metadata = await readOptionalJson(path.join(sourceRoot, "saga.json"), {});
  const language = metadata.language || "sv-SE";
  const title = metadata.title || titleFromSlug(slug);
  const chapterNumberStart = Number.isInteger(metadata.chapterNumberStart)
    ? metadata.chapterNumberStart
    : 1;
  const access = metadata.access ?? null;
  if (access) {
    assert(
      access.type === "password",
      `${slug}: access.type måste vara "password".`
    );
    assert(
      access.algorithm === "PBKDF2-SHA-256",
      `${slug}: access.algorithm måste vara "PBKDF2-SHA-256".`
    );
    assert(
      Number.isInteger(access.iterations) && access.iterations >= 100000,
      `${slug}: access.iterations måste vara minst 100000.`
    );
    assert(
      typeof access.salt === "string" && access.salt.length > 0,
      `${slug}: access.salt saknas.`
    );
    assert(
      typeof access.hash === "string" && access.hash.length > 0,
      `${slug}: access.hash saknas.`
    );
  }

  const [imageFiles, chapterFiles, audioFiles] = await Promise.all([
    readdir(imageRoot, { withFileTypes: true }),
    readdir(chapterRoot, { withFileTypes: true }),
    readdir(audioRoot, { withFileTypes: true })
  ]);

  const usableImages = imageFiles
    .filter((file) => file.isFile() && imageExtensions.has(path.extname(file.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "sv-SE"));
  const textFiles = chapterFiles
    .filter((file) => file.isFile() && path.extname(file.name).toLowerCase() === ".txt")
    .sort((a, b) => a.name.localeCompare(b.name, "sv-SE", { numeric: true }));
  const vttByName = mapFilesByLowercase(
    chapterFiles.filter(
      (file) => file.isFile() && path.extname(file.name).toLowerCase() === ".vtt"
    )
  );
  const audioByName = mapFilesByLowercase(
    audioFiles.filter(
      (file) => file.isFile() && path.extname(file.name).toLowerCase() === ".mp3"
    )
  );

  assert(textFiles.length > 0, `${slug}: inga TXT-kapitel hittades.`);

  let cover = null;
  const imageForChapter = new Map();
  const imageRecords = new Map();

  for (const image of usableImages) {
    const extension = path.extname(image.name).toLowerCase();
    const base = path.basename(image.name, extension);
    const match = base.match(/^(\d+(?:_\d+)*)-(.+)$/);
    assert(
      match,
      `${slug}/bilder/${image.name}: bildnamnet ska börja med kapitelnummer och bindestreck.`
    );

    const numbers = match[1].split("_").map(Number);
    const source = path.join(imageRoot, image.name);
    if (numbers.length === 1 && numbers[0] === 0) {
      assert(!cover, `${slug}: fler än ett 00-omslag hittades.`);
      cover = {
        source,
        outputName: `omslag${extension}`,
        url: `./sagor/${slug}/bilder/omslag${extension}`
      };
      continue;
    }

    assert(!numbers.includes(0), `${slug}/bilder/${image.name}: 00 får bara användas för omslaget.`);
    const outputName = `kapitel-${numbers.map((number) => String(number).padStart(2, "0")).join("-")}${extension}`;
    const record = {
      source,
      outputName,
      url: `./sagor/${slug}/bilder/${outputName}`
    };
    imageRecords.set(image.name, record);

    for (const number of numbers) {
      assert(
        !imageForChapter.has(number),
        `${slug}: kapitel ${number} täcks av flera bilder.`
      );
      imageForChapter.set(number, record);
    }
  }

  assert(cover, `${slug}: ett omslag vars namn börjar med 00- saknas.`);

  const chapters = [];
  const seenNumbers = new Set();
  for (const textFile of textFiles) {
    const base = path.basename(textFile.name, path.extname(textFile.name));
    const match = base.match(/^(\d+)-(.+)$/);
    assert(
      match,
      `${slug}/kapitel/${textFile.name}: kapitlet ska börja med ett nummer och bindestreck.`
    );

    const number = Number(match[1]);
    assert(number > 0, `${slug}: kapitelnummer måste vara större än noll.`);
    assert(!seenNumbers.has(number), `${slug}: kapitel ${number} förekommer flera gånger.`);
    seenNumbers.add(number);

    const audioFile = audioByName.get(`${base}.mp3`.toLocaleLowerCase());
    const vttFile = vttByName.get(`${base}.vtt`.toLocaleLowerCase());
    assert(audioFile, `${slug}: ljud/${base}.mp3 saknas.`);
    assert(vttFile, `${slug}: kapitel/${base}.vtt saknas.`);
    assert(imageForChapter.has(number), `${slug}: kapitel ${number} saknar kapitelbild.`);

    const textSource = path.join(chapterRoot, textFile.name);
    const audioSource = path.join(audioRoot, audioFile.name);
    const captionsSource = path.join(chapterRoot, vttFile.name);
    const [rawText, rawVtt, audioBuffer] = await Promise.all([
      readFile(textSource, "utf8"),
      readFile(captionsSource, "utf8"),
      readFile(audioSource)
    ]);

    const duration = mp3Duration(audioBuffer, `${slug}/ljud/${audioFile.name}`);
    const vtt = inspectVtt(rawVtt, slug, vttFile.name);
    assert(
      normalizeTranscript(vtt.text) === normalizeTranscript(rawText),
      `${slug}/${vttFile.name}: undertexten innehåller inte exakt samma text som kapitlet.`
    );
    assert(
      vtt.lastEnd <= duration + 0.75,
      `${slug}/${vttFile.name}: sista tidskoden (${vtt.lastEnd.toFixed(3)} s) ligger efter ljudet (${duration.toFixed(3)} s).`
    );

    const paragraphs = paragraphsFromText(rawText);
    assert(paragraphs.length > 0, `${slug}/${textFile.name}: kapitlet är tomt.`);
    const metadataTitle = metadata.chapterTitles?.[base];
    assert(
      metadataTitle === undefined ||
        (typeof metadataTitle === "string" && metadataTitle.trim().length > 0),
      `${slug}/${textFile.name}: kapitelrubriken i saga.json är ogiltig.`
    );

    const outputNumber = String(number).padStart(2, "0");
    chapters.push({
      number,
      id: base,
      title:
        metadataTitle?.trim() ||
        firstNonEmptyLine(rawText).replace(/\s+$/, ""),
      duration,
      transcript: paragraphs,
      image: imageForChapter.get(number).url,
      audio: versionedUrl(
        `./sagor/${slug}/ljud/${outputNumber}.mp3`,
        audioBuffer
      ),
      captions: versionedUrl(
        `./sagor/${slug}/kapitel/${outputNumber}.vtt`,
        rawVtt
      ),
      text: versionedUrl(
        `./sagor/${slug}/kapitel/${outputNumber}.txt`,
        rawText
      ),
      sources: { textSource, audioSource, captionsSource },
      outputs: {
        textName: `${outputNumber}.txt`,
        audioName: `${outputNumber}.mp3`,
        captionsName: `${outputNumber}.vtt`
      },
      cueCount: vtt.cueCount
    });
  }

  chapters.sort((a, b) => a.number - b.number);
  chapters.forEach((chapter, index) => {
    assert(
      chapter.number === index + 1,
      `${slug}: kapitelnumren ska vara sammanhängande från 01.`
    );
  });

  const publicChapters = chapters.map(
    ({ sources, outputs, cueCount, ...chapter }, index) => ({
      ...chapter,
      displayNumber: chapterNumberStart + index
    })
  );
  const totalDuration = Math.round(
    publicChapters.reduce((sum, chapter) => sum + chapter.duration, 0) * 1000
  ) / 1000;

  return {
    slug,
    sourceRoot,
    cover,
    imageRecords: [...imageRecords.values()],
    chapters,
    publicManifest: {
      slug,
      title,
      description: metadata.description || "",
      language,
      narrator: metadata.narrator || "",
      access,
      cover: cover.url,
      totalDuration,
      chapters: publicChapters
    }
  };
}

async function buildStory(story) {
  const outputStoryRoot = path.join(outputRoot, "sagor", story.slug);
  const outputImages = path.join(outputStoryRoot, "bilder");
  const outputChapters = path.join(outputStoryRoot, "kapitel");
  const outputAudio = path.join(outputStoryRoot, "ljud");
  await Promise.all([
    mkdir(outputImages, { recursive: true }),
    mkdir(outputChapters, { recursive: true }),
    mkdir(outputAudio, { recursive: true })
  ]);

  await copyFile(story.cover.source, path.join(outputImages, story.cover.outputName));
  for (const image of story.imageRecords) {
    await copyFile(image.source, path.join(outputImages, image.outputName));
  }
  for (const chapter of story.chapters) {
    await Promise.all([
      copyFile(chapter.sources.textSource, path.join(outputChapters, chapter.outputs.textName)),
      copyFile(chapter.sources.captionsSource, path.join(outputChapters, chapter.outputs.captionsName)),
      copyFile(chapter.sources.audioSource, path.join(outputAudio, chapter.outputs.audioName))
    ]);
  }

  const manifestPath = path.join(outputRoot, "data", "stories", `${story.slug}.json`);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(story.publicManifest, null, 2)}\n`,
    "utf8"
  );
}

async function main() {
  const storyDirents = (await readdir(storiesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "sv-SE"));
  assert(storyDirents.length > 0, "Inga sagomappar hittades under Stories.");

  const stories = [];
  for (const dirent of storyDirents) {
    stories.push(await scanStory(dirent));
  }

  if (!validateOnly) {
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(outputRoot, { recursive: true });
    await cp(siteRoot, outputRoot, { recursive: true });
    await versionSiteAssets();
    await mkdir(path.join(outputRoot, "data"), { recursive: true });

    for (const story of stories) {
      await buildStory(story);
    }

    const library = {
      generatedAt: new Date().toISOString(),
      stories: stories.map((story) => ({
        slug: story.slug,
        title: story.publicManifest.title,
        description: story.publicManifest.description,
        cover: story.publicManifest.cover,
        chapterCount: story.publicManifest.chapters.length,
        totalDuration: story.publicManifest.totalDuration,
        locked: Boolean(story.publicManifest.access),
        manifest: `./data/stories/${story.slug}.json`
      }))
    };
    await writeFile(
      path.join(outputRoot, "data", "library.json"),
      `${JSON.stringify(library, null, 2)}\n`,
      "utf8"
    );
    await writeFile(path.join(outputRoot, ".nojekyll"), "", "utf8");
  }

  for (const story of stories) {
    const cueCount = story.chapters.reduce(
      (sum, chapter) => sum + chapter.cueCount,
      0
    );
    console.log(
      `✓ ${story.publicManifest.title}: ${story.chapters.length} kapitel, ` +
        `${cueCount} undertextsegment, ${story.publicManifest.totalDuration.toFixed(3)} s`
    );
  }
  console.log(validateOnly ? "Valideringen lyckades." : "Webbplatsen byggdes i dist.");
}

main().catch((error) => {
  console.error(`\nBygget avbröts: ${error.message}`);
  process.exitCode = 1;
});
