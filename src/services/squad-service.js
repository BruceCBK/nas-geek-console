const crypto = require('crypto');
const path = require('path');
const { existsSync } = require('fs');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const { HttpError } = require('../utils/http-error');
const { MEMORY_DIR } = require('../config/paths');
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
  'radar-qa': ['doc-pulse', 'neon-scout'],
  'neon-scout': ['doc-pulse', 'radar-qa'],
  'doc-pulse': ['neon-scout', 'radar-qa']
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
const REWARD_COMPLETION_THRESHOLD = 90;
const REWARD_QUALITY_THRESHOLD = 90;
const REWARD_STREAK_STEP = 3;
const REWARD_MAX_BONUS = 5;
const BLOCK_AT_RISK_MS = 4 * 60 * 1000;
const ROLE_OVERLOAD_OPEN_TASKS = 6;
const CAUSE_LABELS = {
  heartbeat_timeout: '心跳超时',
  overload: '负载过高',
  collab_lag: '协同卡点',
  execution_stagnation: '执行停滞'
};

const ROLE_WORK_INTENT = {
  'neon-scout': '资料检索与事实交叉校验',
  'code-claw': '实现方案与交付代码变更',
  'radar-qa': '回归验证与质量门禁',
  'ops-tide': '稳定性保障与运维闭环',
  'doc-pulse': '结论沉淀与可读汇报'
};

const COLLAB_CHAIN_PHASES = [
  { key: 'scout', label: '侦察', roleIds: ['neon-scout'] },
  { key: 'implementation', label: '实现', roleIds: ['code-claw', 'ops-tide'] },
  { key: 'validation_doc', label: '验证/文档', roleIds: ['radar-qa', 'doc-pulse'] }
];
const FINAL_REPORT_MAX_RETRY = 3;
const FINAL_REPORT_RETRY_DELAY_MS = 1200;

const PY311_REPORTER_SCRIPT = path.resolve(__dirname, '../../scripts/squad-reporting-py311.py');
const PY311_REPORTER_CONFIG = path.resolve(__dirname, '../../config/squad-reporting.toml');
const PY311_REPORTER_TIMEOUT_MS = Math.max(
  600,
  Number.parseInt(process.env.SQUAD_REPORTER_TIMEOUT_MS || '1600', 10) || 1600
);
const SQUAD_REPORT_CACHE_MS = Math.max(
  4000,
  Number.parseInt(process.env.SQUAD_REPORT_CACHE_MS || '12000', 10) || 12000
);

const SQUAD_MEMORY_SYNC_MAX_ITEMS = Math.max(
  2,
  Number.parseInt(process.env.SQUAD_MEMORY_SYNC_MAX_ITEMS || '6', 10) || 6
);
const SQUAD_MEMORY_AUTO_SYNC_ENABLED = String(process.env.SQUAD_MEMORY_AUTO_SYNC_ENABLED || 'true').toLowerCase() !== 'false';
const SQUAD_MEMORY_AUTO_SYNC_MS = Math.max(
  60 * 1000,
  Number.parseInt(process.env.SQUAD_MEMORY_AUTO_SYNC_MS || String(5 * 60 * 1000), 10) || 5 * 60 * 1000
);
const SQUAD_BLOCKED_ARCHIVE_DIR = path.join(MEMORY_DIR, 'cards', 'squad-blocked');

const SQUAD_STATE_TASK_MAX = Math.max(
  60,
  Number.parseInt(process.env.SQUAD_STATE_TASK_MAX || '240', 10) || 240
);

const SQUAD_PARALLEL_MIN_ROLES = 2;
const SQUAD_PARALLEL_MAX_ROLES = 3;
const SQUAD_COLLAB_MAX_LINKED = Math.max(
  1,
  Number.parseInt(process.env.SQUAD_COLLAB_MAX_LINKED || String(SQUAD_PARALLEL_MAX_ROLES - 1), 10) || (SQUAD_PARALLEL_MAX_ROLES - 1)
);

const SQUAD_COMMAND_BRIDGE_ENABLED = String(process.env.SQUAD_COMMAND_BRIDGE_ENABLED || 'true').toLowerCase() !== 'false';
const SQUAD_COMMAND_BRIDGE_TICK_MS = Math.max(
  8000,
  Number.parseInt(process.env.SQUAD_COMMAND_BRIDGE_TICK_MS || '12000', 10) || 12000
);
const SQUAD_COMMAND_BRIDGE_MAX_TASKS = Math.max(
  20,
  Number.parseInt(process.env.SQUAD_COMMAND_BRIDGE_MAX_TASKS || '120', 10) || 120
);
const LONG_TASKS_PATH = path.join(MEMORY_DIR, 'long-tasks.json');

const SQUAD_COMMAND_BRIDGE_SHOW_WINDOW_MS = Math.max(
  30 * 60 * 1000,
  Number.parseInt(process.env.SQUAD_COMMAND_BRIDGE_SHOW_WINDOW_MS || String(6 * 60 * 60 * 1000), 10) || 6 * 60 * 60 * 1000
);

const DEFAULT_ROLES = [
  {
    id: 'neon-scout',
    name: '霓虹侦察虾',
    codename: 'Neon Scout',
    specialty: '情报检索 / 事实交叉验证 / 线索收敛',
    vibe: '快、准、冷静',
    avatar: 'avatars/roles/neon-scout.svg'
  },
  {
    id: 'code-claw',
    name: '铁钳代码虾',
    codename: 'Code Claw',
    specialty: '功能开发 / 修复 / 重构',
    vibe: '稳、狠、可维护',
    avatar: 'avatars/roles/code-claw.svg'
  },
  {
    id: 'radar-qa',
    name: '雷达测试虾',
    codename: 'Radar QA',
    specialty: '回归测试 / 边界场景 / 质量门禁',
    vibe: '严、细、可复现',
    avatar: 'avatars/roles/radar-qa.svg'
  },
  {
    id: 'ops-tide',
    name: '黑潮运维虾',
    codename: 'Ops Tide',
    specialty: '服务巡检 / 性能诊断 / 稳定性保障',
    vibe: '警觉、务实、抗压',
    avatar: 'avatars/roles/ops-tide.svg'
  },
  {
    id: 'doc-pulse',
    name: '脉冲文档虾',
    codename: 'Doc Pulse',
    specialty: '文档沉淀 / 方案说明 / 变更记录',
    vibe: '清晰、结构化、可追溯',
    avatar: 'avatars/roles/doc-pulse.svg'
  }
];

const DEFAULT_ROLE_BY_ID = new Map(DEFAULT_ROLES.map((role) => [pickText(role.id), role]));


function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeAvatarPath(input = '') {
  const value = pickText(input);
  if (!value) return '';
  if (/^(https?:)?\/\//i.test(value) || /^data:/i.test(value)) return value;
  return value.replace(/^\/+/, '');
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function blockedPenaltyMultiplier(recentBlockedCount = 0) {
  const count = Math.max(0, Number(recentBlockedCount) || 0);
  if (count >= 10) return 2;
  if (count >= 6) return 1.5;
  if (count >= 3) return 1.25;
  return 1;
}

function recentBlockedCountForRole(taskRows = [], roleId, nowMs = Date.now()) {
  if (!roleId) return 0;
  const windowMs = 24 * 60 * 60 * 1000;

  return toArray(taskRows)
    .filter((task) => task && task.roleId === roleId)
    .reduce((sum, task) => {
      const blockedAtText = pickText(task.lastBlockedAt, task.stalledAt, task.blockedAt);
      const blockedMs = Date.parse(blockedAtText);
      if (!Number.isFinite(blockedMs) || nowMs - blockedMs > windowMs) return sum;
      return sum + Math.max(1, Number(task.blockedCount) || 0);
    }, 0);
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

function computeRewardDecision({ passed, completion, judgeQuality, blockedCount, streakBefore }) {
  if (!passed) {
    return {
      bonus: 0,
      nextStreak: 0,
      reason: '任务未通过，奖励连胜清零'
    };
  }

  const okCompletion = completion >= REWARD_COMPLETION_THRESHOLD;
  const okQuality = judgeQuality >= REWARD_QUALITY_THRESHOLD;
  const cleanRun = (Number(blockedCount) || 0) <= 0;

  if (!okCompletion || !okQuality) {
    return {
      bonus: 0,
      nextStreak: 0,
      reason: '通过但未达高质量阈值，奖励连胜重置'
    };
  }

  const nextStreak = Math.max(0, Number(streakBefore) || 0) + 1;
  const tierBonus = 1 + Math.floor((nextStreak - 1) / REWARD_STREAK_STEP);
  const cleanBonus = cleanRun ? 1 : 0;
  const bonus = Math.min(REWARD_MAX_BONUS, tierBonus + cleanBonus);

  const reasonParts = [
    `高质量通过(完成度${Math.round(completion)} / 质量${Math.round(judgeQuality)})`,
    `连胜${nextStreak}`,
    `阶段奖励${tierBonus}`
  ];
  if (cleanBonus) reasonParts.push('无阻塞加成+1');

  return {
    bonus,
    nextStreak,
    reason: reasonParts.join('，')
  };
}

function buildRoleOpenLoadMap(taskRows = []) {
  const map = new Map();
  for (const task of toArray(taskRows)) {
    const roleId = pickText(task?.roleId);
    if (!roleId) continue;
    const status = pickText(task?.status).toLowerCase();
    if (!TASK_OPEN_STATUSES.has(status)) continue;
    map.set(roleId, (map.get(roleId) || 0) + 1);
  }
  return map;
}

function inferBlockedCause(task = {}, roleOpenLoad = 0) {
  const blockedCount = Math.max(1, Number(task.blockedCount) || 1);
  const relation = pickText(task.relationType, 'primary').toLowerCase();

  if (blockedCount >= 3) {
    return {
      code: 'execution_stagnation',
      cause: '同一任务多次阻塞，执行方法需要重构',
      coaching: '建议拆分任务为更小里程碑，并在每个里程碑后复盘。'
    };
  }

  if (roleOpenLoad >= ROLE_OVERLOAD_OPEN_TASKS) {
    return {
      code: 'overload',
      cause: `角色当前在办任务 ${roleOpenLoad} 条，超出负载阈值`,
      coaching: '建议先清理在办队列，并启用协同派工分流。'
    };
  }

  if (relation === 'linked') {
    return {
      code: 'collab_lag',
      cause: '协同子任务卡在对齐阶段，缺少同步检查点',
      coaching: '建议在主任务每次关键变更后同步协同任务心跳。'
    };
  }

  return {
    code: 'heartbeat_timeout',
    cause: '任务在执行窗口内未上报有效心跳',
    coaching: '建议缩短心跳间隔并补充进展备注，避免信息黑盒。'
  };
}

function pickCollaborationRoles({ primaryRoleId, scoredRows = [], roles = [], loadMap = new Map() }) {
  const policyRoles = toArray(COLLAB_POLICY[primaryRoleId]);
  const matchedSecondary = scoredRows
    .filter((row) => row?.role?.id && row.role.id !== primaryRoleId)
    .map((row) => row.role.id);
  const allSecondary = toArray(roles)
    .map((row) => row?.id)
    .filter((id) => pickText(id) && id !== primaryRoleId);

  const unique = Array.from(new Set([...matchedSecondary, ...policyRoles, ...allSecondary]));
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
    .slice(0, SQUAD_COLLAB_MAX_LINKED)
    .map((role) => role.id);
}

function decideParallelRoleCount({ title = '', description = '', weight = 1, source = '' } = {}) {
  const sourceText = pickText(source).toLowerCase();
  if (sourceText.startsWith('user')) {
    return SQUAD_PARALLEL_MAX_ROLES;
  }

  const merged = `${pickText(title)} ${pickText(description)}`.toLowerCase();
  const highComplexity = /(汇报|新闻|分析|排查|重构|联调|验收|优化|协作|复杂|investigate|analysis|refactor|regression|report|brief)/u.test(merged);
  const base = clamp((Number(weight) || 1) + 1, SQUAD_PARALLEL_MIN_ROLES, SQUAD_PARALLEL_MAX_ROLES);
  if (highComplexity) return SQUAD_PARALLEL_MAX_ROLES;
  return base;
}

function buildParallelRoleIds({ primaryRoleId, preferredRoleIds = [], allRoles = [], targetTotalRoles = SQUAD_PARALLEL_MIN_ROLES }) {
  const maxRoles = clamp(targetTotalRoles, SQUAD_PARALLEL_MIN_ROLES, SQUAD_PARALLEL_MAX_ROLES);
  const targetLinked = Math.max(1, maxRoles - 1);
  const fallback = toArray(allRoles)
    .map((row) => row?.id)
    .filter((id) => pickText(id) && id !== primaryRoleId);
  const candidates = Array.from(new Set([...toArray(preferredRoleIds), ...fallback])).filter((id) => id !== primaryRoleId);

  const selected = [];
  const currentRoleSet = new Set([primaryRoleId]);

  for (const phase of COLLAB_CHAIN_PHASES) {
    const phaseReady = Array.from(currentRoleSet).some((roleId) => phase.roleIds.includes(roleId));
    if (phaseReady) continue;
    const roleId = candidates.find((id) => phase.roleIds.includes(id) && !selected.includes(id));
    if (roleId) {
      selected.push(roleId);
      currentRoleSet.add(roleId);
    }
    if (selected.length >= targetLinked) break;
  }

  for (const roleId of candidates) {
    if (selected.length >= targetLinked) break;
    if (!selected.includes(roleId)) {
      selected.push(roleId);
      currentRoleSet.add(roleId);
    }
  }

  const linkedRoleIds = selected.slice(0, Math.min(SQUAD_COLLAB_MAX_LINKED, targetLinked));
  return {
    targetTotalRoles: maxRoles,
    linkedRoleIds,
    parallelRoleIds: [primaryRoleId, ...linkedRoleIds]
  };
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
    const collaborationRoleIds = pickCollaborationRoles({
      primaryRoleId: manualRole.id,
      scoredRows: [],
      roles: roleRows,
      loadMap
    });
    return {
      role: manualRole,
      matchedRoleIds: [manualRole.id],
      collaborationRoleIds,
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
  const collaborationRoleIds = pickCollaborationRoles({
    primaryRoleId: picked.id,
    scoredRows: [],
    roles: roleRows,
    loadMap
  });
  return {
    role: picked,
    matchedRoleIds: [],
    collaborationRoleIds,
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
  relationType = 'primary',
  dispatchSource = 'user.primary',
  sourceTaskId = '',
  parallelRoleIds = [],
  parallelRoleCount = 0,
  coordinationMode = 'parallel'
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
    dispatchSource: pickText(dispatchSource, relationType === 'linked' ? 'derived.linked' : 'user.primary'),
    sourceTaskId: pickText(sourceTaskId, parentTaskId),
    parallelRoleIds: Array.from(new Set(toArray(parallelRoleIds).map((id) => pickText(id)).filter(Boolean))),
    parallelRoleCount: Math.max(1, Number(parallelRoleCount) || toArray(parallelRoleIds).length || 1),
    coordinationMode: pickText(coordinationMode, 'parallel'),
    finalReportStatus: relationType === 'primary' ? 'pending' : '',
    finalReportAt: '',
    finalReport: '',
    finalReportAttempts: 0,
    finalReportError: '',
    finalReportMissingPhases: [],
    finalReportChainReady: false,
    weight,
    status: 'running',
    progressPercent: 5,
    startedAt: ts,
    lastHeartbeatAt: ts,
    stalledAt: '',
    stalledReason: '',
    runtimeRisk: '',
    riskReason: '',
    blockedCount: 0,
    lastBlockedAt: '',
    blockedPenaltyApplied: false,
    blockedReasonCode: '',
    blockedRootCause: '',
    recoveryHint: '',
    rewardBonus: 0,
    rewardReason: '',
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
    avatar: normalizeAvatarPath(base.avatar),
    score: BASE_SCORE,
    status: 'active',
    totalTasks: 0,
    doneTasks: 0,
    failedTasks: 0,
    failureEvents: 0,
    blockedPressure24h: 0,
    blockedPenaltyMultiplier: 1,
    rewardStreak: 0,
    bestRewardStreak: 0,
    rewardPoints: 0,
    lastRewardAt: '',
    capabilityIndex: 100,
    growthFocus: '保持高频心跳与高质量交付',
    blockCauseStats: {},
    avgCompletion: 0,
    avgQuality: 0,
    warningCount: 0,
    reflection: '',
    dispatchDoctrine: CAPTAIN_DISPATCH_DOCTRINE,
    updatedAt: nowIso()
  };
}


function parseIsoMs(input) {
  const ms = Date.parse(pickText(input));
  return Number.isFinite(ms) ? ms : 0;
}

function taskRecencyMs(task = {}) {
  return Math.max(
    parseIsoMs(task?.lastHeartbeatAt),
    parseIsoMs(task?.startedAt),
    parseIsoMs(task?.createdAt),
    parseIsoMs(task?.gradedAt),
    0
  );
}

function taskStatusLabel(status) {
  const key = pickText(status).toLowerCase();
  if (key === 'running') return '进行中';
  if (key === 'pending') return '待处理';
  if (key === 'blocked') return '阻塞';
  if (key === 'completed') return '已完成';
  if (key === 'failed') return '已失败';
  return key || '未知';
}

function stripLinkedPrefix(title) {
  return pickText(title).replace(/^\[协同\]\s*/u, '');
}

function inferTaskSemanticTitle(task = {}) {
  const cleanTitle = stripLinkedPrefix(task?.title);
  const lower = cleanTitle.toLowerCase();
  const hasChinese = /[一-龥]/u.test(cleanTitle);
  if (hasChinese) return cleanTitle;
  if (/news|brief|report|summary|汇报|新闻/u.test(cleanTitle)) return '新闻情报汇总与播报';
  if (/login|auth|token|permission/u.test(lower)) return '登录鉴权链路修复';
  if (/memory|sync|archive/u.test(lower)) return '记忆同步与归档优化';
  if (/timeout|latency|delay/u.test(lower)) return '超时与时延治理';
  if (/scroll|page|pagination|list/u.test(lower)) return '任务大厅展示优化';
  if (/bug|fix|error|issue/u.test(lower)) return '问题修复任务';
  if (/test|qa|verify|smoke/u.test(lower)) return '质量回归验证任务';
  if (/refactor|cleanup|optimi/u.test(lower)) return '结构优化与清理任务';
  return '通用执行任务';
}

function isSyntheticSmokeTask(task = {}) {
  const source = pickText(task?.dispatchSource).toLowerCase();
  if (source.includes('system.smoke')) return true;

  const cleanTitle = stripLinkedPrefix(task?.title).toLowerCase();
  const desc = pickText(task?.description).toLowerCase();
  if (cleanTitle === 'fix login bug in code path' && desc.includes('dev refactor to fix regression')) return true;
  if (cleanTitle.includes('smoke squad task')) return true;
  if (cleanTitle === 'score-cap-test') return true;
  return cleanTitle.includes('smoke') && desc.includes('smoke');
}

function isBridgeTaskRow(task = {}) {
  const source = pickText(task?.dispatchSource).toLowerCase();
  if (source === 'user.command.bridge' || source === 'derived.linked.bridge') return true;
  if (source === 'derived.linked' && pickText(task?.title).startsWith('[协同] 指令任务桥接｜')) return true;
  return false;
}

function taskSourceLabel(task = {}) {
  const source = pickText(task?.dispatchSource).toLowerCase();
  const relation = pickText(task?.relationType, 'primary').toLowerCase();
  if (source.includes('system.smoke') || isSyntheticSmokeTask(task)) return '系统测试任务';
  if (source.startsWith('user')) return '用户主派发';
  if (source.startsWith('derived') || relation === 'linked') return '协同衍生任务';
  if (source.startsWith('system')) return '系统自动派发';
  return relation === 'linked' ? '协同衍生任务' : '队内任务';
}

function taskRoleAction(task = {}) {
  const roleId = pickText(task?.roleId);
  const intent = pickText(ROLE_WORK_INTENT[roleId], '推进任务执行');
  const semantic = inferTaskSemanticTitle(task);
  if (pickText(task?.relationType, 'primary').toLowerCase() === 'linked') {
    return `${intent}，协同支援主任务《${semantic}》`;
  }
  return `${intent}，主责推进《${semantic}》`;
}

function taskDisplayTitle(task = {}) {
  const cleanTitle = stripLinkedPrefix(task?.title);
  const semantic = inferTaskSemanticTitle(task);
  if (pickText(task?.relationType, 'primary').toLowerCase() === 'linked') {
    return `协同任务｜${semantic}（原题：${cleanTitle}）`;
  }
  return `主线任务｜${semantic}（原题：${cleanTitle}）`;
}

function buildTaskGroupRosterMap(tasks = []) {
  const groups = new Map();
  for (const task of toArray(tasks)) {
    const gid = pickText(task?.taskGroupId);
    if (!gid) continue;
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(task);
  }

  const rosterMap = new Map();
  for (const [gid, rows] of groups.entries()) {
    const text = rows
      .slice()
      .sort((a, b) => taskRecencyMs(b) - taskRecencyMs(a))
      .map((row) => `${pickText(row?.roleName, row?.roleId, '-')}(${taskStatusLabel(row?.status)})`)
      .join(' · ');
    rosterMap.set(gid, text);
  }
  return rosterMap;
}

function sleep(ms) {
  const waitMs = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

function summarizeChainPhases(groupTasks = []) {
  const rows = toArray(groupTasks);
  return COLLAB_CHAIN_PHASES.map((phase) => {
    const related = rows.filter((task) => phase.roleIds.includes(pickText(task?.roleId)));
    const completed = related.filter((task) => pickText(task?.status).toLowerCase() === 'completed');
    return {
      key: phase.key,
      label: phase.label,
      ready: completed.length > 0,
      totalCount: related.length,
      completedCount: completed.length,
      completedTaskIds: completed.map((task) => pickText(task?.id)).filter(Boolean)
    };
  });
}

function renderChainSummary(phaseRows = []) {
  return toArray(phaseRows)
    .map((row) => `${pickText(row?.label)}:${row?.ready ? '完成' : '缺失'}(${Number(row?.completedCount) || 0}/${Number(row?.totalCount) || 0})`)
    .join('｜');
}

function resolvePrimaryTaskInGroup(groupTasks = [], hintTask = {}) {
  const rows = toArray(groupTasks);
  if (!rows.length) return null;

  const hintSource = pickText(hintTask?.sourceTaskId, hintTask?.parentTaskId);
  if (hintSource) {
    const byHint = rows.find((task) => pickText(task?.id) === hintSource);
    if (byHint) return byHint;
  }

  const explicitPrimary = rows.find((task) => pickText(task?.relationType, 'primary').toLowerCase() === 'primary');
  if (explicitPrimary) return explicitPrimary;

  return rows[0] || null;
}

function buildFinalReportText({ primaryTask = {}, groupTasks = [], phaseRows = [] } = {}) {
  const title = pickText(primaryTask?.displayTitle, primaryTask?.title, primaryTask?.id, '未命名任务');
  const sourceLabel = taskSourceLabel(primaryTask);
  const chain = renderChainSummary(phaseRows);
  const completedRows = toArray(groupTasks).filter((task) => pickText(task?.status).toLowerCase() === 'completed');
  const roleSummary = completedRows
    .map((task) => `${pickText(task?.roleName, task?.roleId, '-')}: ${pickText(task?.reviewNote, task?.progressNote, '已完成')}`)
    .slice(0, 6)
    .join('；');

  return [
    `最终汇报｜${title}`,
    `来源：${sourceLabel}`,
    `协作链路：${chain}`,
    `执行结论：${pickText(primaryTask?.reviewNote, primaryTask?.progressNote, '任务已完成')}`,
    `角色产出：${pickText(roleSummary, '暂无角色产出摘要')}`
  ].join('\n');
}

function toCstDateKey(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function formatCstClock(now = new Date()) {
  return now.toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai'
  });
}

function toRelativeMemoryPath(absPath) {
  return path.relative(MEMORY_DIR, absPath).split(path.sep).join('/');
}

function normalizeReportingPayload(input = {}) {
  return {
    engine: pickText(input?.engine, 'unknown'),
    generatedAt: pickText(input?.generatedAt, nowIso()),
    liveBrief: pickText(input?.liveBrief),
    alerts: toArray(input?.alerts).map((item) => pickText(item)).filter(Boolean),
    memoryTips: toArray(input?.memoryTips).map((item) => pickText(item)).filter(Boolean),
    memoryDigest: {
      dailyBullets: toArray(input?.memoryDigest?.dailyBullets).map((item) => pickText(item)).filter(Boolean),
      blockedBullets: toArray(input?.memoryDigest?.blockedBullets).map((item) => pickText(item)).filter(Boolean)
    },
    errors: toArray(input?.errors).map((item) => pickText(item)).filter(Boolean)
  };
}

function makeMemorySyncFingerprint({ reporting = {}, blockedTasks = [] } = {}) {
  const seed = JSON.stringify({
    engine: reporting?.engine,
    liveBrief: reporting?.liveBrief,
    alerts: toArray(reporting?.alerts).slice(0, SQUAD_MEMORY_SYNC_MAX_ITEMS),
    memoryTips: toArray(reporting?.memoryTips).slice(0, SQUAD_MEMORY_SYNC_MAX_ITEMS),
    blockedIds: toArray(blockedTasks).map((task) => pickText(task?.id)).slice(0, SQUAD_MEMORY_SYNC_MAX_ITEMS)
  });
  return crypto.createHash('sha1').update(seed).digest('hex');
}

function buildDailyMemorySection({ reporting = {}, blockedTasks = [], nowText = nowIso(), source = 'manual' } = {}) {
  const alerts = toArray(reporting?.alerts).slice(0, SQUAD_MEMORY_SYNC_MAX_ITEMS);
  const tips = toArray(reporting?.memoryDigest?.dailyBullets).length
    ? toArray(reporting?.memoryDigest?.dailyBullets).slice(0, SQUAD_MEMORY_SYNC_MAX_ITEMS)
    : toArray(reporting?.memoryTips).slice(0, SQUAD_MEMORY_SYNC_MAX_ITEMS);

  const lines = [
    `- [squad-sync ${nowText}] source=${source}`,
    `  - 实时播报: ${pickText(reporting?.liveBrief, '无')}`,
    `  - 播报引擎: ${pickText(reporting?.engine, 'unknown')} @ ${pickText(reporting?.generatedAt, nowText)}`
  ];

  for (const row of alerts) {
    lines.push(`  - 风险提醒: ${pickText(row)}`);
  }

  for (const row of tips) {
    lines.push(`  - 记忆建议: ${pickText(row)}`);
  }

  if (blockedTasks.length) {
    lines.push(`  - 阻塞任务数: ${blockedTasks.length}`);
  }

  return `${lines.join('\n')}\n`;
}

function buildBlockedArchiveSection({ blockedTasks = [], causeLabels = {}, nowText = nowIso() } = {}) {
  const list = toArray(blockedTasks).slice(0, SQUAD_MEMORY_SYNC_MAX_ITEMS);
  if (!list.length) return '';

  const lines = [`## ${nowText} 自动归档（blocked=${list.length}）`];
  for (const task of list) {
    const reasonCode = pickText(task?.blockedReasonCode, 'heartbeat_timeout');
    const reasonLabel = pickText(causeLabels?.[reasonCode], reasonCode);
    lines.push(`- ${pickText(task?.title, task?.id)} @ ${pickText(task?.roleName, task?.roleId, '-')}`);
    lines.push(`  - 原因: ${reasonLabel}`);
    lines.push(`  - 根因: ${pickText(task?.blockedRootCause, task?.stalledReason, '未提供')}`);
    lines.push(`  - 建议: ${pickText(task?.recoveryHint, '补充进展心跳并拆分里程碑')}`);
    lines.push(`  - 最近心跳: ${pickText(task?.lastHeartbeatAt, task?.createdAt, '-')}`);
  }

  return `${lines.join('\n')}\n`;
}

function buildJsFallbackReporting({ roles = [], tasks = [], executor = {}, reason = '' } = {}) {
  const blocked = toArray(tasks).filter((task) => pickText(task?.status).toLowerCase() === 'blocked');
  const atRisk = toArray(tasks).filter((task) => pickText(task?.runtimeRisk).toLowerCase() === 'at-risk');
  const running = toArray(tasks).filter((task) => {
    const status = pickText(task?.status).toLowerCase();
    return status === 'running' || status === 'pending';
  });
  const avgScore = Math.round(avg(toArray(roles).map((role) => Number(role?.score) || 0)));

  const alerts = blocked
    .slice()
    .sort((a, b) => parseIsoMs(b?.lastHeartbeatAt || b?.createdAt) - parseIsoMs(a?.lastHeartbeatAt || a?.createdAt))
    .slice(0, 4)
    .map((task) => {
      const roleName = pickText(task?.roleName, task?.roleId, '-');
      const title = pickText(task?.title, task?.id, '未知任务');
      return `[BLOCKED] ${title} @ ${roleName}`;
    });

  const memoryTips = toArray(tasks)
    .filter((task) => pickText(task?.status).toLowerCase() === 'completed')
    .slice()
    .sort((a, b) => parseIsoMs(b?.gradedAt || b?.lastHeartbeatAt) - parseIsoMs(a?.gradedAt || a?.lastHeartbeatAt))
    .slice(0, 4)
    .map((task) => {
      const roleName = pickText(task?.roleName, task?.roleId, '-');
      const title = pickText(task?.title, task?.id, '未知任务');
      return `记忆候选：${roleName} 完成《${title}》`; 
    });

  const fallbackReason = pickText(reason) ? `｜fallback: ${pickText(reason)}` : '';

  return {
    engine: 'js-fallback-v1',
    generatedAt: nowIso(),
    liveBrief: `任务 ${toArray(tasks).length}｜进行中 ${running.length}｜风险 ${atRisk.length}｜阻塞 ${blocked.length}｜角色均分 ${avgScore}｜执行器 ${executor?.enabled ? 'ON' : 'OFF'}${fallbackReason}`,
    alerts,
    memoryTips,
    memoryDigest: {
      dailyBullets: memoryTips.slice(0, SQUAD_MEMORY_SYNC_MAX_ITEMS),
      blockedBullets: alerts.filter((line) => String(line || '').startsWith('[BLOCKED]')).slice(0, Math.max(1, Math.floor(SQUAD_MEMORY_SYNC_MAX_ITEMS / 2)))
    },
    errors: pickText(reason) ? [pickText(reason)] : []
  };
}

function runPy311Reporter(input = {}, options = {}) {
  const timeoutMs = Math.max(400, Number(options.timeoutMs) || PY311_REPORTER_TIMEOUT_MS);

  if (!existsSync(PY311_REPORTER_SCRIPT)) {
    return Promise.reject(new Error(`python reporter missing: ${PY311_REPORTER_SCRIPT}`));
  }

  return new Promise((resolve, reject) => {
    const child = spawn('python3.11', [PY311_REPORTER_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`python reporter timeout(${timeoutMs}ms)`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(`python reporter exit=${code}: ${pickText(stderr, 'unknown error')}`));
        return;
      }

      let parsed = null;
      try {
        parsed = stdout ? JSON.parse(stdout) : null;
      } catch (error) {
        reject(new Error(`python reporter parse error: ${pickText(error?.message, String(error))}`));
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        reject(new Error('python reporter empty payload'));
        return;
      }

      resolve(parsed);
    });

    child.stdin.end(JSON.stringify(input));
  });
}

class SquadService {
  constructor(roleStore, taskStore, logService, openclawService = null) {
    this.roleStore = roleStore;
    this.taskStore = taskStore;
    this.logService = logService;
    this.openclawService = openclawService;
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
    this.reportingCacheMs = SQUAD_REPORT_CACHE_MS;
    this.reportingCache = {
      atMs: 0,
      payload: null
    };
    this.memorySyncCache = {
      atMs: 0,
      fingerprint: ''
    };
    this.memorySyncInFlight = false;
    this.memoryAutoSyncEnabled = SQUAD_MEMORY_AUTO_SYNC_ENABLED;
    this.memoryAutoSyncMs = SQUAD_MEMORY_AUTO_SYNC_MS;
    this.memoryAutoSyncTimer = null;
    this.memoryAutoSyncLastTickAt = '';
    this.memoryAutoSyncLastSyncAt = '';
    this.memoryAutoSyncLastSource = '';
    this.memoryAutoSyncLastResult = '';
    this.memoryAutoSyncLastError = '';
    this.memoryAutoSyncStats = {
      ticks: 0,
      synced: 0,
      skipped: 0,
      failed: 0
    };
    this.commandBridgeEnabled = SQUAD_COMMAND_BRIDGE_ENABLED;
    this.commandBridgeTickMs = SQUAD_COMMAND_BRIDGE_TICK_MS;
    this.commandBridgeMaxTasks = SQUAD_COMMAND_BRIDGE_MAX_TASKS;
    this.commandBridgeTimer = null;
    this.commandBridgeTickRunning = false;
    this.commandBridgeLastTickAt = '';
    this.commandBridgeLastSyncAt = '';
    this.commandBridgeLastError = '';
    this.commandBridgeStats = {
      ticks: 0,
      createdGroups: 0,
      syncedTasks: 0,
      failed: 0
    };
  }

  _invalidateReportingCache() {
    this.reportingCache = {
      atMs: 0,
      payload: null
    };
  }

  async _buildReportingSnapshot({ roles = [], tasks = [], summary = {}, executor = {}, causeLabels = {} } = {}) {
    const nowMs = Date.now();
    if (this.reportingCache.payload && nowMs - Number(this.reportingCache.atMs || 0) <= this.reportingCacheMs) {
      return this.reportingCache.payload;
    }

    const input = {
      roles,
      tasks: toArray(tasks).slice(0, 120),
      summary,
      executor,
      causeLabels,
      configPath: PY311_REPORTER_CONFIG,
      now: nowIso()
    };

    let snapshot = null;
    try {
      snapshot = await runPy311Reporter(input, { timeoutMs: PY311_REPORTER_TIMEOUT_MS });
      snapshot = normalizeReportingPayload(snapshot);
    } catch (error) {
      snapshot = normalizeReportingPayload(
        buildJsFallbackReporting({
          roles,
          tasks,
          executor,
          reason: pickText(error?.message, String(error))
        })
      );
    }

    this.reportingCache = {
      atMs: nowMs,
      payload: snapshot
    };

    return snapshot;
  }

  async init() {
    await Promise.all([this.roleStore.init(), this.taskStore.init()]);
    await this._ensureSeed();
    await this._normalizeRoleScores();
    await this._normalizeTaskRuntime();
    this._startExecutorLoop();
    this._startMemorySyncLoop();
    this._startCommandBridgeLoop();
  }

  async _normalizeRoleScores() {
    await this.roleStore.update((rows) => {
      return toArray(rows).map((role) => {
        const roleId = pickText(role?.id);
        const defaultRole = DEFAULT_ROLE_BY_ID.get(roleId) || {};
        const score = clamp(role?.score, 0, MAX_SCORE);
        const status = score < WARNING_SCORE ? 'warning' : 'active';
        let capabilitySeed = numberOr(role?.capabilityIndex, score || 100);
        if (capabilitySeed === 0 && score >= 90 && numberOr(role?.failureEvents, 0) <= 1) {
          capabilitySeed = score || 100;
        }

        return {
          ...role,
          name: pickText(role?.name, defaultRole?.name),
          codename: pickText(role?.codename, defaultRole?.codename),
          specialty: pickText(role?.specialty, defaultRole?.specialty),
          vibe: pickText(role?.vibe, defaultRole?.vibe),
          avatar: normalizeAvatarPath(pickText(role?.avatar, defaultRole?.avatar)),
          score,
          dispatchDoctrine: pickText(role?.dispatchDoctrine, CAPTAIN_DISPATCH_DOCTRINE),
          failureEvents: Number(role?.failureEvents) || Number(role?.failedTasks) || 0,
          blockedPressure24h: Math.max(0, Number(role?.blockedPressure24h) || 0),
          blockedPenaltyMultiplier: Math.max(1, Number(role?.blockedPenaltyMultiplier) || 1),
          rewardStreak: Math.max(0, Number(role?.rewardStreak) || 0),
          bestRewardStreak: Math.max(0, Number(role?.bestRewardStreak) || 0),
          rewardPoints: Math.max(0, Number(role?.rewardPoints) || 0),
          lastRewardAt: pickText(role?.lastRewardAt),
          capabilityIndex: clamp(capabilitySeed, 0, 100),
          growthFocus: pickText(role?.growthFocus, '保持高频心跳与高质量交付'),
          blockCauseStats: role?.blockCauseStats && typeof role.blockCauseStats === 'object' ? role.blockCauseStats : {},
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

  _buildMemorySyncMeta() {
    return {
      enabled: this.memoryAutoSyncEnabled,
      intervalMs: this.memoryAutoSyncMs,
      lastTickAt: this.memoryAutoSyncLastTickAt,
      lastSyncAt: this.memoryAutoSyncLastSyncAt,
      lastSource: this.memoryAutoSyncLastSource,
      lastResult: this.memoryAutoSyncLastResult,
      lastError: this.memoryAutoSyncLastError,
      lastFingerprint: pickText(this.memorySyncCache?.fingerprint).slice(0, 12),
      stats: { ...this.memoryAutoSyncStats }
    };
  }

  _startMemorySyncLoop() {
    if (!this.memoryAutoSyncEnabled || this.memoryAutoSyncTimer) return;

    this.memoryAutoSyncTimer = setInterval(() => {
      this._memorySyncAutoTick().catch((error) => {
        this.memoryAutoSyncLastError = pickText(error?.message, String(error));
        this.memoryAutoSyncStats.failed += 1;
      });
    }, this.memoryAutoSyncMs);

    if (typeof this.memoryAutoSyncTimer.unref === 'function') {
      this.memoryAutoSyncTimer.unref();
    }
  }

  async _memorySyncAutoTick() {
    this.memoryAutoSyncLastTickAt = nowIso();
    this.memoryAutoSyncStats.ticks += 1;

    try {
      const result = await this.syncReportingMemory({
        source: 'auto.loop',
        force: false,
        dryRun: false,
        maxItems: SQUAD_MEMORY_SYNC_MAX_ITEMS,
        suppressLog: true
      });
      this.memoryAutoSyncLastSyncAt = pickText(result?.syncedAt, nowIso());
      this.memoryAutoSyncLastSource = pickText(result?.source, 'auto.loop');
      this.memoryAutoSyncLastResult = result?.dedupHit ? 'skipped' : 'synced';
      this.memoryAutoSyncLastError = '';
      if (result?.dedupHit) {
        this.memoryAutoSyncStats.skipped += 1;
      } else {
        this.memoryAutoSyncStats.synced += 1;
      }
    } catch (error) {
      this.memoryAutoSyncLastError = pickText(error?.message, String(error));
      this.memoryAutoSyncLastResult = 'failed';
      this.memoryAutoSyncStats.failed += 1;
    }
  }

  _buildCommandBridgeMeta() {
    return {
      enabled: this.commandBridgeEnabled,
      tickMs: this.commandBridgeTickMs,
      maxTasks: this.commandBridgeMaxTasks,
      lastTickAt: this.commandBridgeLastTickAt,
      lastSyncAt: this.commandBridgeLastSyncAt,
      lastError: this.commandBridgeLastError,
      stats: { ...this.commandBridgeStats }
    };
  }

  async _syncCommandBridgeOnDemand(force = false) {
    if (!this.commandBridgeEnabled) return;
    if (this.commandBridgeTickRunning) return;

    const now = Date.now();
    const lastMs = Math.max(parseIsoMs(this.commandBridgeLastSyncAt), parseIsoMs(this.commandBridgeLastTickAt), 0);
    if (!force && lastMs > 0 && now - lastMs < this.commandBridgeTickMs) {
      return;
    }

    try {
      await this._commandBridgeTick();
    } catch (error) {
      this.commandBridgeLastError = pickText(error?.message, String(error));
      this.commandBridgeStats.failed += 1;
    }
  }

  async syncCommandBridgeNow(options = {}) {
    await this._syncCommandBridgeOnDemand(true);

    const source = pickText(options?.source, 'manual.button');
    await this.logService.append({
      action: 'squad.command_bridge.manual_sync',
      type: 'squad',
      target: 'command-bridge',
      status: 'success',
      message: `手动触发桥接同步：${source}`,
      meta: {
        source,
        bridge: this._buildCommandBridgeMeta()
      }
    });

    return this._buildCommandBridgeMeta();
  }

  _startCommandBridgeLoop() {
    if (!this.commandBridgeEnabled || this.commandBridgeTimer) return;

    this.commandBridgeTimer = setInterval(() => {
      this._commandBridgeTick().catch((error) => {
        this.commandBridgeLastError = pickText(error?.message, String(error));
        this.commandBridgeStats.failed += 1;
      });
    }, this.commandBridgeTickMs);

    if (typeof this.commandBridgeTimer.unref === 'function') {
      this.commandBridgeTimer.unref();
    }

    this._commandBridgeTick().catch((error) => {
      this.commandBridgeLastError = pickText(error?.message, String(error));
      this.commandBridgeStats.failed += 1;
    });
  }

  _mapLongTaskStatus(status) {
    const key = pickText(status).toLowerCase();
    if (key === 'completed') return 'completed';
    if (key === 'failed') return 'blocked';
    if (key === 'pending') return 'pending';
    if (key === 'running') return 'running';
    return 'running';
  }

  _buildLongTaskProgressNote(longTask = {}) {
    const status = pickText(longTask?.status, 'running');
    const currentStep = Math.max(1, Number(longTask?.currentStep) || 1);
    const steps = toArray(longTask?.steps);
    const currentName = pickText(steps[currentStep - 1]?.name, steps[0]?.name, '-');
    const progress = clamp(longTask?.progress, 0, 100);
    const summary = pickText(longTask?.goal, longTask?.title, longTask?.result?.summary, '-');
    return `桥接任务进展：状态=${status}｜步骤${currentStep}:${currentName}｜完成度${progress}%｜${summary}`;
  }

  _buildLongTaskFinalReport(longTask = {}, phaseSummary = '') {
    const title = pickText(longTask?.title, longTask?.goal, longTask?.id, '未命名任务');
    const result = longTask?.result && typeof longTask.result === 'object'
      ? JSON.stringify(longTask.result, null, 0)
      : pickText(longTask?.result, longTask?.goal, '任务已完成');
    return [
      `最终汇报｜${title}`,
      `来源：用户指令桥接`,
      `协作链路：${pickText(phaseSummary, '桥接同步')}`,
      `执行结论：${pickText(result, '任务已完成')}`
    ].join('\n');
  }

  async _readLongTasks() {
    try {
      const raw = await fs.readFile(LONG_TASKS_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      return toArray(parsed?.tasks);
    } catch {
      return [];
    }
  }

  async _commandBridgeTick() {
    if (!this.commandBridgeEnabled || this.commandBridgeTickRunning) return;
    this.commandBridgeTickRunning = true;
    this.commandBridgeLastTickAt = nowIso();
    this.commandBridgeStats.ticks += 1;

    try {
      const bridgeWindowMs = 48 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const longTasks = (await this._readLongTasks())
        .filter((task) => {
          const id = pickText(task?.id);
          if (!id.startsWith('lt_')) return false;
          const status = pickText(task?.status).toLowerCase();
          if (status === 'running' || status === 'pending' || status === 'failed') return true;
          const updatedMs = parseIsoMs(task?.updatedAt || task?.lastReportAt || task?.completedAt || task?.startedAt);
          return updatedMs >= nowMs - bridgeWindowMs;
        })
        .slice()
        .sort((a, b) => parseIsoMs(b?.updatedAt || b?.lastReportAt || b?.startedAt) - parseIsoMs(a?.updatedAt || a?.lastReportAt || a?.startedAt))
        .slice(0, this.commandBridgeMaxTasks);

      if (!longTasks.length) {
        this.commandBridgeLastError = '';
        return;
      }

      let currentTasks = toArray(await this.taskStore.read());
      const bridgePrimaryBySource = new Map(
        currentTasks
          .filter((task) => pickText(task?.dispatchSource).toLowerCase() === 'user.command.bridge' && pickText(task?.relationType, 'primary').toLowerCase() === 'primary')
          .map((task) => [pickText(task?.sourceTaskId), task])
      );

      let createdGroups = 0;
      for (const longTask of longTasks) {
        const longId = pickText(longTask?.id);
        if (!longId || bridgePrimaryBySource.has(longId)) continue;

        const created = await this.createTask({
          title: `指令任务桥接｜${pickText(longTask?.title, longTask?.goal, longId)}`,
          description: pickText(longTask?.goal, longTask?.title, '桥接自用户指令任务'),
          roleId: AUTO_ROLE_ID,
          weight: 2,
          source: 'user.command.bridge',
          sourceTaskId: longId
        });

        if (created?.task) {
          bridgePrimaryBySource.set(longId, created.task);
          createdGroups += 1;
        }
      }

      if (createdGroups > 0) {
        this.commandBridgeStats.createdGroups += createdGroups;
        currentTasks = toArray(await this.taskStore.read());
      }

      const longTaskMap = new Map(longTasks.map((task) => [pickText(task?.id), task]));
      const primaryByGroup = new Map(
        currentTasks
          .filter((task) => pickText(task?.dispatchSource).toLowerCase() === 'user.command.bridge' && pickText(task?.relationType, 'primary').toLowerCase() === 'primary')
          .map((task) => [pickText(task?.taskGroupId), pickText(task?.sourceTaskId)])
      );

      let touched = 0;
      const nowText = nowIso();

      await this.taskStore.update((rows) => {
        return toArray(rows).map((task) => {
          const dispatchSource = pickText(task?.dispatchSource).toLowerCase();
          const relation = pickText(task?.relationType, 'primary').toLowerCase();
          const isBridgePrimary = dispatchSource === 'user.command.bridge' && relation === 'primary';
          const bridgeLongId = isBridgePrimary
            ? pickText(task?.sourceTaskId)
            : pickText(primaryByGroup.get(pickText(task?.taskGroupId)));

          if (!bridgeLongId) return task;

          const longTask = longTaskMap.get(bridgeLongId);
          if (!longTask) return task;

          const mappedStatus = this._mapLongTaskStatus(longTask?.status);
          const progress = clamp(longTask?.progress, 0, 100);
          const note = this._buildLongTaskProgressNote(longTask);

          const terminalHeartbeat = pickText(longTask?.updatedAt, longTask?.lastReportAt, longTask?.completedAt, task?.lastHeartbeatAt, nowText);
          const next = {
            ...task,
            dispatchSource: isBridgePrimary ? 'user.command.bridge' : 'derived.linked.bridge',
            progressPercent: progress,
            progressNote: note,
            lastHeartbeatAt: mappedStatus === 'completed' ? terminalHeartbeat : nowText,
            updatedAt: mappedStatus === 'completed' ? terminalHeartbeat : nowText,
            stalledReason: mappedStatus === 'blocked' ? pickText(longTask?.errors?.[0]?.message, longTask?.errors?.[0], '桥接任务执行失败') : ''
          };

          if (mappedStatus === 'completed') {
            next.status = 'completed';
            next.passed = true;
            next.completion = Math.max(Number(next.completion) || 0, progress || 100);
            next.quality = Math.max(Number(next.quality) || 0, 85);
            next.gradedAt = pickText(next.gradedAt, nowText);
            if (isBridgePrimary) {
              const phaseSummary = `侦察:完成｜实现:完成｜验证/文档:完成`;
              next.finalReportStatus = 'success';
              next.finalReportAt = nowText;
              next.finalReport = this._buildLongTaskFinalReport(longTask, phaseSummary);
              next.finalReportAttempts = Math.max(1, Number(next.finalReportAttempts) || 1);
              next.finalReportError = '';
              next.finalReportMissingPhases = [];
              next.finalReportChainReady = true;
            }
          } else if (mappedStatus === 'blocked') {
            next.status = 'blocked';
            next.stalledAt = nowText;
            if (isBridgePrimary) {
              next.finalReportStatus = 'unavailable';
              next.finalReportAt = '';
              next.finalReport = '';
              next.finalReportAttempts = FINAL_REPORT_MAX_RETRY;
              next.finalReportError = pickText(longTask?.errors?.[0]?.message, longTask?.errors?.[0], '桥接任务失败');
              next.finalReportMissingPhases = [];
              next.finalReportChainReady = false;
            }
          } else {
            next.status = mappedStatus;
            if (isBridgePrimary && pickText(next.finalReportStatus).toLowerCase() !== 'success') {
              next.finalReportStatus = 'pending';
              next.finalReportAt = '';
              next.finalReport = '';
            }
          }

          touched += 1;
          return next;
        });
      });

      if (touched > 0 || createdGroups > 0) {
        this.commandBridgeStats.syncedTasks += touched;
        this.commandBridgeLastSyncAt = nowText;
        this.commandBridgeLastError = '';
        this._invalidateReportingCache();

        await this.logService.append({
          action: 'squad.command_bridge.sync',
          type: 'squad',
          target: 'command-bridge',
          status: 'success',
          message: `桥接同步完成：新增分组 ${createdGroups}，更新任务 ${touched}`,
          meta: {
            createdGroups,
            touched,
            candidateLongTasks: longTasks.length,
            tickAt: nowText
          }
        });
      }
    } catch (error) {
      this.commandBridgeLastError = pickText(error?.message, String(error));
      this.commandBridgeStats.failed += 1;
      throw error;
    } finally {
      this.commandBridgeTickRunning = false;
    }
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
            next.runtimeRisk = '';
            next.riskReason = '';
            next.blockedPenaltyApplied = false;
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
          next.runtimeRisk = '';
          next.riskReason = '';

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
      this._invalidateReportingCache();
    } finally {
      this.executorTickRunning = false;
    }
  }

  async _normalizeTaskRuntime() {
    const nowMs = Date.now();
    const nowText = nowIso();
    const newlyBlocked = [];

    const updatedTasks = await this.taskStore.update((rows) => {
      return toArray(rows).map((task) => {
        if (!task || typeof task !== 'object') return task;

        const next = { ...task };
        const status = pickText(next.status).toLowerCase();

        if (!status || status === 'pending') {
          next.status = 'running';
        }

        let normalized = pickText(next.status).toLowerCase();
        if (!TASK_OPEN_STATUSES.has(normalized)) {
          if (TASK_TERMINAL_STATUSES.has(normalized)) {
            next.progressPercent = 100;
          }
          return next;
        }

        next.startedAt = pickText(next.startedAt, next.createdAt, nowText);
        next.lastHeartbeatAt = pickText(next.lastHeartbeatAt, next.startedAt, next.createdAt, nowText);

        const hbMs = Date.parse(next.lastHeartbeatAt);
        const silenceMs = Number.isFinite(hbMs) ? nowMs - hbMs : 0;
        const isStale = Number.isFinite(hbMs) && silenceMs > TASK_RUNNING_STALE_MS;

        if (!isStale && silenceMs > BLOCK_AT_RISK_MS && pickText(next.status).toLowerCase() !== 'blocked') {
          next.runtimeRisk = 'at-risk';
          next.riskReason = '心跳静默超过4分钟，接近阻塞阈值';
        } else if (pickText(next.runtimeRisk).toLowerCase() === 'at-risk') {
          next.runtimeRisk = '';
          next.riskReason = '';
        }

        if (isStale) {
          const wasBlocked = normalized === 'blocked';

          next.status = 'blocked';
          next.runtimeRisk = 'blocked';
          next.riskReason = '任务已进入阻塞态';
          next.stalledAt = pickText(next.stalledAt, nowText);
          next.stalledReason = pickText(
            next.stalledReason,
            '超过8分钟无进展心跳，状态已标记为 blocked，请跟进或重派。'
          );

          if (!wasBlocked) {
            next.blockedCount = Math.max(0, Number(next.blockedCount) || 0) + 1;
            next.lastBlockedAt = nowText;
            next.blockedPenaltyApplied = false;
          }

          if (!next.blockedPenaltyApplied) {
            next.blockedPenaltyApplied = true;
            newlyBlocked.push({
              id: pickText(next.id),
              roleId: pickText(next.roleId),
              roleName: pickText(next.roleName),
              title: pickText(next.title),
              relationType: pickText(next.relationType),
              weight: clamp(next.weight, 1, 3),
              blockedCount: Math.max(1, Number(next.blockedCount) || 1),
              lastBlockedAt: pickText(next.lastBlockedAt, next.stalledAt)
            });
          }
        }

        if (pickText(next.status).toLowerCase() === 'blocked' && !pickText(next.blockedReasonCode)) {
          next.blockedReasonCode = 'heartbeat_timeout';
          next.blockedRootCause = pickText(next.blockedRootCause, '任务在执行窗口内未上报有效心跳');
          next.recoveryHint = pickText(next.recoveryHint, '建议缩短心跳间隔并补充进展备注，避免信息黑盒。');
        }

        const progress = clamp(next.progressPercent, 0, 99);
        next.progressPercent = next.status === 'blocked' ? progress : Math.max(progress, 5);
        return next;
      });
    });

    this._invalidateReportingCache();
    if (!newlyBlocked.length) return;

    const roleOpenLoadMap = buildRoleOpenLoadMap(updatedTasks);
    const blockedDiagnostics = newlyBlocked.map((task) => {
      const roleOpenLoad = roleOpenLoadMap.get(task.roleId) || 0;
      const diagnosis = inferBlockedCause(task, roleOpenLoad);
      const recentBlockedCount = recentBlockedCountForRole(updatedTasks, task.roleId, nowMs);
      const multiplier = blockedPenaltyMultiplier(recentBlockedCount);
      const penalty = Math.round(blockedPenaltyByWeight(task.weight) * multiplier);
      return {
        ...task,
        roleOpenLoad,
        recentBlockedCount,
        multiplier,
        penalty,
        reasonCode: diagnosis.code,
        rootCause: diagnosis.cause,
        coaching: diagnosis.coaching
      };
    });

    await this.taskStore.update((rows) => {
      const list = toArray(rows);
      const diagMap = new Map(blockedDiagnostics.map((row) => [row.id, row]));
      return list.map((task) => {
        const diag = diagMap.get(task?.id);
        if (!diag) return task;
        return {
          ...task,
          blockedReasonCode: diag.reasonCode,
          blockedRootCause: diag.rootCause,
          recoveryHint: diag.coaching
        };
      });
    });

    const rolePenaltyMap = new Map();
    for (const task of blockedDiagnostics) {
      if (!task.roleId) continue;

      const current = rolePenaltyMap.get(task.roleId) || {
        delta: 0,
        failures: 0,
        roleName: task.roleName,
        recentBlockedCount: task.recentBlockedCount,
        multiplier: task.multiplier,
        reasons: {},
        coachingHints: []
      };

      current.delta += task.penalty;
      current.failures += 1;
      current.recentBlockedCount = Math.max(current.recentBlockedCount || 0, task.recentBlockedCount);
      current.multiplier = Math.max(current.multiplier || 1, task.multiplier);
      current.delta = Math.max(current.delta, -MAX_BLOCKED_PENALTY_PER_SWEEP);
      current.reasons[task.reasonCode] = (current.reasons[task.reasonCode] || 0) + 1;
      if (task.coaching && !current.coachingHints.includes(task.coaching)) {
        current.coachingHints.push(task.coaching);
      }
      rolePenaltyMap.set(task.roleId, current);
    }

    await this.roleStore.update((rows) => {
      return toArray(rows).map((role) => {
        const patch = rolePenaltyMap.get(role?.id);
        if (!patch) return role;

        const nextScore = clamp((Number(role?.score) || BASE_SCORE) + patch.delta, 0, MAX_SCORE);
        const nextFailureEvents = (Number(role?.failureEvents) || Number(role?.failedTasks) || 0) + patch.failures;
        const nextStatus = nextScore < WARNING_SCORE || patch.failures > 0 ? 'warning' : 'active';

        const previousCauseStats =
          role?.blockCauseStats && typeof role.blockCauseStats === 'object' ? role.blockCauseStats : {};
        const mergedCauseStats = { ...previousCauseStats };
        for (const [code, count] of Object.entries(patch.reasons || {})) {
          mergedCauseStats[code] = (Number(mergedCauseStats[code]) || 0) + Number(count || 0);
        }

        const coachingText = patch.coachingHints?.length
          ? `改进行动：${patch.coachingHints.join('；')}`
          : '改进行动：缩短心跳周期，保持可观测进展。';

        return {
          ...role,
          score: nextScore,
          status: nextStatus,
          failedTasks: nextFailureEvents,
          failureEvents: nextFailureEvents,
          blockedPressure24h: patch.recentBlockedCount,
          blockedPenaltyMultiplier: patch.multiplier,
          rewardStreak: 0,
          bestRewardStreak: Math.max(0, Number(role?.bestRewardStreak) || 0),
          rewardPoints: Math.max(0, Number(role?.rewardPoints) || 0),
          capabilityIndex: clamp(numberOr(role?.capabilityIndex, 100) - Math.max(1, patch.failures), 0, 100),
          growthFocus: coachingText,
          blockCauseStats: mergedCauseStats,
          warningCount: (Number(role?.warningCount) || 0) + (nextStatus === 'warning' ? 1 : 0),
          reflection: pickText(role?.reflection, '出现阻塞任务，需复盘根因并提交改进措施。'),
          updatedAt: nowIso()
        };
      });
    });

    for (const task of blockedDiagnostics) {
      await this.logService.append({
        action: 'squad.task.blocked',
        type: 'squad',
        target: task.roleId,
        status: 'failed',
        message: `${task.roleName || task.roleId} 任务阻塞：${task.title || task.id}`,
        meta: {
          taskId: task.id,
          penalty: task.penalty,
          multiplier: task.multiplier,
          recentBlockedCount: task.recentBlockedCount,
          blockedCount: task.blockedCount,
          blockedAt: task.lastBlockedAt,
          reason: task.reasonCode,
          reasonLabel: CAUSE_LABELS[task.reasonCode] || task.reasonCode,
          rootCause: task.rootCause,
          coaching: task.coaching,
          roleOpenLoad: task.roleOpenLoad
        }
      });
    }
  }

  async _reconcileTaskLiveness() {
    await this._normalizeTaskRuntime();
  }

  async getState() {
    await this._syncCommandBridgeOnDemand();
    await this._reconcileTaskLiveness();
    const [roles, tasks] = await Promise.all([this.roleStore.read(), this.taskStore.read()]);
    const roleRows = toArray(roles);
    const taskRows = toArray(tasks);

    const nowMs = Date.now();
    const computedRoles = roleRows.map((role) => {
      const roleTasks = taskRows.filter((task) => task && task.roleId === role.id);
      const doneTasks = roleTasks.filter((task) => task.status === 'completed');
      const failedTasks = roleTasks.filter((task) => task.status === 'failed');
      const blockedTasks = roleTasks.filter((task) => task.status === 'blocked');
      const atRiskTasks = roleTasks.filter((task) => pickText(task.runtimeRisk).toLowerCase() === 'at-risk');
      const pendingTasks = roleTasks.filter((task) => TASK_OPEN_STATUSES.has(pickText(task.status).toLowerCase()));
      const unresolvedFailures = failedTasks.length + blockedTasks.length;
      const recentBlockedCount = recentBlockedCountForRole(taskRows, role.id, nowMs);
      const pressureMultiplier = blockedPenaltyMultiplier(recentBlockedCount);
      const failureEvents = Math.max(
        Number(role?.failureEvents) || 0,
        Number(role?.failedTasks) || 0,
        unresolvedFailures
      );
      const status = unresolvedFailures > 0 || Number(role?.score || 0) < WARNING_SCORE ? 'warning' : 'active';
      const causeStats = role?.blockCauseStats && typeof role.blockCauseStats === 'object' ? role.blockCauseStats : {};
      const topCause = Object.entries(causeStats)
        .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0]?.[0] || '';

      return {
        ...role,
        status,
        totalTasks: roleTasks.length,
        doneTasks: doneTasks.length,
        failedTasks: unresolvedFailures,
        failureEvents,
        blockedTasks: blockedTasks.length,
        atRiskTasks: atRiskTasks.length,
        blockedPressure24h: recentBlockedCount,
        blockedPenaltyMultiplier: pressureMultiplier,
        topBlockCause: topCause,
        pendingTasks: pendingTasks.length,
        avgCompletion: Math.round(avg(roleTasks.map((task) => Number(task.completion) || 0))),
        avgQuality: Math.round(avg(roleTasks.map((task) => Number(task.quality) || 0))),
        capabilityIndex: clamp(numberOr(role?.capabilityIndex, numberOr(role?.score, 100)), 0, 100),
        growthFocus: pickText(role?.growthFocus, '保持高频心跳与高质量交付'),
        blockCauseStats: causeStats
      };
    });

    const sortedRoles = computedRoles
      .slice()
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

    const warningRoles = sortedRoles.filter((r) => pickText(r.status, '').toLowerCase() === 'warning');
    const syntheticTasks = taskRows.filter((task) => isSyntheticSmokeTask(task));
    const staleBridgeTasks = taskRows.filter((task) => {
      if (!isBridgeTaskRow(task)) return false;
      const status = pickText(task?.status).toLowerCase();
      if (!TASK_TERMINAL_STATUSES.has(status)) return false;
      return taskRecencyMs(task) < nowMs - SQUAD_COMMAND_BRIDGE_SHOW_WINDOW_MS;
    });
    const visibleTaskRows = taskRows.filter((task) => {
      if (isSyntheticSmokeTask(task)) return false;
      if (staleBridgeTasks.includes(task)) return false;
      return true;
    });

    const summary = {
      totalRoles: sortedRoles.length,
      avgScore: Math.round(avg(sortedRoles.map((r) => Number(r.score) || 0))),
      warningRoles: warningRoles.length,
      totalTasks: visibleTaskRows.length,
      completedTasks: visibleTaskRows.filter((t) => t.status === 'completed').length,
      failedTasks: visibleTaskRows.filter((t) => t.status === 'failed' || t.status === 'blocked').length,
      blockedTasks: visibleTaskRows.filter((t) => t.status === 'blocked').length,
      atRiskTasks: visibleTaskRows.filter((t) => pickText(t.runtimeRisk).toLowerCase() === 'at-risk').length,
      pendingTasks: visibleTaskRows.filter((t) => TASK_OPEN_STATUSES.has(pickText(t.status).toLowerCase())).length,
      hiddenSyntheticTasks: syntheticTasks.length,
      hiddenStaleBridgeTasks: staleBridgeTasks.length
    };

    const executor = {
      enabled: this.executorEnabled,
      tickMs: this.executorTickMs,
      lastTickAt: this.executorLastTickAt,
      lastError: this.executorLastError,
      stats: { ...this.executorStats }
    };
    const causeLabels = { ...CAUSE_LABELS };
    const reporting = await this._buildReportingSnapshot({
      roles: sortedRoles,
      tasks: visibleTaskRows,
      summary,
      executor,
      causeLabels
    });

    const groupRosterMap = buildTaskGroupRosterMap(visibleTaskRows);
    const boardTasks = visibleTaskRows
      .slice()
       .sort((a, b) => taskRecencyMs(b) - taskRecencyMs(a))
      .slice(0, SQUAD_STATE_TASK_MAX)
      .map((task) => {
        const sourceTaskId = pickText(task?.sourceTaskId, task?.parentTaskId);
        return {
          ...task,
          displayTitle: taskDisplayTitle(task),
          sourceLabel: taskSourceLabel(task),
          sourceTaskId,
          roleAction: taskRoleAction(task),
          collaborationRoster: pickText(groupRosterMap.get(pickText(task?.taskGroupId))),
          parallelRoleCount: Math.max(1, Number(task?.parallelRoleCount) || toArray(task?.parallelRoleIds).length || 1),
          parallelRoleIds: Array.from(new Set(toArray(task?.parallelRoleIds).map((id) => pickText(id)).filter(Boolean))),
          coordinationMode: pickText(task?.coordinationMode, 'parallel')
        };
      });

    return {
      roles: sortedRoles,
      tasks: boardTasks,
      summary,
      executor,
      causeLabels,
      reporting,
      memorySync: this._buildMemorySyncMeta(),
      commandBridge: this._buildCommandBridgeMeta(),
      captainDirective: CAPTAIN_DISPATCH_DOCTRINE,
      warningRoles: warningRoles.map((row) => ({
        id: row.id,
        name: row.name,
        score: row.score,
        reflection: row.reflection
      }))
    };
  }

  async syncReportingMemory(options = {}) {
    const source = pickText(options?.source, 'manual');
    const force = options?.force === true;
    const dryRun = options?.dryRun === true;
    const suppressLog = options?.suppressLog === true;
    const maxItems = clamp(options?.maxItems ?? options?.limit ?? SQUAD_MEMORY_SYNC_MAX_ITEMS, 2, 12);

    if (this.memorySyncInFlight && source.startsWith('auto.')) {
      return {
        syncedAt: nowIso(),
        source,
        dryRun,
        dedupHit: true,
        force,
        fingerprint: pickText(this.memorySyncCache?.fingerprint).slice(0, 12),
        reporting: {
          engine: '',
          generatedAt: '',
          liveBrief: '',
          alerts: [],
          memoryTips: []
        },
        dailyMemoryPath: '',
        blockedArchivePath: '',
        wrote: {
          daily: 0,
          blocked: 0
        }
      };
    }

    this.memorySyncInFlight = true;

    try {
      const state = await this.getState();
      const reporting = normalizeReportingPayload(state?.reporting || {});
      const blockedTasks = toArray(state?.tasks)
        .filter((task) => pickText(task?.status).toLowerCase() === 'blocked')
        .slice(0, maxItems);

      const fingerprint = makeMemorySyncFingerprint({ reporting, blockedTasks });
      const dedupHit = !force && this.memorySyncCache?.fingerprint === fingerprint;

      const now = new Date();
      const dayKey = toCstDateKey(now);
      const nowText = nowIso();
      const dailyPath = path.join(MEMORY_DIR, `${dayKey}.md`);
      const blockedArchivePath = path.join(SQUAD_BLOCKED_ARCHIVE_DIR, `${dayKey}.md`);

      const clippedReporting = {
        ...reporting,
        alerts: toArray(reporting?.alerts).slice(0, maxItems),
        memoryTips: toArray(reporting?.memoryTips).slice(0, maxItems),
        memoryDigest: {
          dailyBullets: toArray(reporting?.memoryDigest?.dailyBullets).slice(0, maxItems),
          blockedBullets: toArray(reporting?.memoryDigest?.blockedBullets).slice(0, Math.max(1, Math.floor(maxItems / 2)))
        }
      };

      const dailySection = buildDailyMemorySection({
        reporting: clippedReporting,
        blockedTasks,
        nowText,
        source
      });
      const blockedSection = buildBlockedArchiveSection({
        blockedTasks,
        causeLabels: state?.causeLabels,
        nowText
      });

      if (!dedupHit && !dryRun) {
        await fs.mkdir(MEMORY_DIR, { recursive: true });
        await fs.appendFile(dailyPath, dailySection, 'utf8');

        if (blockedSection) {
          await fs.mkdir(path.dirname(blockedArchivePath), { recursive: true });
          await fs.appendFile(blockedArchivePath, blockedSection, 'utf8');
        }
      }

      if (!dedupHit) {
        this.memorySyncCache = {
          atMs: Date.now(),
          fingerprint
        };
      }

      const result = {
        syncedAt: nowText,
        source,
        dryRun,
        dedupHit,
        force,
        fingerprint: fingerprint.slice(0, 12),
        reporting: {
          engine: clippedReporting?.engine,
          generatedAt: clippedReporting?.generatedAt,
          liveBrief: clippedReporting?.liveBrief,
          alerts: toArray(clippedReporting?.alerts),
          memoryTips: toArray(clippedReporting?.memoryTips)
        },
        dailyMemoryPath: `${dayKey}.md`,
        blockedArchivePath: blockedSection ? toRelativeMemoryPath(blockedArchivePath) : '',
        wrote: {
          daily: dedupHit || dryRun ? 0 : dailySection.split('\n').filter(Boolean).length,
          blocked: dedupHit || dryRun || !blockedSection ? 0 : blockedTasks.length
        }
      };

      this.memoryAutoSyncLastSyncAt = result.syncedAt;
      this.memoryAutoSyncLastSource = source;
      this.memoryAutoSyncLastResult = dedupHit ? 'skipped' : 'synced';
      this.memoryAutoSyncLastError = '';

      if (!(suppressLog && dedupHit)) {
        await this.logService.append({
          action: 'squad.reporting.sync_memory',
          type: 'squad',
          target: source,
          status: dedupHit ? 'skipped' : 'success',
          message: dedupHit
            ? `记忆同步去重命中（${formatCstClock(now)}）`
            : `记忆同步完成（${formatCstClock(now)}）`,
          meta: {
            source,
            dryRun,
            dedupHit,
            force,
            fingerprint: fingerprint.slice(0, 12),
            blockedCount: blockedTasks.length,
            engine: clippedReporting?.engine
          }
        });
      }

      return result;
    } finally {
      this.memorySyncInFlight = false;
    }
  }

  async _probeAgentCallable() {
    if (!this.openclawService) {
      return {
        callable: true,
        serviceState: 'unknown',
        gatewayState: 'unknown',
        reason: 'openclaw-service-not-bound'
      };
    }

    try {
      const [serviceStatus, gatewayStatus] = await Promise.all([
        this.openclawService.getServiceStatus?.().catch(() => null),
        this.openclawService.getGatewayStatus?.().catch(() => null)
      ]);

      const serviceState = pickText(serviceStatus?.friendlyState?.stateCode, serviceStatus?.detail?.activeState, 'unknown').toLowerCase();
      const gatewayState = pickText(gatewayStatus?.stateCode, 'unknown').toLowerCase();
      const serviceOk = ['running', 'active', 'ok', 'unknown'].includes(serviceState);
      const gatewayOk = ['running', 'active', 'ok', 'unknown'].includes(gatewayState);

      return {
        callable: serviceOk && gatewayOk,
        serviceState,
        gatewayState,
        reason: serviceOk && gatewayOk ? 'ok' : `service=${serviceState}, gateway=${gatewayState}`
      };
    } catch (error) {
      return {
        callable: false,
        serviceState: 'error',
        gatewayState: 'error',
        reason: pickText(error?.message, String(error))
      };
    }
  }

  async _persistPrimaryFinalReport(primaryTaskId, patch = {}) {
    let updated = null;
    await this.taskStore.update((rows) => {
      const list = toArray(rows);
      const idx = list.findIndex((task) => task && task.id === primaryTaskId);
      if (idx < 0) return list;
      updated = {
        ...list[idx],
        ...patch
      };
      list[idx] = updated;
      return list;
    });
    return updated;
  }

  async _maybeFinalizeGroupReportByTaskId(taskId, options = {}) {
    const id = pickText(taskId);
    if (!id) return { status: 'skip', reason: 'missing-task-id' };

    const source = pickText(options?.source, 'review');
    const force = options?.force === true;

    const taskRows = toArray(await this.taskStore.read());
    const triggerTask = taskRows.find((task) => task && task.id === id);
    if (!triggerTask) return { status: 'skip', reason: 'task-not-found' };

    const taskGroupId = pickText(triggerTask?.taskGroupId);
    if (!taskGroupId) return { status: 'skip', reason: 'task-group-missing' };

    const groupTasks = taskRows.filter((task) => pickText(task?.taskGroupId) === taskGroupId);
    const primaryTask = resolvePrimaryTaskInGroup(groupTasks, triggerTask);
    if (!primaryTask) return { status: 'skip', reason: 'primary-not-found' };

    const primaryStatus = pickText(primaryTask?.status).toLowerCase();
    if (primaryStatus !== 'completed') {
      return {
        status: 'blocked',
        reason: `primary-status-${primaryStatus || 'unknown'}`,
        taskId: primaryTask.id,
        taskGroupId
      };
    }

    if (!force && pickText(primaryTask?.finalReportStatus).toLowerCase() === 'success') {
      return { status: 'skip', reason: 'already-reported' };
    }

    const phaseRows = summarizeChainPhases(groupTasks);
    const missing = phaseRows.filter((row) => !row.ready).map((row) => row.label);

    if (missing.length > 0) {
      const blockedReason = `协作链路未完成：缺少 ${missing.join('、')}`;
      await this._persistPrimaryFinalReport(primaryTask.id, {
        finalReportStatus: 'blocked',
        finalReportAt: '',
        finalReport: '',
        finalReportAttempts: 0,
        finalReportError: blockedReason,
        finalReportMissingPhases: missing,
        finalReportChainReady: false,
        updatedAt: nowIso()
      });

      await this.logService.append({
        action: 'squad.final_report.blocked',
        type: 'squad',
        target: primaryTask.roleId,
        status: 'failed',
        message: `最终汇报阻塞：${blockedReason}`,
        meta: {
          taskId: primaryTask.id,
          taskGroupId,
          source,
          missingPhases: missing
        }
      });

      return {
        status: 'blocked',
        taskId: primaryTask.id,
        taskGroupId,
        missingPhases: missing,
        chainSummary: renderChainSummary(phaseRows)
      };
    }

    const probeLogs = [];
    let callable = false;
    let callableProbe = null;

    for (let attempt = 1; attempt <= FINAL_REPORT_MAX_RETRY; attempt += 1) {
      const probe = await this._probeAgentCallable();
      callableProbe = probe;
      probeLogs.push({ attempt, ...probe });
      if (probe.callable) {
        callable = true;
        break;
      }

      await this.logService.append({
        action: 'squad.final_report.retry',
        type: 'squad',
        target: primaryTask.roleId,
        status: 'failed',
        message: `最终汇报第 ${attempt} 次重试：AI agent 当前不可用`,
        meta: {
          taskId: primaryTask.id,
          taskGroupId,
          source,
          attempt,
          reason: pickText(probe.reason),
          serviceState: pickText(probe.serviceState),
          gatewayState: pickText(probe.gatewayState)
        }
      });

      if (attempt < FINAL_REPORT_MAX_RETRY) {
        await sleep(FINAL_REPORT_RETRY_DELAY_MS * attempt);
      }
    }

    if (!callable) {
      const errMessage = `AI agent 不可用，已重试 ${FINAL_REPORT_MAX_RETRY} 次：${pickText(callableProbe?.reason, 'unknown')}`;
      await this._persistPrimaryFinalReport(primaryTask.id, {
        finalReportStatus: 'unavailable',
        finalReportAt: '',
        finalReport: '',
        finalReportAttempts: probeLogs.length,
        finalReportError: errMessage,
        finalReportMissingPhases: [],
        finalReportChainReady: true,
        updatedAt: nowIso()
      });

      await this.logService.append({
        action: 'squad.final_report.unavailable',
        type: 'squad',
        target: primaryTask.roleId,
        status: 'failed',
        message: errMessage,
        meta: {
          taskId: primaryTask.id,
          taskGroupId,
          source,
          retries: probeLogs
        }
      });

      return {
        status: 'unavailable',
        taskId: primaryTask.id,
        taskGroupId,
        attempts: probeLogs.length,
        error: errMessage,
        chainSummary: renderChainSummary(phaseRows)
      };
    }

    const finalReport = buildFinalReportText({
      primaryTask,
      groupTasks,
      phaseRows
    });

    const reportTs = nowIso();
    await this._persistPrimaryFinalReport(primaryTask.id, {
      finalReportStatus: 'success',
      finalReportAt: reportTs,
      finalReport,
      finalReportAttempts: probeLogs.length,
      finalReportError: '',
      finalReportMissingPhases: [],
      finalReportChainReady: true,
      updatedAt: reportTs
    });

    await this.logService.append({
      action: 'squad.final_report.success',
      type: 'squad',
      target: primaryTask.roleId,
      status: 'success',
      message: `最终汇报已产出：${pickText(primaryTask.title, primaryTask.id)}`,
      meta: {
        taskId: primaryTask.id,
        taskGroupId,
        source,
        attempts: probeLogs.length,
        chainSummary: renderChainSummary(phaseRows),
        finalReport
      }
    });

    return {
      status: 'success',
      taskId: primaryTask.id,
      taskGroupId,
      attempts: probeLogs.length,
      finalReport,
      finalReportAt: reportTs,
      chainSummary: renderChainSummary(phaseRows)
    };
  }

  async retryFinalReport(taskId, options = {}) {
    const id = pickText(taskId);
    if (!id) throw new HttpError(400, 'SQUAD_TASK_ID_REQUIRED', 'taskId 不能为空');

    return this._maybeFinalizeGroupReportByTaskId(id, {
      force: true,
      source: pickText(options?.source, 'manual.retry')
    });
  }

  async createTask(input = {}) {
    const title = pickText(input.title);
    const requestedRoleId = pickText(input.roleId);
    const description = pickText(input.description);
    const weight = clamp(input.weight, 1, 3);
    const source = pickText(input.source, 'user.primary');
    const sourceTaskId = pickText(input.sourceTaskId);

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
    const targetParallelRoles = decideParallelRoleCount({ title, description, weight, source });
    const parallelPlan = buildParallelRoleIds({
      primaryRoleId: role.id,
      preferredRoleIds: assignment.collaborationRoleIds,
      allRoles: roleRows,
      targetTotalRoles: targetParallelRoles
    });

    const task = buildTaskRow({
      title,
      description,
      role,
      weight,
      assignmentMode: assignment.assignmentMode,
      assignmentReason: `${assignment.assignmentReason} ｜ 并行协作=${parallelPlan.parallelRoleIds.length}角色 ｜ ${CAPTAIN_DISPATCH_DOCTRINE}`,
      taskGroupId,
      relationType: 'primary',
      dispatchSource: source,
      sourceTaskId,
      parallelRoleIds: parallelPlan.parallelRoleIds,
      parallelRoleCount: parallelPlan.parallelRoleIds.length,
      coordinationMode: 'parallel'
    });

    const linkedTasks = parallelPlan.linkedRoleIds
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
          relationType: 'linked',
          dispatchSource: source.includes('system.smoke')
            ? 'system.smoke.linked'
            : source.startsWith('user.command.bridge')
              ? 'derived.linked.bridge'
              : 'derived.linked',
          sourceTaskId: task.id,
          parallelRoleIds: parallelPlan.parallelRoleIds,
          parallelRoleCount: parallelPlan.parallelRoleIds.length,
          coordinationMode: 'parallel'
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

    this._invalidateReportingCache();
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
        runtimeRisk: '',
        riskReason: '',
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
    const blockedCount = Math.max(0, Number(updatedTask.blockedCount) || 0);

    let baseDelta = ((completion - 75) * 0.08 + (judgeQuality - 75) * 0.12) * weight;
    baseDelta += passed ? 1 : -8 * weight;
    baseDelta = Math.round(clamp(baseDelta, -24, 18));

    const rewardDecision = computeRewardDecision({
      passed,
      completion,
      judgeQuality,
      blockedCount,
      streakBefore: Number(role?.rewardStreak) || 0
    });

    const rewardBonus = Math.max(0, Number(rewardDecision.bonus) || 0);
    const delta = Math.round(clamp(baseDelta + rewardBonus, -24, 24));

    updatedTask.scoreDeltaBase = baseDelta;
    updatedTask.rewardBonus = rewardBonus;
    updatedTask.rewardReason = pickText(rewardDecision.reason);
    updatedTask.scoreDelta = delta;

    await this.taskStore.update((rows) => {
      const list = toArray(rows);
      const idx = list.findIndex((t) => t && t.id === updatedTask.id);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          scoreDeltaBase: baseDelta,
          rewardBonus,
          rewardReason: pickText(rewardDecision.reason),
          scoreDelta: delta
        };
      }
      return list;
    });

    const roleTasks = taskRows.filter((t) => t && t.roleId === role.id);
    const doneTasks = roleTasks.filter((t) => t.status === 'completed');
    const failedTasks = roleTasks.filter((t) => t.status === 'failed');
    const blockedTasks = roleTasks.filter((t) => t.status === 'blocked');
    const unresolvedFailures = failedTasks.length + blockedTasks.length;
    const score = clamp((Number(role.score) || BASE_SCORE) + delta, 0, MAX_SCORE);
    const status = score < WARNING_SCORE || unresolvedFailures > 0 ? 'warning' : 'active';

    const nextRewardStreak = passed ? rewardDecision.nextStreak : 0;
    const nextBestRewardStreak = Math.max(Number(role.bestRewardStreak) || 0, nextRewardStreak);
    const nextRewardPoints = Math.max(0, Number(role.rewardPoints) || 0) + rewardBonus;
    const capabilityGain = rewardBonus > 0 ? Math.min(3, rewardBonus) : passed ? 1 : 0;
    const nextCapabilityIndex = clamp(numberOr(role?.capabilityIndex, 100) + capabilityGain, 0, 100);
    const nextGrowthFocus =
      rewardBonus > 0
        ? `保持连胜节奏：${pickText(rewardDecision.reason)}`
        : passed
          ? '继续保持稳定心跳与交付质量，冲击高质量奖励阈值。'
          : pickText(role.growthFocus, '失败后请先拆分任务并补齐过程心跳。');

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
      failedTasks: unresolvedFailures,
      failureEvents: Math.max(
        Number(role.failureEvents) || Number(role.failedTasks) || 0,
        unresolvedFailures
      ),
      blockedTasks: blockedTasks.length,
      rewardStreak: nextRewardStreak,
      bestRewardStreak: nextBestRewardStreak,
      rewardPoints: nextRewardPoints,
      lastRewardAt: rewardBonus > 0 ? nowIso() : pickText(role.lastRewardAt),
      capabilityIndex: nextCapabilityIndex,
      growthFocus: nextGrowthFocus,
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
      message: `${role.name} 任务评分更新：${delta >= 0 ? '+' : ''}${delta}（基础 ${baseDelta >= 0 ? '+' : ''}${baseDelta}，奖励 +${rewardBonus}，当前 ${score}）`,
      meta: {
        taskId: updatedTask.id,
        score,
        delta,
        baseDelta,
        rewardBonus,
        rewardReason: pickText(rewardDecision.reason),
        rewardStreak: patchedRole.rewardStreak,
        rewardPoints: patchedRole.rewardPoints,
        capabilityIndex: patchedRole.capabilityIndex,
        growthFocus: patchedRole.growthFocus
      }
    });

    const finalReport = await this._maybeFinalizeGroupReportByTaskId(updatedTask.id, {
      source: 'review'
    });

    this._invalidateReportingCache();
    return {
      task: {
        ...updatedTask,
        scoreDeltaBase: baseDelta,
        rewardBonus,
        rewardReason: pickText(rewardDecision.reason),
        scoreDelta: delta
      },
      role: patchedRole,
      finalReport
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
        runtimeRisk: '',
        riskReason: '',
        blockedPenaltyApplied: false,
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

    this._invalidateReportingCache();
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

    this._invalidateReportingCache();
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
