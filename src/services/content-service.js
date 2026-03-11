const crypto = require('crypto');
const { pickText, toArray, nowIso, shrink } = require('../utils/text');
const { HttpError } = require('../utils/http-error');

function contentIdFor(item) {
  const url = pickText(item?.url);
  const title = pickText(item?.title);
  const platform = pickText(item?.platform);
  const raw = `${platform}|${url}|${title}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') {
    throw new HttpError(400, 'INVALID_CONTENT_ITEM', 'item is required');
  }

  const normalized = {
    id: pickText(item.id) || contentIdFor(item),
    platform: shrink(pickText(item.platform, 'unknown'), 32),
    title: shrink(pickText(item.title, 'Untitled'), 220),
    url: pickText(item.url),
    summary: shrink(pickText(item.summary), 320),
    source: shrink(pickText(item.source), 80)
  };

  if (!normalized.title) {
    throw new HttpError(400, 'INVALID_CONTENT_ITEM', 'item.title is required');
  }

  return normalized;
}

class ContentService {
  constructor(favoritesStore, topicsStore) {
    this.favoritesStore = favoritesStore;
    this.topicsStore = topicsStore;
  }

  async init() {
    await this.favoritesStore.init();
    await this.topicsStore.init();
  }

  async getState() {
    const favorites = toArray(await this.favoritesStore.read());
    const topics = toArray(await this.topicsStore.read());
    return {
      favorites,
      topics
    };
  }

  async favorite(itemInput, noteInput) {
    const item = normalizeItem(itemInput);
    const note = shrink(pickText(noteInput), 500);
    const now = nowIso();
    let saved = null;

    await this.favoritesStore.update((rows) => {
      const list = toArray(rows);
      const idx = list.findIndex((entry) => entry && entry.id === item.id);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          ...item,
          note,
          favorited: true,
          updatedAt: now
        };
        saved = list[idx];
      } else {
        saved = {
          ...item,
          note,
          favorited: true,
          createdAt: now,
          updatedAt: now
        };
        list.unshift(saved);
      }
      return list;
    });

    return saved;
  }

  async unfavorite(idInput) {
    const id = pickText(idInput);
    if (!id) throw new HttpError(400, 'INVALID_CONTENT_ID', 'id is required');
    let removed = false;

    await this.favoritesStore.update((rows) => {
      const list = toArray(rows);
      const next = list.filter((entry) => {
        const keep = entry && entry.id !== id;
        if (!keep) removed = true;
        return keep;
      });
      return next;
    });

    if (!removed) {
      throw new HttpError(404, 'FAVORITE_NOT_FOUND', 'favorite not found');
    }

    return { id };
  }

  async addNote(idInput, noteInput, itemInput) {
    const id = pickText(idInput);
    const note = shrink(pickText(noteInput), 500);
    if (!id && !itemInput) {
      throw new HttpError(400, 'INVALID_CONTENT_ID', 'id or item is required');
    }

    const now = nowIso();
    let saved = null;

    await this.favoritesStore.update((rows) => {
      const list = toArray(rows);
      const normalized = itemInput ? normalizeItem(itemInput) : null;
      const targetId = id || normalized.id;
      const idx = list.findIndex((entry) => entry && entry.id === targetId);

      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          ...(normalized || {}),
          note,
          updatedAt: now
        };
        saved = list[idx];
      } else {
        if (!normalized) {
          throw new HttpError(404, 'FAVORITE_NOT_FOUND', 'favorite not found');
        }
        saved = {
          ...normalized,
          note,
          favorited: false,
          createdAt: now,
          updatedAt: now
        };
        list.unshift(saved);
      }

      return list;
    });

    return saved;
  }

  async convertToTopic(payload = {}) {
    const id = pickText(payload.id);
    const titleOverride = pickText(payload.title);
    const note = shrink(pickText(payload.note), 500);
    let sourceItem = null;

    if (id) {
      const favorites = toArray(await this.favoritesStore.read());
      sourceItem = favorites.find((entry) => entry && entry.id === id) || null;
    }

    if (!sourceItem && payload.item) {
      sourceItem = normalizeItem(payload.item);
    }

    if (!sourceItem) {
      throw new HttpError(400, 'TOPIC_SOURCE_REQUIRED', 'id or item is required to convert topic');
    }

    const now = nowIso();
    const topic = {
      id: crypto.randomUUID(),
      sourceId: sourceItem.id,
      title: titleOverride || sourceItem.title,
      platform: sourceItem.platform,
      url: sourceItem.url,
      summary: sourceItem.summary,
      source: sourceItem.source,
      note,
      createdAt: now
    };

    await this.topicsStore.update((rows) => {
      const list = toArray(rows);
      list.unshift(topic);
      return list;
    });

    return topic;
  }
}

module.exports = {
  ContentService,
  contentIdFor
};
