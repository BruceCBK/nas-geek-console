const crypto = require('crypto');
const { HttpError } = require('../utils/http-error');
const { nowIso, pickText, toArray } = require('../utils/text');

const BASE_SCORE = 100;
const MAX_SCORE = 100;
const WARNING_SCORE = 60;
const AUTO_ROLE_ID = 'auto';
const CAPTAIN_DISPATCH_DOCTRINE =
  '队长派工原则：按任务语义分工、关联任务联动、负载均衡优先，禁止单角色垄断。';
const AUTO_ROLE_KEYWORDS = {
  'code-claw': ['code', 'dev', 'bug', 'fix', 'refactor', '编码', '代码', '开发', '修复', '重构', '实现', '功能'],
  'radar-qa': ['test', 'qa', 'regression', '测试', '回归', '验收', '验证', '质检', '边界'],
  'ops-tide': ['deploy', 'restart', 'ops', 'perf', '运维', '发布', '部署', '重启', '巡检', '性能', '稳定性'],
  'doc-pulse': ['doc', 'readme', 'changelog', '文档', '说明', '手册', '记录', '变更日志', '复盘'],
  'neon-scout': ['research', 'search', 'info', '调研', '检索', '情报', '信息', '线索', '分析']
};
const COLLAB_POLICY = {
  'code-claw': ['radar-qa', 'doc-pulse'],
  'ops-tide': ['radar-qa', 'doc-pulse'],
  'radar-qa': ['doc-pulse']
};
const TASK_OPEN_STATUSES = new Set(['pending', 'running', 'blocked']);
const TASK_TERMINAL_STATUSES = new Set(['completed', 'failed']);
const TASK_RUNNING_STALE_MS = 8 * 60 * 1000;
const BLOCKED_PENALTY_PER_WEIGHT = 3;
const MAX_BLOCKED_PENALTY_PER_SWEEP = 18;
const EXECUTOR_TICK_MS = Math.max(20 * 1000, Number.parseInt(process.env.SQUAD_EXECUTOR_TICK_MS || '45000', 10) || 45000);
const EXECUTOR_BLOCKED_RECOVER_MS = 2 * 60 * 1000;
const EXECUTOR_AUTO_COMPLETE_AT = 96;
const EXECUTOR_ROLE_PROGRESS_STEP = {
  'neon-scout': 16,
  'code-claw': 14,
  'radar-qa': 12,
  'ops-tide': 13,
  'doc-pulse': 11
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

function isAsciiWordToken(token) {
  return /^[a-z0-9-]+$/i.test(token);
}

function hasKeyword(source, token) {
  if (!source || !token) return false;

  if (isAsciiWordToken(token)) {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}[a-z0-9-]*\\b`, 'i');
    return pattern.test(source);
  }

  return source.includes(token);
}

function findKeywordMatches(text, keywords = []) {
  const source = pickText(text).toLowerCase();
  if (!source) return [];

  return keywords.filter((keyword) => {
    const token = pickText(keyword).toLowerCase();
    if (!token) return false;
    return hasKeyword(source, token);
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
    if (!status || TASK_OPEN_STATUSES.has(status)) current.pending += 1;
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

function blockedPenaltyByWeight(weight) {
  const w = clamp(weight, 1, 3);
  return -BLOCKED_PENALTY_PER_WEIGHT * w;
}

function executorStepForTask(task = {}) {
  const roleId = pickText(task.roleId);
  const base = EXECUTOR_ROLE_PROGRESS_STEP[roleId] || 10;
  const relation = pickText(task.relationType, 'primary').toLowerCase();
  const relationBoost = relation === 'linked' ? 2 : 0;
  const loadPenalty = Math.max(0, (Number(task.weight) || 1) - 1);
  return Math.max(4, base + relationBoost - loadPenalty);
}

function buildExecutorReviewPayload(task = {}) {
  const progress = clamp(task.progressPercent, 0, 100);
  const completion = clamp(progress + 3, 85, 100);
  const qualityBase = 86 + Math.min(10, Math.floor((progress - 60) / 6));
  const quality = clamp(qualityBase, 80, 98);

  return {
    completion,
    quality,
    ownerScore: clamp(quality - 1, 80, 98),
    captainScore: clamp(quality + 1, 80, 99),
    passed: true,
    reviewNote: '队长自动验收：执行器持续心跳达标，任务闭环完成。'
  };
}

function pickCollaborationRoles({ primaryRoleId, scoredRows = [], roles = [], loadMap = new Map() }) {
  const policyRoles = toArray(COLLAB_POLICY[primaryRoleId]);
  const matchedSecondary = scoredRows
    .filter((row) => row?.role?.id && row.role.id !== primaryRoleId)
    .map((row) => row.role.id);

  const unique = Array.from(new Set([...matchedSecondary, ...policyRoles]));
  if (!unique.length) return [];

  const roleMap = new Map(toArray(roles).map((r) => [r.id, r]));
  return unique
    .map((id) => roleMap.get(id))
    .filter(Boolean)
    .sort((a, b) => {
      const left = getLoad(loadMap, a.id);
      const right = getLoad(loadMap, b.id);
      if (left.pending !== right.pending) return left.pending - right.pending;
      if (left.total !== right.total) return left.total - right.total;
      return pickText(a.id).localeCompare(pickText(b.id));
    })
    .slice(0, 3)
    .map((role) => role.id);
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
      matchedRoleIds: [manualRole.id],
      collaborationRoleIds: [],
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
    const collaborationRoleIds = pickCollaborationRoles({
      primaryRoleId: picked.id,
      scoredRows: scored,
      roles: roleRows,
      loadMap
    });
    const pickedLoad = getLoad(loadMap, picked.id);
    return {
      role: picked,
      matchedRoleIds: scored.map((row) => row.role.id),
      collaborationRoleIds,
      assignmentMode: 'auto.keyword',
      assignmentReason: `auto keyword[${pickedRow?.matches?.join(', ') || ''}] -> ${picked.id}; ${describeLoad(pickedLoad)}`
    };
  }

  const picked = pickLeastLoadedRole(roleRows, loadMap);
  const pickedLoad = getLoad(loadMap, picked.id);
  return {
    role: picked,
    matchedRoleIds: [],
    collaborationRoleIds: [],
    assignmentMode: 'auto.balance',
    assignmentReason: `auto balance(no keyword) -> ${picked.id}; ${describeLoad(pickedLoad)}`
  };
}

function buildTaskRow({
  id,
  title,
  description,
  role,
  weight,
  assignmentMode,
  assignmentReason,
  taskGroupId,
  parentTaskId,
  relationType = 'primary'
}) {
  const ts = nowIso();
  return {
    id: id || crypto.randomUUID(),
    title,
    description,
    roleId: role.id,
    roleName: role.name,
    assignmentMode,
    assignmentReason,
    taskGroupId: pickText(taskGroupId),
    parentTaskId: pickText(parentTaskId),
    relationType,
    weight,
    status: 'running',
    progressPercent: 5,
    startedAt: ts,
    lastHeartbeatAt: ts,
    stalledAt: '',
    stalledReason: '',
    completion: 0,
    quality: 0,
    ownerScore: 0,
    captainScore: 0,
    passed: false,
    scoreDelta: 0,
    reviewNote: '',
    createdAt: ts,
    gradedAt: ''
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
    failureEvents: 0,
    avgCompletion: 0,
    avgQuality: 0,
    warningCount: 0,
    reflection: '',
    dispatchDoctrine: CAPTAIN_DISPATCH_DOCTRINE,
    updatedAt: nowIso()
  };
}

class SquadService {
  constructor(roleStore, taskStore, logService) {
    this.roleStore = roleStore;
    this.taskStore = taskStore;
    this.logService = logService;
    this.maxTasks = 1000;
    this.executorTickMs = EXECUTOR_TICK_MS;
    this.executorEnabled = true;
    this.executorTimer = null;
    this.executorTickRunning = false;
    this.executorLastTickAt = '';
    this.executorLastError = '';
    this.executorStats = {
      ticks: 0,
      heartbeatUpdates: 0,
      recoveredCount: 0,
      autoCompleted: 0
    };
  }

  async init() {
    await Promise.all([this.roleStore.init(), this.taskStore.init()]);
    await this._ensureSeed();
    await this._normalizeRoleScores();
    await this._normalizeTaskRuntime();
    this._startExecutorLoop();
  }

  async _normalizeRoleScores() {
    await this.roleStore.update((rows) => {
      return toArray(rows).map((role) => {
        const score = clamp(role?.score, 0, MAX_SCORE);
        const status = score < WARNING_SCORE ? 'warning' : 'active';
        return {
          ...role,
          score,
          dispatchDoctrine: pickText(role?.dispatchDoctrine, CAPTAIN_DISPATCH_DOCTRINE),
          failureEvents: Number(role?.failureEvents) || Number(role?.failedTasks) || 0,
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

  _startExecutorLoop() {
    if (!this.executorEnabled || this.executorTimer) return;

    this.executorTimer = setInterval(() => {
      this._executorTick().catch((error) => {
        this.executorLastError = pickText(error?.message, String(error));
      });
    }, this.executorTickMs);

    if (typeof this.executorTimer.unref === 'function') {
      this.executorTimer.unref();
    }
  }

  async _executorTick() {
    if (!this.executorEnabled || this.executorTickRunning) return;
    this.executorTickRunning = true;

    try {
      const nowText = nowIso();
      const heartbeatTouched = [];
      const recovered = [];
      const completeCandidates = [];

      await this.taskStore.update((rows) => {
        return toArray(rows).map((task) => {
          if (!task || typeof task !== 'object') return task;

          const next = { ...task };
          const status = pickText(next.status).toLowerCase();
          if (TASK_TERMINAL_STATUSES.has(status)) return next;

          if (!status || status === 'pending') {
            next.status = 'running';
          }

          let normalized = pickText(next.status).toLowerCase();
          if (normalized === 'blocked') {
            const stalledMs = Date.parse(pickText(next.stalledAt, next.lastHeartbeatAt, next.createdAt));
            const canRecover = !Number.isFinite(stalledMs) || Date.now() - stalledMs >= EXECUTOR_BLOCKED_RECOVER_MS;
            if (!canRecover) return next;

            next.status = 'running';
            next.stalledAt = '';
            next.stalledReason = '';
            recovered.push({ id: next.id, roleId: next.roleId, roleName: next.roleName, title: next.title });
            normalized = 'running';
          }

          if (normalized !== 'running') return next;

          const current = clamp(next.progressPercent, 0, 99);
          const step = executorStepForTask(next);
          next.progressPercent = Math.min(99, Math.max(5, current + step));
          next.lastHeartbeatAt = nowText;
          next.startedAt = pickText(next.startedAt, next.createdAt, nowText);
          next.progressNote = `执行器自动心跳：进度 ${next.progressPercent}%`;
          next.stalledAt = '';
          next.stalledReason = '';

          heartbeatTouched.push(next.id);
          if (next.progressPercent >= EXECUTOR_AUTO_COMPLETE_AT) {
            completeCandidates.push({ id: next.id, progressPercent: next.progressPercent });
          }

          return next;
        });
      });

      for (const row of recovered) {
        await this.logService.append({
          action: 'squad.task.executor.recover',
          type: 'squad',
          target: row.roleId,
          status: 'success',
          message: `${row.roleName || row.roleId} 自动恢复任务：${row.title}`,
          meta: { taskId: row.id }
        });
      }

      for (const candidate of completeCandidates) {
        try {
          await this.reviewTask(candidate.id, buildExecutorReviewPayload(candidate));
          this.executorStats.autoCompleted += 1;
        } catch (error) {
          const text = pickText(error?.message, '');
          if (text.includes('未找到任务') || text.includes('任务已结束') || text.includes('任务已结束，无法提交心跳')) continue;
          throw error;
        }
      }

      this.executorLastTickAt = nowText;
      this.executorStats.ticks += 1;
      this.executorStats.heartbeatUpdates += heartbeatTouched.length;
      this.executorStats.recoveredCount += recovered.length;
      this.executorLastError = '';
    } finally {
      this.executorTickRunning = false;
    }
  }

  async _normalizeTaskRuntime() {
    const nowMs = Date.now();
    const nowText = nowIso();
    const newlyBlocked = [];

    await this.taskStore.update((rows) => {
      return toArray(rows).map((task) => {
        if (!task || typeof task !== 'object') return task;

        const next = { ...task };
        const status = pickText(next.status).toLowerCase();

        if (!status || status === 'pending') {
          next.status = 'running';
        }

        const normalized = pickText(next.status).toLowerCase();
        if (!TASK_OPEN_STATUSES.has(normalized)) {
          if (TASK_TERMINAL_STATUSES.has(normalized)) {
            next.progressPercent = 100;
          }
          return next;
        }

        next.startedAt = pickText(next.startedAt, next.createdAt, nowText);
        next.lastHeartbeatAt = pickText(next.lastHeartbeatAt, next.startedAt, next.createdAt, nowText);

        const hbMs = Date.parse(next.lastHeartbeatAt);
        const isStale = Number.isFinite(hbMs) && nowMs - hbMs > TASK_RUNNING_STALE_MS;
        if (isStale) {
          next.status = 'blocked';
          next.stalledAt = pickText(next.stalledAt, nowText);
          next.stalledReason = pickText(
            next.stalledReason,
            '超过8分钟无进展心跳，状态已标记为 blocked，请跟进或重派。'
          );

          if (!next.blockedPenaltyApplied) {
            next.blockedPenaltyApplied = true;
            newlyBlocked.push({
              id: pickText(next.id),
              roleId: pickText(next.roleId),
              roleName: pickText(next.roleName),
              title: pickText(next.title),
              weight: clamp(next.weight, 1, 3)
            });
          }
        }

        const progress = clamp(next.progressPercent, 0, 99);
        next.progressPercent = next.status === 'blocked' ? progress : Math.max(progress, 5);
        return next;
      });
    });

    if (!newlyBlocked.length) return;

    const rolePenaltyMap = new Map();
    for (const task of newlyBlocked) {
      if (!task.roleId) continue;
      const current = rolePenaltyMap.get(task.roleId) || {
        delta: 0,
        failures: 0,
        roleName: task.roleName
      };
      current.delta += blockedPenaltyByWeight(task.weight);
      current.failures += 1;
      current.delta = Math.max(current.delta, -MAX_BLOCKED_PENALTY_PER_SWEEP);
      rolePenaltyMap.set(task.roleId, current);
    }

    await this.roleStore.update((rows) => {
      return toArray(rows).map((role) => {
        const patch = rolePenaltyMap.get(role?.id);
        if (!patch) return role;

        const nextScore = clamp((Number(role?.score) || BASE_SCORE) + patch.delta, 0, MAX_SCORE);
        const nextFailureEvents = (Number(role?.failureEvents) || Number(role?.failedTasks) || 0) + patch.failures;
        const nextStatus = nextScore < WARNING_SCORE || patch.failures > 0 ? 'warning' : 'active';

        return {
          ...role,
          score: nextScore,
          status: nextStatus,
          failedTasks: nextFailureEvents,
          failureEvents: nextFailureEvents,
          warningCount: (Number(role?.warningCount) || 0) + (nextStatus === 'warning' ? 1 : 0),
          reflection: pickText(role?.reflection, '出现阻塞任务，需复盘根因并提交改进措施。'),
          updatedAt: nowIso()
        };
      });
    });

    for (const task of newlyBlocked) {
      await this.logService.append({
        action: 'squad.task.blocked',
        type: 'squad',
        target: task.roleId,
        status: 'failed',
        message: `${task.roleName || task.roleId} 任务阻塞：${task.title || task.id}`,
        meta: {
          taskId: task.id,
          penalty: blockedPenaltyByWeight(task.weight),
          reason: 'no-heartbeat-timeout'
        }
      });
    }
  }

  async _reconcileTaskLiveness() {
    await this._normalizeTaskRuntime();
  }

  async getState() {
    await this._reconcileTaskLiveness();
    const [roles, tasks] = await Promise.all([this.roleStore.read(), this.taskStore.read()]);
    const roleRows = toArray(roles);
    const taskRows = toArray(tasks);

    const computedRoles = roleRows.map((role) => {
      const roleTasks = taskRows.filter((task) => task && task.roleId === role.id);
      const doneTasks = roleTasks.filter((task) => task.status === 'completed');
      const failedTasks = roleTasks.filter((task) => task.status === 'failed');
      const blockedTasks = roleTasks.filter((task) => task.status === 'blocked');
      const pendingTasks = roleTasks.filter((task) => TASK_OPEN_STATUSES.has(pickText(task.status).toLowerCase()));
      const unresolvedFailures = failedTasks.length + blockedTasks.length;
      const failureEvents = Math.max(
        Number(role?.failureEvents) || 0,
        Number(role?.failedTasks) || 0,
        unresolvedFailures
      );
      const status = unresolvedFailures > 0 || Number(role?.score || 0) < WARNING_SCORE ? 'warning' : 'active';

      return {
        ...role,
        status,
        totalTasks: roleTasks.length,
        doneTasks: doneTasks.length,
        failedTasks: unresolvedFailures,
        failureEvents,
        blockedTasks: blockedTasks.length,
        pendingTasks: pendingTasks.length,
        avgCompletion: Math.round(avg(roleTasks.map((task) => Number(task.completion) || 0))),
        avgQuality: Math.round(avg(roleTasks.map((task) => Number(task.quality) || 0)))
      };
    });

    const sortedRoles = computedRoles
      .slice()
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

    const warningRoles = sortedRoles.filter((r) => pickText(r.status, '').toLowerCase() === 'warning');
    const summary = {
      totalRoles: sortedRoles.length,
      avgScore: Math.round(avg(sortedRoles.map((r) => Number(r.score) || 0))),
      warningRoles: warningRoles.length,
      totalTasks: taskRows.length,
      completedTasks: taskRows.filter((t) => t.status === 'completed').length,
      failedTasks: taskRows.filter((t) => t.status === 'failed').length,
      pendingTasks: taskRows.filter((t) => TASK_OPEN_STATUSES.has(pickText(t.status).toLowerCase())).length
    };

    return {
      roles: sortedRoles,
      tasks: taskRows.slice(0, 40),
      summary,
      executor: {
        enabled: this.executorEnabled,
        tickMs: this.executorTickMs,
        lastTickAt: this.executorLastTickAt,
        lastError: this.executorLastError,
        stats: { ...this.executorStats }
      },
      captainDirective: CAPTAIN_DISPATCH_DOCTRINE,
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
    await this._reconcileTaskLiveness();
    const [roles, tasks] = await Promise.all([this.roleStore.read(), this.taskStore.read()]);
    const roleRows = toArray(roles);
    const assignment = resolveRoleAssignment({
      roles: roleRows,
      tasks: toArray(tasks),
      requestedRoleId,
      title,
      description
    });
    const role = assignment.role;

    const taskGroupId = crypto.randomUUID();
    const task = buildTaskRow({
      title,
      description,
      role,
      weight,
      assignmentMode: assignment.assignmentMode,
      assignmentReason: `${assignment.assignmentReason} ｜ ${CAPTAIN_DISPATCH_DOCTRINE}`,
      taskGroupId,
      relationType: 'primary'
    });

    const linkedTasks = assignment.collaborationRoleIds
      .map((roleId) => roleRows.find((r) => r.id === roleId))
      .filter(Boolean)
      .map((linkedRole) => {
        const linkedReason = `auto collab from ${role.id} -> ${linkedRole.id}; ${CAPTAIN_DISPATCH_DOCTRINE}`;
        return buildTaskRow({
          title: `[协同] ${title}`,
          description: pickText(
            description,
            `协同子任务：请从 ${linkedRole.name} 视角跟进主任务 ${task.id}`
          ),
          role: linkedRole,
          weight,
          assignmentMode: 'auto.collab',
          assignmentReason: linkedReason,
          taskGroupId,
          parentTaskId: task.id,
          relationType: 'linked'
        });
      });

    await this.taskStore.update((rows) => {
      const list = toArray(rows);
      list.unshift(task, ...linkedTasks);
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
        assignmentReason: task.assignmentReason,
        taskGroupId,
        linkedTaskIds: linkedTasks.map((row) => row.id)
      }
    });

    for (const linked of linkedTasks) {
      await this.logService.append({
        action: 'squad.task.create.linked',
        type: 'squad',
        target: linked.roleId,
        status: 'success',
        message: `${linked.roleName} 接收协同任务：${linked.title}`,
        meta: {
          taskId: linked.id,
          parentTaskId: task.id,
          taskGroupId,
          assignmentMode: linked.assignmentMode,
          assignmentReason: linked.assignmentReason
        }
      });
    }

    return {
      task,
      linkedTasks
    };
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
        progressPercent: 100,
        lastHeartbeatAt: nowIso(),
        stalledAt: '',
        stalledReason: '',
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
    const blockedTasks = roleTasks.filter((t) => t.status === 'blocked');
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
      failedTasks: failedTasks.length + blockedTasks.length,
      failureEvents: Math.max(
        Number(role.failureEvents) || Number(role.failedTasks) || 0,
        failedTasks.length + blockedTasks.length
      ),
      blockedTasks: blockedTasks.length,
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

  async heartbeatTask(taskId, payload = {}) {
    const id = pickText(taskId);
    if (!id) throw new HttpError(400, 'SQUAD_TASK_ID_REQUIRED', 'taskId 不能为空');

    const progressPercent = clamp(payload.progressPercent ?? payload.progress, 0, 99);
    const note = pickText(payload.note, payload.message);

    let updatedTask = null;
    await this.taskStore.update((rows) => {
      const list = toArray(rows);
      const idx = list.findIndex((t) => t && t.id === id);
      if (idx < 0) throw new HttpError(404, 'SQUAD_TASK_NOT_FOUND', `未找到任务: ${id}`);

      const current = list[idx] || {};
      const status = pickText(current.status).toLowerCase();
      if (TASK_TERMINAL_STATUSES.has(status)) {
        throw new HttpError(409, 'SQUAD_TASK_TERMINAL', '任务已结束，无法提交心跳');
      }

      const next = {
        ...current,
        status: 'running',
        startedAt: pickText(current.startedAt, current.createdAt, nowIso()),
        lastHeartbeatAt: nowIso(),
        progressPercent: Math.max(clamp(current.progressPercent, 0, 99), progressPercent, 5),
        stalledAt: '',
        stalledReason: '',
        progressNote: note || pickText(current.progressNote)
      };
      list[idx] = next;
      updatedTask = next;
      return list;
    });

    await this.logService.append({
      action: 'squad.task.heartbeat',
      type: 'squad',
      target: updatedTask.roleId,
      status: 'success',
      message: `${updatedTask.roleName} 更新任务心跳：${updatedTask.title}`,
      meta: {
        taskId: updatedTask.id,
        progressPercent: updatedTask.progressPercent,
        progressNote: pickText(updatedTask.progressNote)
      }
    });

    return updatedTask;
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
