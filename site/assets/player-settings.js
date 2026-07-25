export function normalizePlaybackRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0.5 && rate <= 4 ? rate : 1;
}

export function enforcePlaybackRate(media, value) {
  const rate = normalizePlaybackRate(value);
  if (media.defaultPlaybackRate !== rate) {
    media.defaultPlaybackRate = rate;
  }
  if (media.playbackRate !== rate) {
    media.playbackRate = rate;
  }
  return rate;
}
