/**
 * Media store — tracks all media generated via Livepeer Agent.
 * Persists URLs, prompts, and timestamps for replay/debug.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";

const MEDIA_FILE = "/tmp/siro_media_history.json";

export function createMediaStore({ eventBus }) {
  let media = [];

  // Load previous runs
  try {
    if (existsSync(MEDIA_FILE)) {
      media = JSON.parse(readFileSync(MEDIA_FILE, "utf8"));
    }
  } catch {
    media = [];
  }

  function persist() {
    try {
      writeFileSync(MEDIA_FILE, JSON.stringify(media, null, 2));
    } catch {
      // ignore persistence errors
    }
  }

  return {
    record({ type, url, prompt, product, timestamp, rawResult }) {
      const entry = {
        id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        url,
        prompt,
        product: product?.title || null,
        timestamp: timestamp || Date.now(),
        rawResult: rawResult || null,
      };
      media.push(entry);
      persist();
      if (eventBus) {
        eventBus.emit("media_created", entry);
      }
      return entry;
    },
    history: () => [...media],
    latest: () => (media.length > 0 ? media[media.length - 1] : null),
    byProduct: (productName) => media.filter((m) => m.product === productName),
    clear: () => {
      media.length = 0;
    },
  };
}
