const fs = require('fs/promises');
const path = require('path');
const { safeJson } = require('./text');

class JsonStore {
  constructor(filePath, defaultFactory) {
    this.filePath = filePath;
    this.defaultFactory =
      typeof defaultFactory === 'function' ? defaultFactory : () => defaultFactory;
    this.queue = Promise.resolve();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await this._writeRaw(this.defaultFactory());
    }
    this.initialized = true;
  }

  async read() {
    return this._enqueue(async () => {
      await this.init();
      return this._readRaw();
    });
  }

  async write(value) {
    return this._enqueue(async () => {
      await this.init();
      const safeValue = safeJson(value, this.defaultFactory());
      await this._writeRaw(safeValue);
      return safeValue;
    });
  }

  async update(mutator) {
    return this._enqueue(async () => {
      await this.init();
      const current = await this._readRaw();
      const draft = safeJson(current, this.defaultFactory());
      const next = await mutator(draft);
      const finalValue = next === undefined ? draft : next;
      const safeValue = safeJson(finalValue, this.defaultFactory());
      await this._writeRaw(safeValue);
      return safeValue;
    });
  }

  async _readRaw() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      const fallback = this.defaultFactory();
      await this._writeRaw(fallback);
      return safeJson(fallback, this.defaultFactory());
    }
  }

  async _writeRaw(value) {
    await fs.writeFile(this.filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  async _enqueue(work) {
    this.queue = this.queue.then(work, work);
    return this.queue;
  }
}

module.exports = {
  JsonStore
};
