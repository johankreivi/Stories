import {
  enforcePlaybackRate,
  normalizePlaybackRate
} from "./player-settings.js";
import { createCastLoadRequest } from "./cast-queue.js";

const $ = (selector) => document.querySelector(selector);

const elements = {
  storySelect: $("#storySelect"),
  playerShell: $("#playerShell"),
  visualStage: $("#visualStage"),
  chapterImage: $("#chapterImage"),
  chapterChip: $("#chapterChip"),
  fullscreenButton: $("#fullscreenButton"),
  navigationButton: $("#navigationButton"),
  captionRegion: $("#captionRegion"),
  captionText: $("#captionText"),
  stageStatus: $("#stageStatus"),
  storyMeta: $("#storyMeta"),
  storyTitle: $("#storyTitle"),
  chapterTitle: $("#chapterTitle"),
  captionButton: $("#captionButton"),
  captionButtonLabel: $("#captionButtonLabel"),
  progressRange: $("#progressRange"),
  currentTime: $("#currentTime"),
  progressLabel: $("#progressLabel"),
  totalTime: $("#totalTime"),
  previousButton: $("#previousButton"),
  playButton: $("#playButton"),
  playIcon: $("#playIcon"),
  nextButton: $("#nextButton"),
  castButton: $("#castButton"),
  castLabel: $("#castLabel"),
  speedSelect: $("#speedSelect"),
  transcriptText: $("#transcriptText"),
  chapterList: $("#chapterList"),
  narration: $("#narration"),
  errorPanel: $("#errorPanel"),
  errorMessage: $("#errorMessage"),
  retryButton: $("#retryButton"),
  unlockDialog: $("#unlockDialog"),
  unlockForm: $("#unlockForm"),
  unlockTitle: $("#unlockTitle"),
  unlockDescription: $("#unlockDescription"),
  passwordInput: $("#passwordInput"),
  unlockError: $("#unlockError"),
  unlockCancelButton: $("#unlockCancelButton")
};

const state = {
  library: [],
  story: null,
  chapterIndex: 0,
  chapterOffsets: [],
  totalDuration: 0,
  fallbackCues: [],
  captionTrack: null,
  captionTrackElement: null,
  captionsEnabled: localStorage.getItem("sagostund:captions") !== "off",
  playbackRate: normalizePlaybackRate(
    localStorage.getItem("sagostund:speed")
  ),
  controlsHidden:
    localStorage.getItem("sagostund:controls-hidden") === "true",
  started: false,
  loadingToken: 0,
  animationFrame: 0,
  lastCaption: "",
  previewTime: null,
  cast: {
    available: false,
    initialized: false,
    loading: false,
    loaded: false,
    session: null,
    remotePlayer: null,
    controller: null,
    listeners: [],
    chapterIndex: 0,
    currentTime: 0,
    isPaused: true
  }
};

function resolveUrl(relativePath) {
  return new URL(relativePath.replace(/^\.\//, ""), document.baseURI).href;
}

async function fetchJson(relativePath) {
  const response = await fetch(resolveUrl(relativePath), {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Kunde inte läsa ${relativePath} (${response.status}).`);
  }
  return response.json();
}

function bytesFromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function verifyStoryPassword(password, access) {
  if (!window.crypto?.subtle) {
    throw new Error("Webbläsaren saknar stöd för säker lösenordskontroll.");
  }

  const key = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = new Uint8Array(
    await window.crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: bytesFromBase64(access.salt),
        iterations: access.iterations
      },
      key,
      256
    )
  );
  return constantTimeEqual(derived, bytesFromBase64(access.hash));
}

function storyUnlockKey(story) {
  return `sagostund:unlocked:${story.slug}:${story.access.hash}`;
}

async function requestStoryUnlock(story) {
  if (!story.access) {
    return true;
  }
  if (sessionStorage.getItem(storyUnlockKey(story)) === "true") {
    return true;
  }

  elements.unlockTitle.textContent = `Öppna ${story.title}`;
  elements.unlockDescription.textContent =
    "Ange bokens lösenord. Upplåsningen gäller under den här fliken.";
  elements.passwordInput.value = "";
  elements.unlockError.hidden = true;

  return new Promise((resolve) => {
    const submitButton = elements.unlockForm.querySelector(
      'button[type="submit"]'
    );

    const cleanup = () => {
      elements.unlockForm.removeEventListener("submit", onSubmit);
      elements.unlockCancelButton.removeEventListener("click", onCancel);
      elements.unlockDialog.removeEventListener("cancel", onDialogCancel);
    };
    const finish = (unlocked) => {
      cleanup();
      if (elements.unlockDialog.open) {
        elements.unlockDialog.close();
      }
      resolve(unlocked);
    };
    const onCancel = () => finish(false);
    const onDialogCancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    const onSubmit = async (event) => {
      event.preventDefault();
      elements.unlockError.hidden = true;
      submitButton.disabled = true;
      try {
        const valid = await verifyStoryPassword(
          elements.passwordInput.value,
          story.access
        );
        if (valid) {
          sessionStorage.setItem(storyUnlockKey(story), "true");
          finish(true);
          return;
        }
        elements.unlockError.hidden = false;
        elements.passwordInput.select();
      } catch (error) {
        elements.unlockError.textContent =
          error instanceof Error
            ? error.message
            : "Lösenordet kunde inte kontrolleras.";
        elements.unlockError.hidden = false;
      } finally {
        submitButton.disabled = false;
      }
    };

    elements.unlockForm.addEventListener("submit", onSubmit);
    elements.unlockCancelButton.addEventListener("click", onCancel);
    elements.unlockDialog.addEventListener("cancel", onDialogCancel);
    elements.unlockDialog.showModal();
    elements.passwordInput.focus();
  });
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function paragraphNodes(paragraphs) {
  const fragment = document.createDocumentFragment();
  for (const paragraph of paragraphs) {
    const node = document.createElement("p");
    node.textContent = paragraph;
    fragment.append(node);
  }
  return fragment;
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

function parseVtt(raw) {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const blocks = normalized.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      continue;
    }

    const [startValue, endWithSettings] = lines[timingIndex].split("-->");
    const endValue = endWithSettings.trim().split(/\s+/)[0];
    const start = parseVttTimestamp(startValue);
    const end = parseVttTimestamp(endValue);
    const text = lines.slice(timingIndex + 1).join(" ").trim();

    if (start !== null && end !== null && end > start && text) {
      cues.push({ start, end, text });
    }
  }

  return cues;
}

function currentChapter() {
  return state.story?.chapters[state.chapterIndex] ?? null;
}

function chapterDisplayNumber(chapter) {
  return chapter?.displayNumber ?? chapter?.number ?? 1;
}

function setStageStatus(message = "") {
  elements.stageStatus.textContent = message;
  elements.stageStatus.hidden = !message;
}

function showError(error) {
  console.error(error);
  elements.playerShell.hidden = true;
  elements.errorPanel.hidden = false;
  elements.errorMessage.textContent =
    error instanceof Error ? error.message : "Ett oväntat fel inträffade.";
}

function clearError() {
  elements.errorPanel.hidden = true;
  elements.playerShell.hidden = false;
}

function setImage(path, alt, isCover = false) {
  elements.chapterImage.classList.remove("is-ready");
  elements.chapterImage.classList.toggle("is-cover", isCover);
  elements.chapterImage.alt = alt;

  const nextUrl = resolveUrl(path);
  if (elements.chapterImage.src === nextUrl && elements.chapterImage.complete) {
    elements.chapterImage.classList.add("is-ready");
    return;
  }

  elements.chapterImage.onload = () => {
    elements.chapterImage.classList.add("is-ready");
  };
  elements.chapterImage.onerror = () => {
    setStageStatus("Kapitlets bild kunde inte laddas.");
  };
  elements.chapterImage.src = nextUrl;
}

function setCurrentChapterImage() {
  const chapter = currentChapter();
  if (!chapter) {
    return;
  }
  setImage(
    chapter.image,
    `Kapitelbild till ${chapter.title}`,
    false
  );
  preloadImage(state.story.chapters[state.chapterIndex + 1]?.image);
}

function setCoverImage() {
  if (!state.story) {
    return;
  }
  setImage(state.story.cover, `Omslag till ${state.story.title}`, true);
  preloadImage(state.story.chapters[0]?.image);
}

function preloadImage(path) {
  if (!path) {
    return;
  }
  const image = new Image();
  image.src = resolveUrl(path);
}

function renderStoryPicker() {
  elements.storySelect.replaceChildren();
  for (const story of state.library) {
    const option = document.createElement("option");
    option.value = story.slug;
    option.textContent = `${story.locked ? "🔒 " : ""}${story.title}`;
    elements.storySelect.append(option);
  }
}

function renderChapterList() {
  elements.chapterList.replaceChildren();

  state.story.chapters.forEach((chapter, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "chapter-item";
    button.type = "button";
    button.dataset.chapterIndex = String(index);

    const number = document.createElement("span");
    number.className = "chapter-number";
    number.textContent = String(chapterDisplayNumber(chapter)).padStart(2, "0");

    const copy = document.createElement("span");
    copy.className = "chapter-copy";
    const title = document.createElement("strong");
    title.textContent = chapter.title;
    const label = document.createElement("small");
    label.textContent = `Kapitel ${chapterDisplayNumber(chapter)}`;
    copy.append(title, label);

    const duration = document.createElement("span");
    duration.className = "chapter-duration";
    duration.textContent = formatTime(chapter.duration);

    button.append(number, copy, duration);
    button.addEventListener("click", async () => {
      const shouldContinue = !playbackIsPaused();
      state.started = true;
      if (isCasting()) {
        await startCastPlayback(index, 0, { autoplay: shouldContinue });
      } else {
        await loadChapter(index, { autoplay: shouldContinue });
        setCurrentChapterImage();
      }
    });
    item.append(button);
    elements.chapterList.append(item);
  });
}

function updateActiveChapter() {
  const buttons = elements.chapterList.querySelectorAll(".chapter-item");
  buttons.forEach((button, index) => {
    const active = index === state.chapterIndex;
    button.classList.toggle("is-active", active);
    if (active) {
      button.setAttribute("aria-current", "true");
    } else {
      button.removeAttribute("aria-current");
    }
  });
}

function renderTranscript() {
  const chapter = currentChapter();
  elements.transcriptText.replaceChildren(
    paragraphNodes(chapter?.transcript ?? [])
  );
}

function updateChapterUi() {
  const chapter = currentChapter();
  if (!chapter) {
    return;
  }

  elements.chapterChip.textContent =
    `Kapitel ${chapterDisplayNumber(chapter)} av ${state.story.chapters.length - 1 + chapterDisplayNumber(state.story.chapters[0])}`;
  elements.chapterTitle.textContent = chapter.title;
  elements.progressLabel.textContent = `Kapitel ${chapterDisplayNumber(chapter)}`;
  elements.previousButton.disabled = state.chapterIndex === 0;
  elements.nextButton.disabled =
    state.chapterIndex === state.story.chapters.length - 1;
  renderTranscript();
  updateActiveChapter();
}

function calculateOffsets() {
  let offset = 0;
  state.chapterOffsets = state.story.chapters.map((chapter) => {
    const current = offset;
    offset += chapter.duration;
    return current;
  });
  state.totalDuration = offset;
  elements.progressRange.max = String(offset);
  elements.totalTime.textContent = formatTime(offset);
}

function globalCurrentTime() {
  return (
    (state.chapterOffsets[state.chapterIndex] ?? 0) +
    playbackCurrentTime()
  );
}

function playbackCurrentTime() {
  if (isCasting()) {
    return Number(state.cast.remotePlayer?.currentTime) || state.cast.currentTime || 0;
  }
  return elements.narration.currentTime || 0;
}

function playbackIsPaused() {
  if (isCasting()) {
    return state.cast.remotePlayer?.isPaused ?? state.cast.isPaused;
  }
  return elements.narration.paused;
}

function applyLocalPlaybackRate() {
  if (!state.story || isCasting()) {
    return;
  }
  enforcePlaybackRate(elements.narration, state.playbackRate);
}

function updateProgress() {
  if (!state.story) {
    return;
  }

  const value =
    state.previewTime === null ? globalCurrentTime() : state.previewTime;
  const percentage =
    state.totalDuration > 0 ? (value / state.totalDuration) * 100 : 0;

  if (state.previewTime === null) {
    elements.progressRange.value = String(value);
  }
  elements.progressRange.style.setProperty(
    "--progress",
    `${Math.min(100, Math.max(0, percentage))}%`
  );
  elements.currentTime.textContent = formatTime(value);
  elements.progressRange.setAttribute(
    "aria-valuetext",
    `${formatTime(value)} av ${formatTime(state.totalDuration)}`
  );
}

function captionFromFallback(time) {
  let low = 0;
  let high = state.fallbackCues.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cue = state.fallbackCues[middle];
    if (time < cue.start) {
      high = middle - 1;
    } else if (time > cue.end) {
      low = middle + 1;
    } else {
      return cue.text;
    }
  }

  return "";
}

function renderCaption() {
  if (!state.captionsEnabled) {
    elements.captionRegion.hidden = true;
    return;
  }

  let text = "";
  const activeCues = state.captionTrack?.activeCues;
  if (!isCasting() && activeCues?.length) {
    text = activeCues[0].text;
  } else {
    text = captionFromFallback(playbackCurrentTime());
  }

  if (text !== state.lastCaption) {
    state.lastCaption = text;
    elements.captionText.textContent = text;
  }
  elements.captionRegion.hidden = !text;
}

async function loadCaptions(chapter, token) {
  state.fallbackCues = [];
  state.captionTrack = null;
  state.lastCaption = "";
  elements.captionText.textContent = "";
  elements.captionRegion.hidden = true;

  if (state.captionTrackElement) {
    state.captionTrackElement.remove();
    state.captionTrackElement = null;
  }

  const trackElement = document.createElement("track");
  trackElement.kind = "subtitles";
  trackElement.srclang = state.story.language.split("-")[0];
  trackElement.label = "Svenska";
  trackElement.src = resolveUrl(chapter.captions);
  trackElement.default = true;
  elements.narration.append(trackElement);
  state.captionTrackElement = trackElement;

  trackElement.addEventListener("load", () => {
    if (token !== state.loadingToken) {
      return;
    }
    state.captionTrack = trackElement.track;
    state.captionTrack.mode = "hidden";
    trackElement.addEventListener("cuechange", renderCaption);
  });

  try {
    trackElement.track.mode = "hidden";
  } catch {
    // Den egenrenderade WebVTT-reserven används om webbläsaren inte laddar spåret.
  }

  try {
    const response = await fetch(resolveUrl(chapter.captions));
    if (!response.ok) {
      throw new Error(`Undertexten gav status ${response.status}.`);
    }
    const raw = await response.text();
    if (token === state.loadingToken) {
      state.fallbackCues = parseVtt(raw);
    }
  } catch (error) {
    console.warn("Undertexten kunde inte laddas som reserv.", error);
  }
}

function once(target, eventName) {
  return new Promise((resolve, reject) => {
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Ljudfilen kunde inte laddas."));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function loadChapter(index, options = {}) {
  if (!state.story || index < 0 || index >= state.story.chapters.length) {
    return;
  }

  const token = ++state.loadingToken;
  const chapter = state.story.chapters[index];
  const startTime = Math.max(0, options.startTime ?? 0);
  elements.narration.pause();
  state.chapterIndex = index;
  state.previewTime = null;
  setStageStatus("Laddar kapitlet…");
  updateChapterUi();

  applyLocalPlaybackRate();
  elements.narration.src = resolveUrl(chapter.audio);
  elements.narration.load();
  applyLocalPlaybackRate();

  const captionsPromise = loadCaptions(chapter, token);

  try {
    if (elements.narration.readyState < 1) {
      await once(elements.narration, "loadedmetadata");
    }
    if (token !== state.loadingToken) {
      return;
    }

    applyLocalPlaybackRate();
    if ("preservesPitch" in elements.narration) {
      elements.narration.preservesPitch = true;
    }
    elements.narration.currentTime = Math.min(
      startTime,
      Math.max(0, chapter.duration - 0.05)
    );
    await captionsPromise;
    setStageStatus("");
    updateProgress();

    if (options.autoplay) {
      await elements.narration.play();
      applyLocalPlaybackRate();
    }
  } catch (error) {
    if (token === state.loadingToken) {
      setStageStatus("Kapitlet kunde inte spelas.");
      throw error;
    }
  }
}

async function selectStory(slug) {
  clearError();
  setStageStatus("Laddar sagan…");

  const libraryEntry =
    state.library.find((story) => story.slug === slug) ?? state.library[0];
  if (!libraryEntry) {
    throw new Error("Inga sagor hittades.");
  }

  const nextStory = await fetchJson(libraryEntry.manifest);
  const unlocked = await requestStoryUnlock(nextStory);
  if (!unlocked) {
    elements.storySelect.value = state.story?.slug ?? "";
    setStageStatus("");
    return false;
  }

  const continueCasting = isCasting();
  elements.narration.pause();
  cancelAnimationFrame(state.animationFrame);
  state.story = nextStory;
  state.chapterIndex = 0;
  state.started = false;
  setCastUi();

  elements.storySelect.value = state.story.slug;
  elements.storyTitle.textContent = state.story.title;
  elements.storyMeta.textContent = state.story.narrator
    ? `Berättad av ${state.story.narrator}`
    : "Ljudsaga";
  document.title = `${state.story.title} – Sagostund`;

  const url = new URL(window.location.href);
  url.searchParams.set("saga", state.story.slug);
  history.replaceState({}, "", url);

  calculateOffsets();
  renderChapterList();
  setCoverImage();
  await loadChapter(0);
  setCoverImage();
  setStageStatus("");
  if (continueCasting) {
    await startCastPlayback(0, 0, { autoplay: true });
  }
  return true;
}

async function togglePlay() {
  if (!state.story) {
    return;
  }

  if (!state.started) {
    state.started = true;
    setCurrentChapterImage();
  }

  if (isCasting()) {
    state.cast.controller.playOrPause();
    return;
  }

  if (elements.narration.paused) {
    try {
      await elements.narration.play();
      applyLocalPlaybackRate();
    } catch (error) {
      setStageStatus("Tryck på spela igen för att starta ljudet.");
      console.warn(error);
    }
  } else {
    elements.narration.pause();
  }
}

async function seekToGlobalTime(target) {
  if (!state.story) {
    return;
  }

  const bounded = Math.min(
    Math.max(0, target),
    Math.max(0, state.totalDuration - 0.01)
  );
  let nextIndex = state.story.chapters.length - 1;

  for (let index = 0; index < state.story.chapters.length; index += 1) {
    const start = state.chapterOffsets[index];
    const end = start + state.story.chapters[index].duration;
    if (bounded >= start && bounded < end) {
      nextIndex = index;
      break;
    }
  }

  const chapterTime = bounded - state.chapterOffsets[nextIndex];
  const shouldContinue = !playbackIsPaused();
  state.started = true;

  if (isCasting()) {
    if (nextIndex === state.chapterIndex) {
      state.cast.remotePlayer.currentTime = chapterTime;
      state.cast.controller.seek();
      state.cast.currentTime = chapterTime;
      setCurrentChapterImage();
      updateProgress();
      renderCaption();
    } else {
      await startCastPlayback(nextIndex, chapterTime, {
        autoplay: shouldContinue
      });
    }
    return;
  }

  if (nextIndex === state.chapterIndex) {
    elements.narration.currentTime = chapterTime;
    setCurrentChapterImage();
    updateProgress();
    renderCaption();
  } else {
    await loadChapter(nextIndex, {
      autoplay: shouldContinue,
      startTime: chapterTime
    });
    setCurrentChapterImage();
  }
}

function setCaptionsEnabled(enabled) {
  state.captionsEnabled = enabled;
  localStorage.setItem("sagostund:captions", enabled ? "on" : "off");
  elements.captionButton.setAttribute("aria-pressed", String(enabled));
  elements.captionButtonLabel.textContent = enabled
    ? "Undertext på"
    : "Undertext av";
  renderCaption();
}

function updatePlayButton(playing) {
  elements.playButton.classList.toggle("is-playing", playing);
  elements.playButton.setAttribute("aria-label", playing ? "Pausa" : "Spela");
  elements.playIcon.textContent = playing ? "❚❚" : "▶";
}

function runAnimationLoop() {
  cancelAnimationFrame(state.animationFrame);
  const tick = () => {
    applyLocalPlaybackRate();
    updateProgress();
    renderCaption();
    if (!playbackIsPaused() && (isCasting() || !elements.narration.ended)) {
      state.animationFrame = requestAnimationFrame(tick);
    }
  };
  state.animationFrame = requestAnimationFrame(tick);
}

function setControlsHidden(hidden) {
  state.controlsHidden = hidden;
  elements.playerShell.classList.toggle("is-controls-hidden", hidden);
  localStorage.setItem("sagostund:controls-hidden", String(hidden));
  elements.navigationButton.setAttribute("aria-pressed", String(hidden));
  elements.navigationButton.setAttribute(
    "aria-label",
    hidden ? "Visa uppspelningskontrollerna" : "Dölj uppspelningskontrollerna"
  );
  elements.navigationButton.title = hidden
    ? "Visa kontroller (N)"
    : "Dölj kontroller (N)";
  elements.navigationButton.querySelector("span").textContent = hidden
    ? "⌃"
    : "⌄";
}

function isCasting() {
  return Boolean(
    state.cast.loaded &&
      state.cast.session &&
      state.cast.remotePlayer &&
      state.cast.remotePlayer.isConnected !== false
  );
}

function setCastUi(message = "") {
  const connected = isCasting();
  elements.castButton.classList.toggle("is-ready", state.cast.initialized);
  elements.castButton.classList.toggle("is-connected", connected);
  elements.castButton.disabled =
    !state.cast.initialized || !state.story || state.cast.loading;
  elements.castLabel.textContent =
    message || (connected ? "Castar" : "Casta");
  elements.castButton.title = connected
    ? "Hantera Chromecast-anslutningen"
    : state.cast.available
      ? "Välj en Chromecast"
      : "Sök efter Chromecast-enheter";
  elements.speedSelect.disabled = connected;
  elements.speedSelect.title = connected
    ? "Uppspelningshastighet kan ändras när ljudet spelas på den här enheten."
    : "";
}

function detachRemotePlayer() {
  if (state.cast.controller) {
    for (const [eventType, listener] of state.cast.listeners) {
      state.cast.controller.removeEventListener(eventType, listener);
    }
  }
  state.cast.listeners = [];
  state.cast.remotePlayer = null;
  state.cast.controller = null;
}

function syncCastChapter(index) {
  if (
    !state.story ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= state.story.chapters.length
  ) {
    return;
  }

  state.cast.chapterIndex = index;
  if (state.chapterIndex === index) {
    return;
  }

  state.chapterIndex = index;
  state.started = true;
  updateChapterUi();
  setCurrentChapterImage();
  loadCaptions(currentChapter(), ++state.loadingToken).catch((error) => {
    console.warn("Cast-undertexten kunde inte laddas.", error);
  });
}

function updateFromRemotePlayer() {
  const player = state.cast.remotePlayer;
  if (!player) {
    return;
  }

  state.cast.currentTime = Number(player.currentTime) || 0;
  state.cast.isPaused = Boolean(player.isPaused);

  const mediaStory = player.mediaInfo?.customData?.storySlug;
  const mediaChapter = Number(player.mediaInfo?.customData?.chapterIndex);
  if (mediaStory === state.story?.slug && Number.isInteger(mediaChapter)) {
    syncCastChapter(mediaChapter);
  }

  updatePlayButton(!state.cast.isPaused);
  updateProgress();
  renderCaption();
  if (!state.cast.isPaused) {
    runAnimationLoop();
  }
}

function attachRemotePlayer(session) {
  detachRemotePlayer();
  state.cast.session = session;
  state.cast.remotePlayer = new cast.framework.RemotePlayer();
  state.cast.controller = new cast.framework.RemotePlayerController(
    state.cast.remotePlayer
  );

  const eventTypes = [
    cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
    cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
    cast.framework.RemotePlayerEventType.MEDIA_INFO_CHANGED,
    cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
    cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED
  ];
  for (const eventType of eventTypes) {
    const listener = updateFromRemotePlayer;
    state.cast.controller.addEventListener(eventType, listener);
    state.cast.listeners.push([eventType, listener]);
  }
}

function castMediaForChapter(chapter, index) {
  const mediaInfo = new chrome.cast.media.MediaInfo(
    resolveUrl(chapter.audio),
    "audio/mpeg"
  );
  const metadata = new chrome.cast.media.GenericMediaMetadata();
  metadata.title = chapter.title;
  metadata.subtitle =
    `Kapitel ${chapterDisplayNumber(chapter)} · ${state.story.title}`;
  metadata.images = [new chrome.cast.Image(resolveUrl(chapter.image))];
  mediaInfo.metadata = metadata;
  mediaInfo.duration = chapter.duration;
  mediaInfo.customData = {
    storySlug: state.story.slug,
    chapterIndex: index
  };

  const subtitleTrack = new chrome.cast.media.Track(
    1,
    chrome.cast.media.TrackType.TEXT
  );
  subtitleTrack.trackContentId = resolveUrl(chapter.captions);
  subtitleTrack.trackContentType = "text/vtt";
  subtitleTrack.subtype = chrome.cast.media.TextTrackType.SUBTITLES;
  subtitleTrack.name = "Svenska";
  subtitleTrack.language = state.story.language;
  mediaInfo.tracks = [subtitleTrack];
  return mediaInfo;
}

async function startCastPlayback(
  chapterIndex = state.chapterIndex,
  startTime = playbackCurrentTime(),
  options = {}
) {
  if (!state.cast.session || !state.story || state.cast.loading) {
    return;
  }

  state.cast.loading = true;
  setCastUi("Ansluter…");
  elements.narration.pause();

  try {
    if (!state.cast.remotePlayer) {
      attachRemotePlayer(state.cast.session);
    }

    const items = state.story.chapters.map((chapter, index) => {
      const item = new chrome.cast.media.QueueItem(
        castMediaForChapter(chapter, index)
      );
      item.autoplay = true;
      item.preloadTime = 20;
      if (state.captionsEnabled) {
        item.activeTrackIds = [1];
      }
      return item;
    });
    const request = createCastLoadRequest(chrome.cast.media, items, {
      title: state.story.title,
      description: state.story.description,
      chapterIndex,
      startTime,
      autoplay: options.autoplay !== false,
      captionsEnabled: state.captionsEnabled
    });

    const castError = await state.cast.session.loadMedia(request);
    if (castError) {
      throw new Error(`Google Cast svarade med felkod ${castError}.`);
    }
    state.cast.loaded = true;
    state.cast.chapterIndex = chapterIndex;
    state.cast.currentTime = Math.max(0, startTime);
    state.started = true;
    syncCastChapter(chapterIndex);
    setCurrentChapterImage();
    updateFromRemotePlayer();
    setStageStatus("");
  } catch (error) {
    state.cast.loaded = false;
    setStageStatus("Det gick inte att starta Chromecast.");
    console.warn("Chromecast kunde inte startas.", error);
  } finally {
    state.cast.loading = false;
    setCastUi();
  }
}

async function endCastPlayback() {
  const chapterIndex = state.cast.chapterIndex;
  const chapterTime = state.cast.currentTime;
  state.cast.loaded = false;
  state.cast.session = null;
  detachRemotePlayer();
  setCastUi();

  if (state.story) {
    await loadChapter(chapterIndex, { startTime: chapterTime });
    setCurrentChapterImage();
    setStageStatus("Casting avslutad.");
  }
}

async function handleCastSessionState(event) {
  const sessionState = event.sessionState;
  const startedStates = [
    cast.framework.SessionState.SESSION_STARTED,
    cast.framework.SessionState.SESSION_RESUMED
  ];
  if (startedStates.includes(sessionState)) {
    if (state.cast.session !== event.session || !state.cast.remotePlayer) {
      attachRemotePlayer(event.session);
    }
    if (state.story && !state.cast.loaded && !state.cast.loading) {
      await startCastPlayback(state.chapterIndex, playbackCurrentTime(), {
        autoplay: !elements.narration.paused
      });
    }
    return;
  }

  if (
    sessionState === cast.framework.SessionState.SESSION_ENDED &&
    state.cast.session
  ) {
    await endCastPlayback();
  }
}

function handleCastState(event) {
  state.cast.available =
    event.castState !== cast.framework.CastState.NO_DEVICES_AVAILABLE;
  setCastUi();
}

async function requestCastSession() {
  if (!state.cast.initialized || state.cast.loading) {
    setStageStatus("Chromecast är inte tillgängligt ännu.");
    return;
  }

  const context = cast.framework.CastContext.getInstance();
  try {
    const castError = await context.requestSession();
    if (castError) {
      throw new Error(`Google Cast svarade med felkod ${castError}.`);
    }

    const session = context.getCurrentSession();
    if (session && !state.cast.session) {
      attachRemotePlayer(session);
      if (state.story && !state.cast.loaded && !state.cast.loading) {
        await startCastPlayback(state.chapterIndex, playbackCurrentTime(), {
          autoplay: !elements.narration.paused
        });
      }
    }
  } catch (error) {
    const errorCode =
      typeof error === "string" ? error : error?.code ?? error?.message;
    if (errorCode === chrome.cast.ErrorCode.CANCEL) {
      return;
    }
    setStageStatus("Det gick inte att öppna Chromecast-enheterna.");
    console.warn("Chromecast-väljaren kunde inte öppnas.", error);
  }
}

function initializeCast() {
  if (
    state.cast.initialized ||
    !window.cast?.framework ||
    !window.chrome?.cast
  ) {
    return;
  }

  const context = cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });
  context.addEventListener(
    cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
    handleCastSessionState
  );
  context.addEventListener(
    cast.framework.CastContextEventType.CAST_STATE_CHANGED,
    handleCastState
  );
  state.cast.available =
    context.getCastState() !== cast.framework.CastState.NO_DEVICES_AVAILABLE;
  state.cast.initialized = true;
  setCastUi();
}

function fauxFullscreenEnabled() {
  return elements.playerShell.classList.contains("is-faux-fullscreen");
}

function exitFauxFullscreen() {
  elements.playerShell.classList.remove("is-faux-fullscreen");
  document.body.classList.remove("has-faux-fullscreen");
  updateFullscreenButton();
}

function enterFauxFullscreen() {
  elements.playerShell.classList.add("is-faux-fullscreen");
  document.body.classList.add("has-faux-fullscreen");
  updateFullscreenButton();
}

function updateFullscreenButton() {
  const active = Boolean(document.fullscreenElement) || fauxFullscreenEnabled();
  elements.fullscreenButton.setAttribute(
    "aria-label",
    active ? "Avsluta helskärm" : "Visa spelaren i helskärm"
  );
  elements.fullscreenButton.title = active
    ? "Avsluta helskärm (F)"
    : "Helskärm (F)";
  elements.fullscreenButton.querySelector("span").textContent = active
    ? "×"
    : "⛶";
}

async function toggleFullscreen() {
  if (fauxFullscreenEnabled()) {
    exitFauxFullscreen();
    return;
  }

  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }

  if (elements.playerShell.requestFullscreen) {
    try {
      await elements.playerShell.requestFullscreen();
      return;
    } catch {
      enterFauxFullscreen();
      return;
    }
  }

  enterFauxFullscreen();
}

function isTypingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement
  );
}

function bindEvents() {
  elements.storySelect.addEventListener("change", async () => {
    try {
      await selectStory(elements.storySelect.value);
    } catch (error) {
      showError(error);
    }
  });

  elements.playButton.addEventListener("click", togglePlay);
  elements.previousButton.addEventListener("click", async () => {
    if (state.chapterIndex > 0) {
      const shouldContinue = !playbackIsPaused();
      state.started = true;
      if (isCasting()) {
        await startCastPlayback(state.chapterIndex - 1, 0, {
          autoplay: shouldContinue
        });
      } else {
        await loadChapter(state.chapterIndex - 1, {
          autoplay: shouldContinue
        });
        setCurrentChapterImage();
      }
    }
  });
  elements.nextButton.addEventListener("click", async () => {
    if (state.chapterIndex < state.story.chapters.length - 1) {
      const shouldContinue = !playbackIsPaused();
      state.started = true;
      if (isCasting()) {
        await startCastPlayback(state.chapterIndex + 1, 0, {
          autoplay: shouldContinue
        });
      } else {
        await loadChapter(state.chapterIndex + 1, {
          autoplay: shouldContinue
        });
        setCurrentChapterImage();
      }
    }
  });

  elements.progressRange.addEventListener("input", () => {
    state.previewTime = Number(elements.progressRange.value);
    updateProgress();
  });
  elements.progressRange.addEventListener("change", async () => {
    const target = Number(elements.progressRange.value);
    state.previewTime = null;
    try {
      await seekToGlobalTime(target);
    } catch (error) {
      showError(error);
    }
  });

  elements.speedSelect.addEventListener("change", () => {
    state.playbackRate = normalizePlaybackRate(elements.speedSelect.value);
    applyLocalPlaybackRate();
    localStorage.setItem("sagostund:speed", String(state.playbackRate));
  });

  elements.captionButton.addEventListener("click", () => {
    setCaptionsEnabled(!state.captionsEnabled);
  });
  elements.navigationButton.addEventListener("click", () => {
    setControlsHidden(!state.controlsHidden);
  });
  elements.castButton.addEventListener("click", requestCastSession);
  elements.fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenButton);
  window.addEventListener("sagostund:cast-api", (event) => {
    if (event.detail?.isAvailable) {
      initializeCast();
    }
  });

  elements.narration.addEventListener("loadedmetadata", applyLocalPlaybackRate);
  elements.narration.addEventListener("loadeddata", applyLocalPlaybackRate);
  elements.narration.addEventListener("canplay", applyLocalPlaybackRate);
  elements.narration.addEventListener("play", applyLocalPlaybackRate);
  elements.narration.addEventListener("playing", applyLocalPlaybackRate);
  elements.narration.addEventListener("ratechange", applyLocalPlaybackRate);
  elements.narration.addEventListener("play", () => {
    state.started = true;
    setCurrentChapterImage();
    updatePlayButton(true);
    setStageStatus("");
    runAnimationLoop();
  });
  elements.narration.addEventListener("pause", () => {
    updatePlayButton(false);
    cancelAnimationFrame(state.animationFrame);
    updateProgress();
  });
  elements.narration.addEventListener("timeupdate", () => {
    applyLocalPlaybackRate();
    updateProgress();
    renderCaption();
  });
  elements.narration.addEventListener("waiting", () => {
    setStageStatus("Laddar ljud…");
  });
  elements.narration.addEventListener("playing", () => {
    setStageStatus("");
  });
  elements.narration.addEventListener("ended", async () => {
    if (state.chapterIndex < state.story.chapters.length - 1) {
      try {
        await loadChapter(state.chapterIndex + 1, { autoplay: true });
        setCurrentChapterImage();
      } catch (error) {
        showError(error);
      }
    } else {
      updatePlayButton(false);
      setStageStatus("Sagan är slut.");
    }
  });

  document.addEventListener("keydown", async (event) => {
    if (isTypingTarget(event.target)) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      await togglePlay();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      await seekToGlobalTime(globalCurrentTime() + 10);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      await seekToGlobalTime(globalCurrentTime() - 10);
    } else if (event.key.toLowerCase() === "c") {
      setCaptionsEnabled(!state.captionsEnabled);
    } else if (event.key.toLowerCase() === "f") {
      await toggleFullscreen();
    } else if (event.key.toLowerCase() === "n") {
      setControlsHidden(!state.controlsHidden);
    } else if (event.key === "Escape" && fauxFullscreenEnabled()) {
      exitFauxFullscreen();
    }
  });

  elements.retryButton.addEventListener("click", () => {
    window.location.reload();
  });
}

async function boot() {
  try {
    bindEvents();
    setCaptionsEnabled(state.captionsEnabled);
    setControlsHidden(state.controlsHidden);
    elements.speedSelect.value = String(state.playbackRate);
    setCastUi();
    if (window.__sagostundCastAvailable) {
      initializeCast();
    }

    const libraryData = await fetchJson("./data/library.json");
    state.library = libraryData.stories ?? [];
    renderStoryPicker();

    const requestedStory = new URL(window.location.href).searchParams.get("saga");
    const initialStory =
      state.library.find((story) => story.slug === requestedStory)?.slug ??
      state.library.find((story) => !story.locked)?.slug ??
      state.library[0]?.slug;
    await selectStory(initialStory);
  } catch (error) {
    showError(error);
  }
}

boot();
