"use strict";

const fs = require("fs");
const path = require("path");

function formatTimestamp(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}.` +
    `${String(millis).padStart(3, "0")}`
  );
}

function normalizePart(part) {
  return String(part || "").replace(/\s+/g, " ");
}

function createCaptionCues(wordCues) {
  const captions = [];
  let current = null;

  for (let index = 0; index < wordCues.length; index += 1) {
    const wordCue = wordCues[index];
    const part = normalizePart(wordCue.part);
    if (!part.trim()) {
      continue;
    }

    if (!current) {
      current = {
        start: Number(wordCue.start),
        end: Number(wordCue.end),
        text: part,
        words: part.trim().split(/\s+/).length
      };
    } else {
      current.end = Number(wordCue.end);
      current.text += part;
      current.words += part.trim().split(/\s+/).length;
    }

    const next = wordCues[index + 1];
    const sentenceEnd = /[.!?…][”"'’)\]]?\s*$/.test(current.text);
    const longEnough =
      current.words >= 11 ||
      current.text.trim().length >= 92 ||
      current.end - current.start >= 5200;
    const longPause = next && Number(next.start) - current.end >= 450;

    if (sentenceEnd || longEnough || longPause || !next) {
      current.text = current.text.replace(/\s+/g, " ").trim();
      if (current.text && current.end > current.start) {
        captions.push(current);
      }
      current = null;
    }
  }

  return captions;
}

function captionsToVtt(captions) {
  const blocks = captions.map(
    (caption, index) =>
      `${index + 1}\n` +
      `${formatTimestamp(caption.start)} --> ${formatTimestamp(caption.end)}\n` +
      `${caption.text}`
  );
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

async function main() {
  const [
    chapterPath,
    outputPath,
    voice = "sv-SE-MattiasNeural",
    lang = "sv-SE",
    rate = "-7%",
    outputFormat = "audio-24khz-96kbitrate-mono-mp3",
  ] = process.argv.slice(2);

  if (!chapterPath || !outputPath) {
    throw new Error("Chapter path and output path are required.");
  }

  const packagePath = path.join(
    __dirname,
    ".tts-verktyg",
    "node_modules",
    "node-edge-tts"
  );
  const { EdgeTTS } = require(packagePath);

  const text = fs.readFileSync(chapterPath, "utf8").trim();
  if (!text) {
    throw new Error(`Chapter is empty: ${chapterPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const partialAudioPath = `${outputPath}.partial-${process.pid}`;
  const partialSubtitlePath = `${partialAudioPath}.json`;
  const chapterBase = path.basename(chapterPath, path.extname(chapterPath));
  const vttPath = path.join(path.dirname(chapterPath), `${chapterBase}.vtt`);
  const partialVttPath = `${vttPath}.partial-${process.pid}`;

  const tts = new EdgeTTS({
    voice,
    lang,
    rate,
    outputFormat,
    saveSubtitles: true,
    timeout: 120000,
  });

  try {
    await tts.ttsPromise(text, partialAudioPath);

    const stats = fs.statSync(partialAudioPath);
    if (stats.size <= 1000) {
      throw new Error(`Generated file is unexpectedly small: ${partialAudioPath}`);
    }

    if (!fs.existsSync(partialSubtitlePath)) {
      throw new Error(`TTS timing data was not created: ${partialSubtitlePath}`);
    }

    const wordCues = JSON.parse(fs.readFileSync(partialSubtitlePath, "utf8"));
    if (!Array.isArray(wordCues) || wordCues.length === 0) {
      throw new Error(`TTS timing data is empty: ${partialSubtitlePath}`);
    }

    const captions = createCaptionCues(wordCues);
    if (captions.length === 0) {
      throw new Error(`No caption cues could be created for: ${chapterPath}`);
    }

    fs.writeFileSync(partialVttPath, captionsToVtt(captions), "utf8");

    if (fs.existsSync(outputPath)) {
      fs.rmSync(outputPath, { force: true });
    }
    fs.renameSync(partialAudioPath, outputPath);

    if (fs.existsSync(vttPath)) {
      fs.rmSync(vttPath, { force: true });
    }
    fs.renameSync(partialVttPath, vttPath);

    process.stdout.write(`Created: ${outputPath}\n`);
    process.stdout.write(`Created: ${vttPath}\n`);
  } finally {
    for (const temporaryPath of [
      partialAudioPath,
      partialSubtitlePath,
      partialVttPath,
    ]) {
      if (fs.existsSync(temporaryPath)) {
        fs.rmSync(temporaryPath, { force: true });
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
