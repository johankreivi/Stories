import assert from "node:assert/strict";
import { enforcePlaybackRate } from "../site/assets/player-settings.js";

class ResettingMedia {
  constructor() {
    this.defaultPlaybackRate = 1;
    this.playbackRate = 1;
  }

  load() {
    this.defaultPlaybackRate = 1;
    this.playbackRate = 1;
  }
}

for (const selectedRate of [0.75, 1.25, 1.5, 2]) {
  const media = new ResettingMedia();
  for (let chapter = 0; chapter < 5; chapter += 1) {
    media.load();
    enforcePlaybackRate(media, selectedRate);
    assert.equal(
      media.defaultPlaybackRate,
      selectedRate,
      `Standardhastigheten tappades i kapitel ${chapter + 1}.`
    );
    assert.equal(
      media.playbackRate,
      selectedRate,
      `Uppspelningshastigheten tappades i kapitel ${chapter + 1}.`
    );
  }
}

console.log("✓ Uppspelningshastigheten består genom upprepade kapitelladdningar.");
