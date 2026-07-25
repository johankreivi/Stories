export function createCastLoadRequest(
  mediaApi,
  items,
  {
    title,
    description = "Ljudbok",
    chapterIndex = 0,
    startTime = 0,
    autoplay = true,
    captionsEnabled = true
  } = {}
) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Chromecast-kön saknar kapitel.");
  }
  if (chapterIndex < 0 || chapterIndex >= items.length) {
    throw new Error("Chromecast-kön har ett ogiltigt startkapitel.");
  }

  const boundedStartTime = Math.max(0, Number(startTime) || 0);
  const queueData = new mediaApi.QueueData();
  queueData.items = items;
  queueData.name = title;
  queueData.description = description;
  queueData.queueType = mediaApi.QueueType.AUDIOBOOK;
  queueData.repeatMode = mediaApi.RepeatMode.OFF;
  queueData.startIndex = chapterIndex;
  queueData.startTime = boundedStartTime;

  const request = new mediaApi.LoadRequest(items[chapterIndex].media);
  request.autoplay = Boolean(autoplay);
  request.currentTime = boundedStartTime;
  request.queueData = queueData;
  if (captionsEnabled) {
    request.activeTrackIds = [1];
  }
  return request;
}
