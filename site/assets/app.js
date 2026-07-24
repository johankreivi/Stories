const $ = (selector) => document.querySelector(selector);

const elements = {
  storySelect: $("#storySelect"),
  playerShell: $("#playerShell"),
  visualStage: $("#visualStage"),
  chapterImage: $("#chapterImage"),
  chapterChip: $("#chapterChip"),
  fullscreenButton: $("#fullscreenButton"),
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
  speedSelect: $("#speedSelect"),
  transcriptText: $("#transcriptText"),
  chapterList: $("#chapterList"),
  narration: $("#narration"),
  errorPanel: $("#errorPanel"),
  errorMessage: $("#errorMessage"),
  retryButton: $("#retryButton")
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
  playbackRate: Number(localStorage.getItem("sagostund:speed")) || 1,
  started: false,
  loadingToken: 0,
  animationFrame: 0,
  lastCaption: "",
  previewTime: null
};

function resolveUrl(relativePath) {
  return new URL(relativePath.replace(/^\.\//, ""), document.baseURI).href;
}

async function fetchJson(relativePath) {
  const response = await fetch(resolveUrl(relativePath));
  if (!response.ok) {
    throw new Error(`Kunde inte läsa ${relativePath} (${response.status}).`);
  }
  return response.json();
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
    option.textContent = story.title;
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
    number.textContent = String(chapter.number).padStart(2, "0");

    const copy = document.createElement("span");
    copy.className = "chapter-copy";
    const title = document.createElement("strong");
    title.textContent = chapter.title;
    const label = document.createElement("small");
    label.textContent = `Kapitel ${chapter.number}`;
    copy.append(title, label);

    const duration = document.createElement("span");
    duration.className = "chapter-duration";
    duration.textContent = formatTime(chapter.duration);

    button.append(number, copy, duration);
    button.addEventListener("click", async () => {
      const shouldContinue = !elements.narration.paused;
      state.started = true;
      await loadChapter(index, { autoplay: shouldContinue });
      setCurrentChapterImage();
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
    `Kapitel ${chapter.number} av ${state.story.chapters.length}`;
  elements.chapterTitle.textContent = chapter.title;
  elements.progressLabel.textContent = `Kapitel ${chapter.number}`;
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
    (elements.narration.currentTime || 0)
  );
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
  if (activeCues?.length) {
    text = activeCues[0].text;
  } else {
    text = captionFromFallback(elements.narration.currentTime || 0);
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

  elements.narration.src = resolveUrl(chapter.audio);
  elements.narration.playbackRate = state.playbackRate;
  if ("preservesPitch" in elements.narration) {
    elements.narration.preservesPitch = true;
  }
  elements.narration.load();

  const captionsPromise = loadCaptions(chapter, token);

  try {
    if (elements.narration.readyState < 1) {
      await once(elements.narration, "loadedmetadata");
    }
    if (token !== state.loadingToken) {
      return;
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
  elements.narration.pause();
  cancelAnimationFrame(state.animationFrame);

  const libraryEntry =
    state.library.find((story) => story.slug === slug) ?? state.library[0];
  if (!libraryEntry) {
    throw new Error("Inga sagor hittades.");
  }

  state.story = await fetchJson(libraryEntry.manifest);
  state.chapterIndex = 0;
  state.started = false;

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
}

async function togglePlay() {
  if (!state.story) {
    return;
  }

  if (!state.started) {
    state.started = true;
    setCurrentChapterImage();
  }

  if (elements.narration.paused) {
    try {
      await elements.narration.play();
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
  const shouldContinue = !elements.narration.paused;
  state.started = true;

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
    updateProgress();
    renderCaption();
    if (!elements.narration.paused && !elements.narration.ended) {
      state.animationFrame = requestAnimationFrame(tick);
    }
  };
  state.animationFrame = requestAnimationFrame(tick);
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
      const shouldContinue = !elements.narration.paused;
      state.started = true;
      await loadChapter(state.chapterIndex - 1, { autoplay: shouldContinue });
      setCurrentChapterImage();
    }
  });
  elements.nextButton.addEventListener("click", async () => {
    if (state.chapterIndex < state.story.chapters.length - 1) {
      const shouldContinue = !elements.narration.paused;
      state.started = true;
      await loadChapter(state.chapterIndex + 1, { autoplay: shouldContinue });
      setCurrentChapterImage();
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
    state.playbackRate = Number(elements.speedSelect.value);
    elements.narration.playbackRate = state.playbackRate;
    localStorage.setItem("sagostund:speed", String(state.playbackRate));
  });

  elements.captionButton.addEventListener("click", () => {
    setCaptionsEnabled(!state.captionsEnabled);
  });
  elements.fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenButton);

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
    elements.speedSelect.value = String(state.playbackRate);

    const libraryData = await fetchJson("./data/library.json");
    state.library = libraryData.stories ?? [];
    renderStoryPicker();

    const requestedStory = new URL(window.location.href).searchParams.get("saga");
    await selectStory(requestedStory);
  } catch (error) {
    showError(error);
  }
}

boot();
