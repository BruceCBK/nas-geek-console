const crypto = require('crypto');
const { HttpError } = require('../utils/http-error');
const { nowIso, pickText, toArray } = require('../utils/text');

const BASE_SCORE = 100;
const MAX_SCORE = 100;
const WARNING_SCORE = 60;
const AUTO_ROLE_ID = 'auto';
const AUTO_ROLE_KEYWORDS = {
  'code-claw': ['code', 'dev', 'bug', 'fix', 'refactor'],
  'radar-qa': ['test', 'qa', 'regression'],
  'ops-tide': ['deploy', 'restart', 'ops', 'perf'],
  'doc-pulse': ['doc', 'readme', 'changelog'],
  'neon-scout': ['research', 'search', 'info']
};

const DEFAULT_ROLES = [
  {
    id: 'neon-scout',
    name: '霓虹侦察虾',
    codename: 'Neon Scout',
    specialty: '情报检索 / 事实交叉验证 / 线索收敛',
    vibe: '快、准、冷静'
  },
  {
    id: 'code-claw',
    name: '铁钳代码虾',
    codename: 'Code Claw',
    specialty: '功能开发 / 修复 / 重构',
    vibe: '稳、狠、可维护'
  },
  {
    id: 'radar-qa',
    name: '雷达测试虾',
    codename: 'Radar QA',
    specialty: '回归测试 / 边界场景 / 质量门禁',
    vibe: '严、细、可复现'
  },
  {
    id: 'ops-tide',
    name: '黑潮运维虾',
    codename: 'Ops Tide',
    specialty: '服务巡检 / 性能诊断 / 稳定性保障',
    vibe: '警觉、务实、抗压'
  },
  {
    id: 'doc-pulse',
    name: '脉冲文档虾',
    codename: 'Doc Pulse',
    specialty: '文档沉淀 / 方案说明 / 变更记录',
    vibe: '清晰、结构化、可追溯'
  }
];

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function avg(nums = []) {
  const list = nums.filter((v) => Number.isFinite(v));
  if (!list.length) return 0;
  return list.reduce((s, n) => s + n, 0) / list.length;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findKeywordMatches(text, keywords = []) {
  const source = pickText(text).toLowerCase();
  if (!source) return [];

  return keywords.filter((keyword) => {
    const token = pickText(keyword).toLowerCase();
    if (!token) return false;
    const pattern = new RegExp(`\\b${escapeRegExp(token)}[a-z0-9-]*\\b`, 'i');
    return pattern.test(source);
  });
}

function getLoad(loadMap, roleId) {
  return loadMap.get(roleId) || { pending: 0, total: 0, lastAssignedAt: '' };
}

function buildRoleLoadMap(tasks = []) {
  const map = new Map();
  for (const row of toArray(tasks)) {
    const roleId = pickText(row?.roleId);
    if (!roleId) continue;

    const current = getLoad(map, roleId);
    const status = pickText(row?.status).toLowerCase();
    const createdAt = pickText(row?.createdAt);

    current.total += 1;
    if (!status || status === 'pending' || status === 'running') current.pending += 1;
    if (createdAt && (!current.lastAssignedAt || createdAt > current.lastAssignedAt)) {
      current.lastAssignedAt = createdAt;
    }

    map.set(roleId, current);
  }
  return map;
}

function pickLeastLoadedRole(candidates = [], loadMap = new Map()) {
  if (!candidates.length) return null;
  return candidates
    .slice()
    .sort((a, b) => {
      const left = getLoad(loadMap, a.id);
      const right = getLoad(loadMap, b.id);

      if (left.pending !== right.pending) return left.pending - right.pending;
      if (left.total !== right.total) return left.total - right.total;

      const leftTs = pickText(left.lastAssignedAt);
      const rightTs = pickText(right.lastAssignedAt);
      if (leftTs !== rightTs) {
        if (!leftTs) return -1;
        if (!rightTs) return 1;
        return leftTs.localeCompare(rightTs);
      }

      return pickText(a.id).localeCompare(pickText(b.id));
    })[0];
}

function describeLoad(load = {}) {
  return `pending=${Number(load.pending) || 0}, total=${Number(load.total) || 0}`;
}

function resolveRoleAssignment({ roles = [], tasks = [], requestedRoleId, title, description }) {
  const roleRows = toArray(roles);
  if (!roleRows.length) {
    throw new HttpError(503, 'SQUAD_ROLE_EMPTY', '暂无可用角色');
  }

  const requested = pickText(requestedRoleId);
  const normalizedRequest = requested.toLowerCase();
  const loadMap = buildRoleLoadMap(tasks);

  if (requested && normalizedRequest !== AUTO_ROLE_ID) {
    const manualRole = roleRows.find((r) => r.id === requested);
    if (!manualRole) throw new HttpError(404, 'SQUAD_ROLE_NOT_FOUND', `未找到角色: ${requested}`);
    const manualLoad = getLoad(loadMap, manualRole.id);
    return {
      role: manualRole,
      assignmentMode: 'manual',
      assignmentReason: `manual roleId=${manualRole.id}; ${describeLoad(manualLoad)}`
    };
  }

  const source = `${pickText(title)} ${pickText(description)}`.trim().toLowerCase();
  const scored = roleRows
    .map((role) => {
      const keywords = AUTO_ROLE_KEYWORDS[pickText(role.id)] || [];
      const matches = findKeywordMatches(source, keywords);
      return { role, matches };
    })
    .filter((row) => row.matches.length > 0);

  if (scored.length > 0) {
    const maxHits = Math.max(...scored.map((row) => row.matches.length));
    const candidates = scored.filter((row) => row.matches.length === maxHits);
    const picked = pickLeastLoadedRole(
      candidates.map((row) => row.role),
      loadMap
    );
    const pickedRow = candidates.find((row) => row.role.id === picked?.id);
    const pickedLoad = getLoad(loadMap, picked.id);
    return {
      role: picked,
      assignmentMode: 'auto.keyword',
      assignmentReason: `auto keyword[${pickedRow?.matches?.join(', ') || ''}] -> ${picked.id}; ${describeLoad(pickedLoad)}`
    };
  }

  const picked = pickLeastLoadedRole(roleRows, loadMap);
  const pickedLoad = getLoad(loadMap, picked.id);
  return {
    role: picked,
    assignmentMode: 'auto.balance',
    assignmentReason: `auto balance(no keyword) -> ${picked.id}; ${describeLoad(pickedLoad)}`
  };
}

function roleTemplate(base = {}) {
  return {
    id: pickText(base.id),
    name: pickText(base.name),
    codename: pickText(base.codename),
    specialty: pickText(base.specialty),
    vibe: pickText(base.vibe),
    score: BASE_SCORE,
    status: 'active',
    totalTasks: 0,
    doneTasks: 0,
    failedTasks: 0,
    avgCompletion: 0,
    avgQuality: 0,
    warningCount: 0,
    reflection: '',
    updatedAt: nowIso()
  };
}

class SquadService {
  constructor(roleStore, taskStore, logService) {
    this.roleStore = roleStore;
    this.taskStore = taskStore;
    this.logService = logService;
    this.maxTasks = 1000;
  }

  async init() {
    await Promise.all([this.roleStore.init(), this.taskStore.init()]);
    await this._ensureSeed();
    await this._normalizeRoleScores();
  }


  async _normalizeRoleScores() {
    await this.roleStore.update((rows) => {
      return toArray(rows).map((role) => {
        const score = clamp(role?.score, 0, MAX_SCORE);
        const status = score < WARNING_SCORE ? 'warning' : 'active';
        return {
          ...role,
          score,
          status
        };
      });
    });
  }

  async _ensureSeed() {
    const current = toArray(await this.roleStore.read());
    if (current.length) return;

    const seeded = DEFAULT_ROLES.map((row) => roleTemplate(row));
    await this.roleStore.write(seeded);
  }

  async getState() {
    const [roles, tasks] = await Promise.all([this.roleStore.read(), this.taskStore.read()]);
    const roleRows = toArray(roles);
    const taskRows = toArray(tasks);

    const sortedRoles = roleRows
      .slice()
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

    const warningRoles = sortedRoles.filter((r) => Number(r.score || 0) < WARNING_SCORE);
    const summary = {
      totalRoles: sortedRoles.length,
      avgScore: Math.round(avg(sortedRoles.map((r) => Number(r.score) || 0))),
      warningRoles: warningRoles.length,
      totalTasks: taskRows.length,
      completedTasks: taskRows.filter((t) => t.status === 'completed').length,
      failedTasks: taskRows.filter((t) => t.status === 'failed').length,
      pendingTasks: taskRows.filter((t) => t.status === 'pending').length
    };

    return {
      roles: sortedRoles,
      tasks: taskRows.slice(0, 40),
      summary,
      warningRoles: warningRoles.map((row) => ({
        id: row.id,
        name: row.name,
        score: row.score,
        reflection: row.reflection
      }))
    };
  }

  async createTask(input = {}) {
    const title = pickText(input.title);
    const requestedRoleId = pickText(input.roleId);
    const description = pickText(input.description);
    const weight = clamp(input.weight, 1, 3);

    if (!title) throw new HttpError(400, 'SQUAD_TASK_TITLE_REQUIRED', '任务标题不能为空');
    const [roles, tasks] = await Promise.all([this.roleStore.read(), this.taskStore.read()]);
    const assignment = resolveRoleAssignment({
      roles: toArray(roles),
      tasks: toArray(tasks),
      requestedRoleId,
      title,
      description
    });
    const role = assignment.role;

    const task = {
      id: crypto.randomUUID(),
      title,
      description,
      roleId: role.id,
      roleName: role.name,
      assignmentMode: assignment.assignmentMode,
      assignmentReason: assignment.assignmentReason,
      weight,
      status: 'pending',
      completion: 0,
      quality: 0,
      ownerScore: 0,
      captainScore: 0,
      passed: false,
      scoreDelta: 0,
      reviewNote: '',
      createdAt: nowIso(),
      gradedAt: ''
    };

    await this.taskStore.update((rows) => {
      const list = toArray(rows);
      list.unshift(task);
      if (list.length > this.maxTasks) list.length = this.maxTasks;
      return list;
    });

    await this.logService.append({
      action: 'squad.task.create',
      type: 'squad',
      target: role.id,
      status: 'success',
      message: `${role.name} 接收任务：${title}`,
      meta: {
        taskId: task.id,
        requestedRoleId: requestedRoleId || AUTO_ROLE_ID,
        assignmentMode: task.assignmentMode,
        assignmentReason: task.assignmentReason
      }
    });

    return task;
  }

  async reviewTask(taskId, payload = {}) {
    const id = pickText(taskId);
    if (!id) throw new HttpError(400, 'SQUAD_TASK_ID_REQUIRED', 'taskId 不能为空');

    const completion = clamp(payload.completion, 0, 100);
    const quality = clamp(payload.quality, 0, 100);
    const ownerScore = clamp(payload.ownerScore ?? quality, 0, 100);
    const captainScore = clamp(payload.captainScore ?? quality, 0, 100);
    const passed = Boolean(payload.passed);
    const reviewNote = pickText(payload.reviewNote);

    let updatedTask = null;
    await this.taskStore.update((rows) => {
      const list = toArray(rows);
      const idx = list.findIndex((t) => t && t.id === id);
      if (idx < 0) {
        throw new HttpError(404, 'SQUAD_TASK_NOT_FOUND', `未找到任务: ${id}`);
      }

      const current = list[idx] || {};
      const next = {
        ...current,
        completion,
        quality,
        ownerScore,
        captainScore,
        passed,
        status: passed ? 'completed' : 'failed',
        reviewNote,
        gradedAt: nowIso()
      };
      list[idx] = next;
      updatedTask = next;
      return list;
    });

    const [roles, tasks] = await Promise.all([this.roleStore.read(), this.taskStore.read()]);
    const roleRows = toArray(roles);
    const taskRows = toArray(tasks);
    const role = roleRows.find((r) => r.id === updatedTask.roleId);
    if (!role) {
      throw new HttpError(404, 'SQUAD_ROLE_NOT_FOUND', `未找到角色: ${updatedTask.roleId}`);
    }

    const judgeQuality = avg([quality, ownerScore, captainScore]);
    const weight = clamp(updatedTask.weight, 1, 3);
    let delta = ((completion - 75) * 0.08 + (judgeQuality - 75) * 0.12) * weight;
    delta += passed ? 1 : -8 * weight;
    delta = Math.round(clamp(delta, -24, 18));

    updatedTask.scoreDelta = delta;

    await this.taskStore.update((rows) => {
      const list = toArray(rows);
      const idx = list.findIndex((t) => t && t.id === updatedTask.id);
      if (idx >= 0) list[idx] = { ...list[idx], scoreDelta: delta };
      return list;
    });

    const roleTasks = taskRows.filter((t) => t && t.roleId === role.id);
    const doneTasks = roleTasks.filter((t) => t.status === 'completed');
    const failedTasks = roleTasks.filter((t) => t.status === 'failed');
    const score = clamp((Number(role.score) || BASE_SCORE) + delta, 0, MAX_SCORE);
    const status = score < WARNING_SCORE ? 'warning' : 'active';

    const reflection =
      status === 'warning' && !pickText(role.reflection)
        ? '评分低于60，已触发自省。请复盘失败任务并提交改进计划。'
        : pickText(role.reflection);

    const patchedRole = {
      ...role,
      score,
      status,
      totalTasks: roleTasks.length,
      doneTasks: doneTasks.length,
      failedTasks: failedTasks.length,
      avgCompletion: Math.round(avg(roleTasks.map((t) => Number(t.completion) || 0))),
      avgQuality: Math.round(avg(roleTasks.map((t) => Number(t.quality) || 0))),
      warningCount: (Number(role.warningCount) || 0) + (status === 'warning' ? 1 : 0),
      reflection,
      updatedAt: nowIso()
    };

    await this.roleStore.update((rows) => {
      const list = toArray(rows);
      const idx = list.findIndex((r) => r && r.id === role.id);
      if (idx < 0) throw new HttpError(404, 'SQUAD_ROLE_NOT_FOUND', `未找到角色: ${role.id}`);
      list[idx] = patchedRole;
      return list;
    });

    await this.logService.append({
      action: 'squad.task.review',
      type: 'squad',
      target: role.id,
      status: passed ? 'success' : 'failed',
      message: `${role.name} 任务评分更新：${delta >= 0 ? '+' : ''}${delta}（当前 ${score}）`,
      meta: { taskId: updatedTask.id, score, delta }
    });

    return {
      task: { ...updatedTask, scoreDelta: delta },
      role: patchedRole
    };
  }

  async submitReflection(roleId, reflectionText) {
    const id = pickText(roleId);
    const reflection = pickText(reflectionText);
    if (!id) throw new HttpError(400, 'SQUAD_ROLE_ID_REQUIRED', 'roleId 不能为空');
    if (!reflection) throw new HttpError(400, 'SQUAD_REFLECTION_REQUIRED', '自省内容不能为空');

    let updated = null;
    await this.roleStore.update((rows) => {
      const list = toArray(rows);
      const idx = list.findIndex((r) => r && r.id === id);
      if (idx < 0) throw new HttpError(404, 'SQUAD_ROLE_NOT_FOUND', `未找到角色: ${id}`);

      const current = list[idx] || {};
      const rebound = current.status === 'warning' ? 2 : 0;
      const nextScore = clamp((Number(current.score) || BASE_SCORE) + rebound, 0, MAX_SCORE);
      const next = {
        ...current,
        reflection,
        score: nextScore,
        status: nextScore < WARNING_SCORE ? 'warning' : 'active',
        updatedAt: nowIso()
      };
      list[idx] = next;
      updated = next;
      return list;
    });

    await this.logService.append({
      action: 'squad.role.reflection',
      type: 'squad',
      target: id,
      status: 'success',
      message: `${updated.name} 已提交自省与改进计划`,
      meta: { score: updated.score }
    });

    return updated;
  }
}

module.exports = {
  SquadService,
  DEFAULT_ROLES,
  BASE_SCORE,
  MAX_SCORE,
  WARNING_SCORE
};
