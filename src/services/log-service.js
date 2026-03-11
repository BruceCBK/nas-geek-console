const crypto = require('crypto');
const { shrink, nowIso, toArray } = require('../utils/text');

class LogService {
  constructor(store) {
    this.store = store;
    this.maxItems = 500;
  }

  async init() {
    await this.store.init();
  }

  async append(entry) {
    const payload = {
      id: crypto.randomUUID(),
      action: shrink(entry?.action || 'unknown', 80),
      type: shrink(entry?.type || 'operation', 80),
      target: shrink(entry?.target || '-', 160),
      status: shrink(entry?.status || 'info', 32),
      message: shrink(entry?.message || '', 320),
      createdAt: nowIso(),
      meta: entry?.meta && typeof entry.meta === 'object' ? entry.meta : {}
    };

    await this.store.update((rows) => {
      const list = toArray(rows);
      list.unshift(payload);
      if (list.length > this.maxItems) list.length = this.maxItems;
      return list;
    });

    return payload;
  }

  async list(limit = 20) {
    const n = Math.max(1, Math.min(100, Number.parseInt(String(limit || '20'), 10) || 20));
    const rows = await this.store.read();
    return toArray(rows).slice(0, n);
  }
}

module.exports = {
  LogService
};
