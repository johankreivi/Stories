import assert from "node:assert/strict";
import { createCastLoadRequest } from "../site/assets/cast-queue.js";

class QueueData {}

class LoadRequest {
  constructor(media) {
    this.media = media;
  }
}

const mediaApi = {
  QueueData,
  LoadRequest,
  QueueType: { AUDIOBOOK: "AUDIOBOOK" },
  RepeatMode: { OFF: "OFF" }
};
const items = [
  { media: { id: "chapter-0" } },
  { media: { id: "chapter-1" } },
  { media: { id: "chapter-2" } }
];

const request = createCastLoadRequest(mediaApi, items, {
  title: "Den stora presentationen",
  description: "Testbok",
  chapterIndex: 1,
  startTime: 12.5,
  autoplay: false,
  captionsEnabled: true
});

assert.ok(request instanceof LoadRequest);
assert.equal(request.media, items[1].media);
assert.equal(request.autoplay, false);
assert.equal(request.currentTime, 12.5);
assert.ok(request.queueData instanceof QueueData);
assert.equal(request.queueData.items, items);
assert.equal(request.queueData.startIndex, 1);
assert.equal(request.queueData.startTime, 12.5);
assert.equal(request.queueData.queueType, "AUDIOBOOK");
assert.equal(request.queueData.repeatMode, "OFF");
assert.deepEqual(request.activeTrackIds, [1]);

console.log("✓ Chromecast-kön använder LoadRequest.queueData.");
