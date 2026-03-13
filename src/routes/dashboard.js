const express = require('express');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');
const { pickText, toArray } = require('../utils/text');

function taskStatusToSkillStatus(task) {
  if (!task) return 'unknown';
  if (task.status === 'pending' || task.status === 'running') return 'running';
  if (task.status === 'failed') return 'error';
  if (task.status === 'success') return 'ok';
  return 'unknown';
}


const INSTALLED_SKILL_NAME_ALIAS = {
  'self-improving-agent': 'self-improvement',
  'tavily-search': 'tavily'
};

function runtimeSkillState(runtimeSkill) {
  if (!runtimeSkill) return 'unknown';
  if (runtimeSkill.disabled || runtimeSkill.blockedByAllowlist) return 'error';
  if (runtimeSkill.eligible) return 'ok';
  return 'error';
}

function resolveRuntimeSkillForSlug(runtimeIndex, slugInput) {
  const slug = pickText(slugInput).toLowerCase();
  if (!slug) return null;

  const keys = [slug];
  const alias = pickText(INSTALLED_SKILL_NAME_ALIAS[slug]).toLowerCase();
  if (alias) keys.push(alias);

  if (slug.endsWith('-search')) {
    keys.push(slug.replace(/-search$/i, ''));
  }

  for (const key of keys) {
    if (runtimeIndex.has(key)) return runtimeIndex.get(key);
  }

  return null;
}

function composeSkillState(task, runtimeSkill) {
  const taskState = taskStatusToSkillStatus(task);
  const runtimeState = runtimeSkillState(runtimeSkill);

  if (taskState === 'running') return 'running';
  if (task?.status === 'failed') return 'error';
  if (task?.status === 'success' && runtimeState === 'unknown') return 'ok';

  return runtimeState;
}

function summarizeTasks(tasks = []) {
  const summary = {
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    unknown: 0
  };

  for (const row of toArray(tasks)) {
    const status = pickText(row?.status, 'unknown').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, status)) summary[status] += 1;
    else summary.unknown += 1;
  }

  return summary;
}

function parseDateMs(input) {
  const t = Date.parse(String(input || ''));
  return Number.isFinite(t) ? t : 0;
}

function activeSessions(authService) {
  const sessions = authService?.sessions;
  if (!sessions || typeof sessions.values !== 'function') return [];

  return Array.from(sessions.values())
    .map((session) => ({
      createdAt: pickText(session?.createdAt),
      lastSeenAt: pickText(session?.lastSeenAt),
      ip: pickText(session?.ip),
      userAgent: pickText(session?.userAgent)
    }))
    .sort((a, b) => {
      const left = parseDateMs(a.lastSeenAt || a.createdAt);
      const right = parseDateMs(b.lastSeenAt || b.createdAt);
      return right - left;
    });
}

function humanizeAgo(targetDate, openclawService) {
  const ts = parseDateMs(targetDate);
  if (!ts) return '暂无数据';

  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return '刚刚';

  if (typeof openclawService?.humanizeRuntimeZh === 'function') {
    return `${openclawService.humanizeRuntimeZh(diffSec)}前`;
  }

  const mins = Math.max(1, Math.floor(diffSec / 60));
  return `${mins}分钟前`;
}

function summarizeSessionTelemetry({ authService, recentLogs, recentTasks, openclawService }) {
  const sessions = activeSessions(authService);
  const latestSeenAt = pickText(sessions[0]?.lastSeenAt, sessions[0]?.createdAt);
  const nowMs = Date.now();
  const oneHourAgo = nowMs - 60 * 60 * 1000;

  const logsLastHour = toArray(recentLogs).filter((row) => parseDateMs(row?.createdAt) >= oneHourAgo).length;
  const taskSummary = summarizeTasks(recentTasks);

  const chunks = [];
  chunks.push(sessions.length ? `在线会话 ${sessions.length} 个` : '当前无在线会话');

  if (latestSeenAt) {
    chunks.push(`最近活动 ${humanizeAgo(latestSeenAt, openclawService)}`);
  }

  if (logsLastHour > 0) {
    chunks.push(`近1小时日志 ${logsLastHour} 条`);
  }

  if (taskSummary.running > 0 || taskSummary.pending > 0) {
    chunks.push(`运行中任务 ${taskSummary.running}，待处理 ${taskSummary.pending}`);
  }

  return {
    active: sessions.length,
    latestSeenAt,
    logsLastHour,
    runningTasks: taskSummary.running,
    pendingTasks: taskSummary.pending,
    recentActivitySummary: chunks.join('，')
  };
}


function buildV3FusionSignals({ serviceFriendlyStatus, gatewayStatus, taskSummary, recentLogs, sessionSummary }) {
  let score = 100;
  const alerts = [];
  const recommendations = [];

  const serviceCode = pickText(serviceFriendlyStatus?.stateCode, 'unknown').toLowerCase();
  const gatewayCode = pickText(gatewayStatus?.stateCode, 'unknown').toLowerCase();
  const failedTasks = Number(taskSummary?.failed) || 0;
  const runningTasks = Number(taskSummary?.running) || 0;
  const pendingTasks = Number(taskSummary?.pending) || 0;

  const failedLogs = toArray(recentLogs).filter((row) => {
    const status = pickText(row?.status, '').toLowerCase();
    return status === 'failed' || status === 'error';
  }).length;

  if (!['running', 'ok', 'active'].includes(serviceCode)) {
    score -= 45;
    alerts.push('OpenClaw 服务未处于稳定运行态');
    recommendations.push('优先执行“状态同步”，若仍异常再执行“设备重启”');
  }

  if (!['running', 'ok', 'active'].includes(gatewayCode)) {
    score -= 20;
    alerts.push('Gateway 状态非在线');
    recommendations.push('检查 gateway 端点与状态输出，必要时重启 OpenClaw 服务');
  }

  if (failedTasks > 0) {
    score -= Math.min(20, failedTasks * 4);
    alerts.push(`最近任务失败 ${failedTasks} 条`);
    recommendations.push('打开“最近任务/日志”定位失败任务并优先修复');
  }

  if (runningTasks + pendingTasks >= 8) {
    score -= 10;
    alerts.push(`任务负载偏高（运行中 ${runningTasks} / 待处理 ${pendingTasks}）`);
    recommendations.push('建议分批执行 Skills 操作，避免并发拥塞');
  }

  if (failedLogs > 0) {
    score -= Math.min(12, failedLogs * 3);
    alerts.push(`最近日志中发现 ${failedLogs} 条异常记录`);
  }

  if ((Number(sessionSummary?.logsLastHour) || 0) > 45) {
    score -= 6;
    alerts.push('近 1 小时日志数量较高，可能存在抖动');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level = 'stable';
  let levelLabel = '稳定';
  if (score < 65) {
    level = 'critical';
    levelLabel = '高风险';
  } else if (score < 85) {
    level = 'watch';
    levelLabel = '观察';
  }

  if (!recommendations.length) {
    recommendations.push('系统整体健康，可继续按当前节奏自动迭代');
  }

  return {
    version: 'v3',
    codename: 'lobster-fusion',
    references: ['OpenclawVue', 'claw-control'],
    score,
    level,
    levelLabel,
    alerts: alerts.length ? alerts : ['未发现显著风险'],
    recommendations: recommendations.slice(0, 4),
    updateMode: 'auto-iterate'
  };
}
function defaultServiceStatus(openclawService) {
  const detail = {
    id: 'openclaw.service',
    activeState: 'unknown',
    subState: 'unknown'
  };

  const friendlyState =
    typeof openclawService?.describeServiceState === 'function'
      ? openclawService.describeServiceState(detail)
      : {
          stateCode: 'unknown',
          stateLabel: '状态采集中',
          description: '暂未获取到完整服务遥测',
          activeState: 'unknown',
          subState: 'unknown'
        };

  return {
    service: 'openclaw',
    detail,
    text: '',
    code: 1,
    runtimeSec: 0,
    runtimeText: '不足1分钟',
    friendlyState
  };
}

function createDashboardRouter({ authService, openclawService, taskService, logService, memoryService, squadService }) {
  const router = express.Router();

  router.get(
    '/summary',
    asyncHandler(async (_req, res) => {
      const appUptimeSec = process.uptime();
      const appRuntimeText =
        typeof openclawService?.humanizeRuntimeZh === 'function'
          ? openclawService.humanizeRuntimeZh(appUptimeSec)
          : `${Math.max(1, Math.floor(appUptimeSec / 60))}分钟`;

      const [statusResult, gatewayProbe, configResult, skillsResult, latestTasks, recentLogs, recentMemory, squadState] =
        await Promise.all([
          openclawService.getServiceStatus().catch(() => defaultServiceStatus(openclawService)),
          openclawService
            .getGatewayStatus()
            .catch(() => ({ stateCode: 'unknown', source: 'openclaw gateway status', text: '', error: '' })),
          openclawService.loadConfigJson().catch(() => ({ modelPrimary: '', config: {} })),
          openclawService.listSkillsRaw().catch(() => ({ rows: [] })),
          taskService.list({ limit: 8 }).catch(() => []),
          logService.list(10).catch(() => []),
          memoryService.recent(6).catch(() => []),
          squadService?.getState?.().catch(() => ({ roles: [], summary: {} }))
        ]);

      const serviceFriendlyStatus =
        statusResult?.friendlyState ||
        (typeof openclawService?.describeServiceState === 'function'
          ? openclawService.describeServiceState(statusResult?.detail || {})
          : {
              stateCode: 'unknown',
              stateLabel: '状态采集中',
              description: '暂未获取到完整服务遥测',
              activeState: pickText(statusResult?.detail?.activeState, 'unknown'),
              subState: pickText(statusResult?.detail?.subState, 'unknown')
            });

      const gatewayStatus =
        typeof openclawService?.describeGatewayState === 'function'
          ? openclawService.describeGatewayState(gatewayProbe, statusResult?.detail || {})
          : {
              stateCode: 'unknown',
              stateLabel: '状态暂不可用（等待网关遥测）',
              description: '未读取到网关状态，已启用兜底文案',
              source: pickText(gatewayProbe?.source, 'openclaw gateway status'),
              endpoint: pickText(gatewayProbe?.endpoint),
              port: gatewayProbe?.port,
              text: pickText(gatewayProbe?.text)
            };

      const serviceRuntimeSec = Number(statusResult?.runtimeSec) || 0;
      const serviceRuntimeText = pickText(
        statusResult?.runtimeText,
        typeof openclawService?.humanizeRuntimeZh === 'function'
          ? openclawService.humanizeRuntimeZh(serviceRuntimeSec)
          : ''
      );

      const health = {
        app: 'nas-geek-console',
        time: new Date().toISOString(),
        uptimeSec: appUptimeSec,
        runtimeText: appRuntimeText,
        pid: process.pid
      };

      const latestSkillTaskMap = await taskService.getLatestTaskMapByTarget(['skills.']);
      const skills = toArray(skillsResult?.rows);
      const availableSkills = await openclawService.listAvailableSkills().catch(() => ({ skills: [] }));
      const runtimeIndex = new Map(
        toArray(availableSkills?.skills).map((row) => [pickText(row?.name).toLowerCase(), row])
      );

      const skillSummary = {
        installed: skills.length,
        ok: 0,
        error: 0,
        running: 0,
        unknown: 0
      };

      for (const skill of skills) {
        const slug = pickText(skill.slug);
        const task = latestSkillTaskMap.get(slug);
        const runtimeSkill = resolveRuntimeSkillForSlug(runtimeIndex, slug);
        const state = composeSkillState(task, runtimeSkill);

        if (state === 'ok') skillSummary.ok += 1;
        else if (state === 'error') skillSummary.error += 1;
        else if (state === 'running') skillSummary.running += 1;
        else skillSummary.unknown += 1;
      }

      const squadSummary = {
        totalRoles: Number(squadState?.summary?.totalRoles) || 0,
        avgScore: Number(squadState?.summary?.avgScore) || 0,
        warningRoles: Number(squadState?.summary?.warningRoles) || 0,
        pendingTasks: Number(squadState?.summary?.pendingTasks) || 0
      };

      const modelSummary = {
        modelPrimary: pickText(configResult?.modelPrimary) || '-',
        thinkingDefault: pickText(configResult?.config?.agents?.defaults?.thinkingDefault, '-'),
        hasConfig: Boolean(configResult?.config && typeof configResult.config === 'object')
      };

      const memoryChanges = toArray(recentMemory).map((row) => ({
        id: `memory:${row.path}`,
        type: 'memory',
        action: 'memory.modified',
        target: row.path,
        status: 'success',
        message: `Modified ${row.path}`,
        createdAt: row.modifiedAt
      }));

      const recentChanges = [...toArray(recentLogs), ...memoryChanges]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, 10);

      const taskSummary = summarizeTasks(latestTasks);
      const sessionSummary = summarizeSessionTelemetry({
        authService,
        recentLogs,
        recentTasks: latestTasks,
        openclawService
      });

      const statusSummary = `OpenClaw ${pickText(serviceFriendlyStatus.stateLabel)} · Gateway ${pickText(
        gatewayStatus.stateLabel
      )}`;

      const v3Fusion = buildV3FusionSignals({
        serviceFriendlyStatus,
        gatewayStatus,
        taskSummary,
        recentLogs,
        sessionSummary
      });

      const quickActions = [
        { id: 'service.status', label: 'systemctl openclaw status' },
        { id: 'service.restart', label: 'systemctl openclaw restart' },
        { id: 'service.stop', label: 'systemctl openclaw stop' }
      ];

      const runtime = {
        appUptimeSec,
        appUptimeText: appRuntimeText,
        serviceUptimeSec: serviceRuntimeSec,
        serviceUptimeText: serviceRuntimeText || '不足1分钟'
      };

      const monitorMatrix = {
        service: {
          unit: pickText(statusResult?.detail?.id, 'openclaw.service'),
          activeState: pickText(statusResult?.detail?.activeState, 'unknown'),
          subState: pickText(statusResult?.detail?.subState, 'unknown'),
          stateCode: pickText(serviceFriendlyStatus?.stateCode, 'unknown'),
          stateLabel: pickText(serviceFriendlyStatus?.stateLabel, '状态采集中'),
          runtimeText: runtime.serviceUptimeText
        },
        gateway: {
          unit: pickText(statusResult?.detail?.id, 'openclaw.service'),
          activeState: pickText(statusResult?.detail?.activeState, 'unknown'),
          subState: pickText(statusResult?.detail?.subState, 'unknown'),
          stateCode: pickText(gatewayStatus?.stateCode, 'unknown'),
          stateLabel: pickText(gatewayStatus?.stateLabel, '状态暂不可用（等待网关遥测）'),
          source: pickText(gatewayStatus?.source, 'openclaw gateway status'),
          endpoint: pickText(gatewayStatus?.endpoint, '-'),
          fallbackUsed: Boolean(gatewayStatus?.fallbackUsed)
        },
        sessions: {
          active: sessionSummary.active,
          latestSeenAt: sessionSummary.latestSeenAt,
          recentActivitySummary: sessionSummary.recentActivitySummary
        },
        tasks: taskSummary,
        recentLogs: toArray(recentLogs).slice(0, 8)
      };

      const payload = {
        health,
        runtime,
        statusSummary,
        serviceStatus: statusResult?.detail || {},
        serviceFriendlyStatus,
        gatewayStatus,
        modelSummary,
        squadSummary,
        skillSummary,
        sessionSummary,
        monitorMatrix,
        recentLogs: toArray(recentLogs).slice(0, 10),
        recentTasks: toArray(latestTasks),
        recentChanges,
        quickActions,
        v3: v3Fusion
      };

      return sendSuccess(res, payload, {
        legacy: payload
      });
    })
  );

  return router;
}

module.exports = {
  createDashboardRouter
};
