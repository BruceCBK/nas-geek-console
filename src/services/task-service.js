const crypto = require('crypto');
const { HttpError } = require('../utils/http-error');
const { nowIso, shrink, toArray } = require('../utils/text');

class TaskService {
  constructor(store, logService) {
    this.store = store;
    this.logService = logService;
    this.maxItems = 800;
  }

  async init() {
    await this.store.init();
  }

  async list(filters = {}) {
    const rows = toArray(await this.store.read());
    const type = typeof filters.type === 'string' ? filters.type.trim() : '';
    const status = typeof filters.status === 'string' ? filters.status.trim() : '';
    const target = typeof filters.target === 'string' ? filters.target.trim().toLowerCase() : '';
    let out = rows;

    if (type) out = out.filter((task) => String(task.type || '') === type);
    if (status) out = out.filter((task) => String(task.status || '') === status);
    if (target) {
      out = out.filter((task) => String(task.target || '').toLowerCase().includes(target));
    }

    const limit = Math.max(1, Math.min(200, Number.parseInt(String(filters.limit || '30'), 10) || 30));
    return out.slice(0, limit);
  }

  async getLatestTaskMapByTarget(prefixes = []) {
    const rows = toArray(await this.store.read());
    const map = new Map();

    for (const row of rows) {
      const type = String(row?.type || '');
      if (prefixes.length && !prefixes.some((prefix) => type.startsWith(prefix))) {
        continue;
      }
      const target = String(row?.target || '');
      if (!target) continue;
      if (!map.has(target)) {
        map.set(target, row);
      }
    }

    return map;
  }

  async runTask({ type, target, message, action }) {
    const taskType = shrink(type || 'task.unknown', 80);
    const taskTarget = shrink(target || '-', 160);
    const taskMessage = shrink(message || 'Task queued', 240);

    let task = await this._createTask({
      type: taskType,
      target: taskTarget,
      status: 'pending',
      message: taskMessage,
      error: '',
      createdAt: nowIso(),
      endedAt: ''
    });

    await this.logService.append({
      action: taskType,
      type: 'task',
      target: taskTarget,
      status: 'pending',
      message: taskMessage,
      meta: { taskId: task.id }
    });

    task = await this._patchTask(task.id, {
      status: 'running',
      message: shrink(`Running: ${taskMessage}`, 240)
    });

    await this.logService.append({
      action: taskType,
      type: 'task',
      target: taskTarget,
      status: 'running',
      message: task.message,
      meta: { taskId: task.id }
    });

    try {
      const result = await action(task);
      const successMsg = shrink(
        result?.message || result?.text || `Completed ${taskType}`,
        240
      );

      task = await this._patchTask(task.id, {
        status: 'success',
        message: successMsg,
        error: '',
        endedAt: nowIso()
      });

      await this.logService.append({
        action: taskType,
        type: 'task',
        target: taskTarget,
        status: 'success',
        message: successMsg,
        meta: { taskId: task.id }
      });

      return { task, result: result || {} };
    } catch (error) {
      const errMessage = shrink(error?.message || String(error), 320);
      task = await this._patchTask(task.id, {
        status: 'failed',
        message: shrink(`Failed ${taskType}`, 200),
        error: errMessage,
        endedAt: nowIso()
      });

      await this.logService.append({
        action: taskType,
        type: 'task',
        target: taskTarget,
        status: 'failed',
        message: errMessage,
        meta: { taskId: task.id }
      });

      throw new HttpError(
        Number.isInteger(error?.status) ? error.status : 500,
        error?.code || 'TASK_FAILED',
        errMessage,
        { task }
      );
    }
  }

  async _createTask(task) {
    const payload = {
      id: crypto.randomUUID(),
      type: task.type,
      target: task.target,
      status: task.status,
      message: task.message,
      error: task.error || '',
      createdAt: task.createdAt || nowIso(),
      endedAt: task.endedAt || ''
    };

    await this.store.update((rows) => {
      const list = toArray(rows);
      list.unshift(payload);
      if (list.length > this.maxItems) list.length = this.maxItems;
      return list;
    });

    return payload;
  }

  async _patchTask(id, patch) {
    let updated = null;
    await this.store.update((rows) => {
      const list = toArray(rows);
      const idx = list.findIndex((item) => item && item.id === id);
      if (idx < 0) {
        throw new HttpError(404, 'TASK_NOT_FOUND', `Task not found: ${id}`);
      }
      const current = list[idx] || {};
      const next = {
        ...current,
        ...patch
      };
      list[idx] = next;
      updated = next;
      return list;
    });
    return updated;
  }
}

module.exports = {
  TaskService
};
