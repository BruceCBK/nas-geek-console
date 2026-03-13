const WECHAT_RECO_LIMIT = 10;
const WECHAT_DEFAULT_QUERY = '实用软件 免费工具 效率工具 工具测评';
const DASHBOARD_AUTO_MIN_MS = 5000;
const DASHBOARD_AUTO_MAX_MS = 2 * 60 * 1000;

const dom = {
  loginOverlay: document.getElementById('loginOverlay'),
  loginPassword: document.getElementById('loginPassword'),
  loginBtn: document.getElementById('loginBtn'),
  loginMsg: document.getElementById('loginMsg'),
  logoutBtn: document.getElementById('logoutBtn'),
  lanHint: document.getElementById('lanHint'),

  navButtons: document.querySelectorAll('.nav-btn[data-view]'),
  views: document.querySelectorAll('.view'),

  mouseGlow: document.getElementById('mouseGlow'),
  particleCanvas: document.getElementById('particleCanvas'),

  dashboardRefreshBtn: document.getElementById('dashboardRefreshBtn'),
  dashboardAutoRefreshToggle: document.getElementById('dashboardAutoRefreshToggle'),
  dashboardAutoRefreshInterval: document.getElementById('dashboardAutoRefreshInterval'),
  dashboardAutoRefreshHint: document.getElementById('dashboardAutoRefreshHint'),
  healthCard: document.getElementById('healthCard'),
  modelSummaryCard: document.getElementById('modelSummaryCard'),
  skillsSummaryCard: document.getElementById('skillsSummaryCard'),
  gatewaySummaryCard: document.getElementById('gatewaySummaryCard'),
  runtimeSummaryCard: document.getElementById('runtimeSummaryCard'),
  fusionSummaryCard: document.getElementById('fusionSummaryCard'),
  dashboardRecentTasks: document.getElementById('dashboardRecentTasks'),
  dashboardFusionAlerts: document.getElementById('dashboardFusionAlerts'),
  dashboardActionPlan: document.getElementById('dashboardActionPlan'),
  dashboardRecentLogs: document.getElementById('dashboardRecentLogs'),
  dashboardRecentChanges: document.getElementById('dashboardRecentChanges'),
  dashboardMsg: document.getElementById('dashboardMsg'),

  quickServiceStatusBtn: document.getElementById('quickServiceStatusBtn'),
  quickServiceStartBtn: document.getElementById('quickServiceStartBtn'),
  quickServiceRestartBtn: document.getElementById('quickServiceRestartBtn'),
  quickServiceStopBtn: document.getElementById('quickServiceStopBtn'),

  skillsSearchInput: document.getElementById('skillsSearchInput'),
  skillsStatusFilter: document.getElementById('skillsStatusFilter'),
  skillsSearchBtn: document.getElementById('skillsSearchBtn'),
  refreshSkillsBtn: document.getElementById('refreshSkillsBtn'),
  skillSlugInput: document.getElementById('skillSlugInput'),
  installSkillBtn: document.getElementById('installSkillBtn'),
  updateSkillBtn: document.getElementById('updateSkillBtn'),
  removeSkillBtn: document.getElementById('removeSkillBtn'),
  updateAllSkillsBtn: document.getElementById('updateAllSkillsBtn'),
  batchUpdateBtn: document.getElementById('batchUpdateBtn'),
  skillZipInput: document.getElementById('skillZipInput'),
  installSkillZipBtn: document.getElementById('installSkillZipBtn'),
  skillsList: document.getElementById('skillsList'),
  batchResultList: document.getElementById('batchResultList'),
  skillsSearchLinks: document.getElementById('skillsSearchLinks'),
  skillsMsg: document.getElementById('skillsMsg'),
  skillsOpsStatus: document.getElementById('skillsOpsStatus'),
  skillsOpsProgressBar: document.getElementById('skillsOpsProgressBar'),
  skillsOpsText: document.getElementById('skillsOpsText'),

  squadRefreshBtn: document.getElementById('squadRefreshBtn'),
  squadSyncMemoryBtn: document.getElementById('squadSyncMemoryBtn'),
  squadRoleBoard: document.getElementById('squadRoleBoard'),
  squadLeaderboard: document.getElementById('squadLeaderboard'),
  squadTaskBoard: document.getElementById('squadTaskBoard'),
  squadTaskTitleInput: document.getElementById('squadTaskTitleInput'),
  squadTaskDescInput: document.getElementById('squadTaskDescInput'),
  squadTaskRoleSelect: document.getElementById('squadTaskRoleSelect'),
  squadTaskWeightInput: document.getElementById('squadTaskWeightInput'),
  squadCreateTaskBtn: document.getElementById('squadCreateTaskBtn'),
  squadReviewTaskIdInput: document.getElementById('squadReviewTaskIdInput'),
  squadReviewCompletionInput: document.getElementById('squadReviewCompletionInput'),
  squadReviewQualityInput: document.getElementById('squadReviewQualityInput'),
  squadReviewOwnerInput: document.getElementById('squadReviewOwnerInput'),
  squadReviewCaptainInput: document.getElementById('squadReviewCaptainInput'),
  squadReviewPassedSelect: document.getElementById('squadReviewPassedSelect'),
  squadReviewNoteInput: document.getElementById('squadReviewNoteInput'),
  squadSubmitReviewBtn: document.getElementById('squadSubmitReviewBtn'),
  squadReflectionRoleSelect: document.getElementById('squadReflectionRoleSelect'),
  squadReflectionText: document.getElementById('squadReflectionText'),
  squadSubmitReflectionBtn: document.getElementById('squadSubmitReflectionBtn'),
  squadMsg: document.getElementById('squadMsg'),

  wechatSearchInput: document.getElementById('wechatSearchInput'),
  wechatSearchBtn: document.getElementById('wechatSearchBtn'),
  refreshTrendingBtn: document.getElementById('refreshTrendingBtn'),
  tabButtons: document.querySelectorAll('.tab-btn[data-tab]'),
  contentList: document.getElementById('contentList'),
  favoritesList: document.getElementById('favoritesList'),
  topicsList: document.getElementById('topicsList'),
  contentMsg: document.getElementById('contentMsg')
};

const state = {
  token: loadToken(),
  activeView: 'dashboardView',
  activeTab: 'wechat',
  dashboard: null,
  dashboardLoadSeq: 0,
  dashboardAuto: {
    enabled: true,
    baseMs: 30000,
    timer: 0,
    inFlight: false,
    failCount: 0,
    nextAt: 0
  },
  serviceVisualState: '',

  skills: [],
  selectedSkills: new Set(),
  skillsSearchLinks: [],
  batchResults: [],

  squad: {
    roles: [],
    tasks: [],
    summary: {},
    warningRoles: [],
    executor: {},
    causeLabels: {},
    reporting: {}
  },

  trendingData: null,
  wechatRecommendations: [],
  contentFavorites: [],
  contentTopics: [],

  skillsOps: {
    active: false,
    total: 0,
    done: 0,
    failed: 0,
    label: '待命'
  },

  cleanupFns: [],
  particle: {
    rafId: 0,
    particles: [],
    reducedMotion: false
  }
};

const msgTimers = new Map();

init();

function init() {
  wireEvents();
  state.dashboardAuto.enabled = Boolean(dom.dashboardAutoRefreshToggle?.checked ?? true);
  state.dashboardAuto.baseMs = parseAutoRefreshBaseMs(dom.dashboardAutoRefreshInterval?.value);
  bindMouseGlow();
  initParticleBackground();
  bindInteractiveSurfaces(document);
  syncLanHint();
  setActiveView(state.activeView);
  setActiveTab(state.activeTab);
  renderSkillTable();
  renderSkillSearchLinks();
  renderBatchResults();
  renderSkillsOpsStatus();
  renderSquadState();
  renderDashboardAutoRefreshHint();
  const hintTicker = setInterval(() => {
    if (state.dashboardAuto.enabled) renderDashboardAutoRefreshHint();
  }, 1000);
  registerCleanup(() => clearInterval(hintTicker));
  renderContentLists();
  renderFavorites();
  renderTopics();
  verifySessionAndLoad();
  window.addEventListener('beforeunload', cleanupAppLifecycle);
  window.addEventListener('pagehide', cleanupAppLifecycle);
}

function wireEvents() {
  dom.loginBtn?.addEventListener('click', () => {
    login().catch((err) => setMessage(dom.loginMsg, err.message, 'error'));
  });

  dom.loginPassword?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    login().catch((err) => setMessage(dom.loginMsg, err.message, 'error'));
  });

  dom.logoutBtn?.addEventListener('click', () => {
    logout().catch(() => {});
  });

  dom.navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const viewId = button.dataset.view;
      if (!viewId) return;
      setActiveView(viewId);
    });
  });

  dom.dashboardRefreshBtn?.addEventListener('click', () => {
    withButtons([dom.dashboardRefreshBtn], async () => {
      setMessage(dom.dashboardMsg, '引擎遥测中...', 'info', 0);
      await loadDashboardSummary();
      state.dashboardAuto.failCount = 0;
      scheduleDashboardAutoRefresh('manual');
      setMessage(dom.dashboardMsg, '状态矩阵已同步', 'success');
    }).catch((err) => setMessage(dom.dashboardMsg, err.message, 'error'));
  });

  dom.dashboardAutoRefreshToggle?.addEventListener('change', () => {
    state.dashboardAuto.enabled = Boolean(dom.dashboardAutoRefreshToggle?.checked);
    renderDashboardAutoRefreshHint();
    scheduleDashboardAutoRefresh('toggle');
  });

  dom.dashboardAutoRefreshInterval?.addEventListener('change', () => {
    state.dashboardAuto.baseMs = parseAutoRefreshBaseMs(dom.dashboardAutoRefreshInterval?.value);
    renderDashboardAutoRefreshHint();
    scheduleDashboardAutoRefresh('interval');
  });

  dom.quickServiceStatusBtn?.addEventListener('click', () => {
    fetchOpenClawServiceStatus().catch((err) => setMessage(dom.dashboardMsg, err.message, 'error'));
  });
  dom.quickServiceStartBtn?.addEventListener('click', () => {
    startOpenClawService().catch((err) => setMessage(dom.dashboardMsg, err.message, 'error'));
  });
  dom.quickServiceRestartBtn?.addEventListener('click', () => {
    restartOpenClawService().catch((err) => setMessage(dom.dashboardMsg, err.message, 'error'));
  });
  dom.quickServiceStopBtn?.addEventListener('click', () => {
    stopOpenClawService().catch((err) => setMessage(dom.dashboardMsg, err.message, 'error'));
  });

  dom.refreshSkillsBtn?.addEventListener('click', () => {
    loadSkills().catch((err) => setMessage(dom.skillsMsg, err.message, 'error'));
  });
  dom.skillsSearchBtn?.addEventListener('click', () => {
    runSkillSearch().catch((err) => setMessage(dom.skillsMsg, err.message, 'error'));
  });
  dom.skillsSearchInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    runSkillSearch().catch((err) => setMessage(dom.skillsMsg, err.message, 'error'));
  });
  dom.skillsStatusFilter?.addEventListener('change', () => {
    loadSkills().catch((err) => setMessage(dom.skillsMsg, err.message, 'error'));
  });

  dom.installSkillBtn?.addEventListener('click', () => {
    installSkill().catch((err) => setMessage(dom.skillsMsg, err.message, 'error'));
  });
  dom.updateSkillBtn?.addEventListener('click', () => {
    updateSkill().catch((err) => setMessage(dom.skillsMsg, err.message, 'error'));
  });
  dom.removeSkillBtn?.addEventListener('click', () => {
    removeSkill().catch((err) => setMessage(dom.skillsMsg, err.message, 'error'));
  });
  dom.updateAllSkillsBtn?.addEventListener('click', () => {
    updateAllSkills().catch((err) => setMessage(dom.skillsMsg, err.message, 'error'));
  });
  dom.batchUpdateBtn?.addEventListener('click', () => {
    batchUpdateSkills().catch((err) => setMessage(dom.skillsMsg, err.message, 'error'));
  });
  dom.installSkillZipBtn?.addEventListener('click', () => {
    installSkillZip().catch((err) => setMessage(dom.skillsMsg, err.message, 'error'));
  });

  dom.squadRefreshBtn?.addEventListener('click', () => {
    loadSquadState().catch((err) => setMessage(dom.squadMsg, err.message, 'error'));
  });
  dom.squadSyncMemoryBtn?.addEventListener('click', () => {
    syncSquadReportingMemory().catch((err) => setMessage(dom.squadMsg, err.message, 'error'));
  });
  dom.squadCreateTaskBtn?.addEventListener('click', () => {
    createSquadTask().catch((err) => setMessage(dom.squadMsg, err.message, 'error'));
  });
  dom.squadSubmitReviewBtn?.addEventListener('click', () => {
    submitSquadReview().catch((err) => setMessage(dom.squadMsg, err.message, 'error'));
  });
  dom.squadSubmitReflectionBtn?.addEventListener('click', () => {
    submitSquadReflection().catch((err) => setMessage(dom.squadMsg, err.message, 'error'));
  });

  dom.tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;
      if (!tab) return;
      setActiveTab(tab);
      renderContentLists();
    });
  });

  dom.wechatSearchBtn?.addEventListener('click', () => {
    fetchWechatRecommendations(true).catch((err) => setMessage(dom.contentMsg, err.message, 'error'));
  });
  dom.wechatSearchInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    fetchWechatRecommendations(true).catch((err) => setMessage(dom.contentMsg, err.message, 'error'));
  });
  dom.refreshTrendingBtn?.addEventListener('click', () => {
    refreshTrending().catch((err) => setMessage(dom.contentMsg, err.message, 'error'));
  });
}

async function verifySessionAndLoad() {
  if (!state.token) {
    setAuthenticated(false);
    clearDashboardAutoTimer();
    renderDashboardAutoRefreshHint();
    return;
  }

  try {
    await apiJson('/api/auth/me');
    setAuthenticated(true);
    await loadInitialData();
    scheduleDashboardAutoRefresh('session-ready');
  } catch {
    clearToken();
    setAuthenticated(false);
    clearDashboardAutoTimer();
    renderDashboardAutoRefreshHint();
  }
}

async function login() {
  const password = pickText(dom.loginPassword?.value);
  if (!password) {
    setMessage(dom.loginMsg, '请输入密码', 'error');
    return;
  }

  await withButtons([dom.loginBtn], async () => {
    setMessage(dom.loginMsg, '登录中...', 'info', 0);
    const payload = await apiJson('/api/auth/login', {
      method: 'POST',
      body: { password },
      auth: false
    });

    const token = pickText(payload?.token);
    if (!token) throw new Error('登录失败：未返回 token');

    saveToken(token);
    state.token = token;
    if (dom.loginPassword) dom.loginPassword.value = '';

    setAuthenticated(true);
    setMessage(dom.loginMsg, '登录成功', 'success');
    await loadInitialData();
    state.dashboardAuto.failCount = 0;
    scheduleDashboardAutoRefresh('login');
  });
}

async function logout() {
  const current = state.token;
  clearToken();
  state.token = '';
  setAuthenticated(false);
  clearDashboardAutoTimer();
  renderDashboardAutoRefreshHint();
  if (!current) return;

  try {
    await apiJson('/api/auth/logout', {
      method: 'POST'
    });
  } catch {
    // ignore logout errors
  }
}

function setAuthenticated(authed) {
  const isAuthed = Boolean(authed);
  dom.loginOverlay?.classList.toggle('hidden', isAuthed);

  if (dom.dashboardAutoRefreshToggle) dom.dashboardAutoRefreshToggle.disabled = !isAuthed;
  if (dom.dashboardAutoRefreshInterval) dom.dashboardAutoRefreshInterval.disabled = !isAuthed;

  if (!isAuthed) {
    clearDashboardAutoTimer();
  }

  renderDashboardAutoRefreshHint();
}

function setActiveView(viewId) {
  state.activeView = viewId;

  dom.navButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.view === viewId);
  });
  dom.views.forEach((view) => {
    view.classList.toggle('active', view.id === viewId);
  });

  requestAnimationFrame(() => bindInteractiveSurfaces(document));
}

function setActiveTab(tab) {
  state.activeTab = tab || 'wechat';
  dom.tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === state.activeTab);
  });
}

async function loadInitialData() {
  await Promise.allSettled([
    loadDashboardSummary(),
    loadSkills(),
    loadSkillSearchLinks(),
    loadSquadState(),
    refreshTrending(),
    fetchWechatRecommendations(false),
    loadContentState()
  ]);
}

async function loadDashboardSummary() {
  const seq = (state.dashboardLoadSeq || 0) + 1;
  state.dashboardLoadSeq = seq;

  const payload = await apiJson('/api/dashboard/summary');
  if (seq !== state.dashboardLoadSeq) return;

  state.dashboard = payload;
  renderLobsterServiceStatus(payload);
  renderDashboardMonitor(payload);
}

async function refreshSkillsAndDashboard() {
  await Promise.allSettled([loadSkills(), loadDashboardSummary()]);
}

function parseAutoRefreshBaseMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30000;
  return Math.max(DASHBOARD_AUTO_MIN_MS, Math.min(DASHBOARD_AUTO_MAX_MS, Math.floor(n)));
}

function calcDashboardNextDelayMs() {
  const base = parseAutoRefreshBaseMs(state.dashboardAuto.baseMs);
  const failCount = Math.max(0, Math.floor(Number(state.dashboardAuto.failCount) || 0));
  const backoff = Math.min(DASHBOARD_AUTO_MAX_MS, base * 2 ** Math.min(4, failCount));
  const jitter = Math.floor(backoff * (Math.random() * 0.12));
  return Math.min(DASHBOARD_AUTO_MAX_MS, backoff + jitter);
}

function clearDashboardAutoTimer() {
  if (!state.dashboardAuto.timer) return;
  clearTimeout(state.dashboardAuto.timer);
  state.dashboardAuto.timer = 0;
  state.dashboardAuto.nextAt = 0;
}

function renderDashboardAutoRefreshHint() {
  if (!dom.dashboardAutoRefreshHint) return;

  const auto = state.dashboardAuto;
  const baseSec = Math.max(1, Math.round(parseAutoRefreshBaseMs(auto.baseMs) / 1000));

  if (!state.token) {
    dom.dashboardAutoRefreshHint.textContent = '自动刷新：登录后启用';
    return;
  }

  if (!auto.enabled) {
    dom.dashboardAutoRefreshHint.textContent = `自动刷新：已暂停（手动）`;
    return;
  }

  if (auto.inFlight) {
    dom.dashboardAutoRefreshHint.textContent = '自动刷新：同步中...';
    return;
  }

  if (!auto.nextAt) {
    dom.dashboardAutoRefreshHint.textContent = `自动刷新：每${baseSec}秒`;
    return;
  }

  const leftMs = Math.max(0, auto.nextAt - Date.now());
  const leftSec = Math.max(1, Math.ceil(leftMs / 1000));
  const retryLabel = auto.failCount > 0 ? `，退避 x${2 ** Math.min(4, auto.failCount)}` : '';
  dom.dashboardAutoRefreshHint.textContent = `自动刷新：${leftSec}秒后${retryLabel}`;
}

function scheduleDashboardAutoRefresh(reason = 'default') {
  clearDashboardAutoTimer();
  const auto = state.dashboardAuto;

  if (!auto.enabled || !state.token) {
    renderDashboardAutoRefreshHint();
    return;
  }

  const delay = reason === 'manual' ? parseAutoRefreshBaseMs(auto.baseMs) : calcDashboardNextDelayMs();
  auto.nextAt = Date.now() + delay;
  renderDashboardAutoRefreshHint();

  auto.timer = setTimeout(() => {
    runDashboardAutoRefreshTick().catch(() => {});
  }, delay);
}

async function runDashboardAutoRefreshTick() {
  const auto = state.dashboardAuto;
  auto.timer = 0;

  if (!auto.enabled || auto.inFlight || !state.token) {
    renderDashboardAutoRefreshHint();
    return;
  }

  auto.inFlight = true;
  renderDashboardAutoRefreshHint();

  try {
    await loadDashboardSummary();
    auto.failCount = 0;
  } catch {
    auto.failCount = Math.min(6, auto.failCount + 1);
  } finally {
    auto.inFlight = false;
    scheduleDashboardAutoRefresh('tick');
  }
}

function mapLobsterServiceState(payload = {}) {
  const friendly = asObject(payload.serviceFriendlyStatus || payload.monitorMatrix?.service);
  const code = pickText(friendly.stateCode).toLowerCase();

  if (state.serviceVisualState === 'starting') return 'starting';
  if (code === 'running' || code === 'ok' || code === 'active') return 'running';
  if (code === 'starting' || code === 'activating' || code === 'reloading') return 'starting';
  if (code === 'error' || code === 'failed') return 'error';
  if (code === 'stopped' || code === 'inactive') return 'stopped';
  return 'unknown';
}

function lobsterServiceStateLabel(code, payload = {}) {
  const fallback = asObject(payload.serviceFriendlyStatus);
  if (code === 'running') return pickText(fallback.stateLabel, '运行中');
  if (code === 'starting') return pickText(fallback.stateLabel, '启动中');
  if (code === 'error') return pickText(fallback.stateLabel, '异常');
  if (code === 'stopped') return pickText(fallback.stateLabel, '已停止');
  return pickText(fallback.stateLabel, '状态采集中');
}

function renderLobsterServiceStatus(payload = {}) {
  const detail = asObject(payload.serviceStatus);
  const code = mapLobsterServiceState(payload);
  const label = lobsterServiceStateLabel(code, payload);
  const active = pickText(detail.activeState, 'unknown');
  const sub = pickText(detail.subState, 'unknown');
  const runtime = pickText(payload.runtime?.serviceUptimeText, payload.runtime?.appUptimeText, '不足1分钟');

  const lines = [
    'OPENCLAW // LOBSTER ENGINE',
    '--------------------------------',
    `主状态: ${label}`,
    `Systemd: ${active}/${sub}`,
    `服务运行: ${runtime}`,
    `遥测时间: ${new Date().toLocaleString()}`
  ];

  if (dom.healthCard) dom.healthCard.textContent = lines.join('\n');
  return { code, label };
}

function renderDashboardMonitor(payload = {}) {
  const health = asObject(payload.health);
  const runtime = asObject(payload.runtime);
  const modelSummary = asObject(payload.modelSummary);
  const skillSummary = asObject(payload.skillSummary);
  const monitor = asObject(payload.monitorMatrix);
  const service = asObject(monitor.service);
  const gateway = asObject(payload.gatewayStatus || monitor.gateway);
  const sessions = asObject(payload.sessionSummary || monitor.sessions);
  const taskSummary = asObject(monitor.tasks);
  const fusion = asObject(payload.v3);

  const gatewayLabel = pickText(gateway.stateLabel, '状态暂不可用（等待网关遥测）');

  renderKeyValue(dom.modelSummaryCard, {
    模型: pickText(modelSummary.modelPrimary, '-'),
    配置: modelSummary.hasConfig ? '已加载' : '未加载',
    控制台运行: pickText(runtime.appUptimeText, health.runtimeText, humanizeRuntimeZh(health.uptimeSec)),
    进程PID: pickText(health.pid, '-')
  });

  renderKeyValue(dom.skillsSummaryCard, {
    已安装: formatNumber(skillSummary.installed),
    正常: formatNumber(skillSummary.ok),
    运行中: formatNumber(skillSummary.running),
    异常: formatNumber(skillSummary.error),
    未知: formatNumber(skillSummary.unknown)
  });

  renderKeyValue(dom.gatewaySummaryCard, {
    状态: gatewayLabel,
    来源: pickText(gateway.source, 'openclaw gateway status'),
    接入点: pickText(gateway.endpoint, '-'),
    回退策略: gateway.fallbackUsed ? '已启用' : '未触发'
  });

  renderKeyValue(dom.runtimeSummaryCard, {
    服务状态: pickText(service.stateLabel, payload.serviceFriendlyStatus?.stateLabel, '状态采集中'),
    服务运行: pickText(runtime.serviceUptimeText, '不足1分钟'),
    在线会话: formatNumber(sessions.active),
    最近活动: pickText(sessions.recentActivitySummary, '暂无近期活动数据')
  });

  renderV3Fusion(fusion, payload);

  renderTaskList(dom.dashboardRecentTasks, toArray(payload.recentTasks).slice(0, 6), {
    emptyText: '暂无任务动态'
  });
  renderTaskList(dom.dashboardRecentLogs, normalizeDashboardLogs(monitor.recentLogs || payload.recentLogs).slice(0, 6), {
    emptyText: '暂无日志动态'
  });
  renderTaskList(dom.dashboardRecentChanges, toArray(payload.recentChanges).slice(0, 6), {
    emptyText: '暂无变更动态'
  });
}


function renderV3Fusion(fusion = {}, payload = {}) {
  const refText = toArray(fusion.references).filter(Boolean).join(' + ') || 'OpenclawVue + claw-control';
  const score = Number(fusion.score);
  const scoreText = Number.isFinite(score) ? `${Math.max(0, Math.min(100, Math.round(score)))}/100` : '-';
  const levelText = pickText(fusion.levelLabel, fusion.level, '稳定');

  renderKeyValue(dom.fusionSummaryCard, {
    版本: pickText(fusion.version, 'v3'),
    代号: pickText(fusion.codename, 'lobster-fusion'),
    融合源: refText,
    风险评分: scoreText,
    风险等级: levelText,
    迭代模式: pickText(fusion.updateMode, 'auto-iterate')
  });

  const alertRows = toArray(fusion.alerts).slice(0, 6).map((text, idx) => ({
    id: `fusion-alert-${idx}`,
    type: 'v3.alert',
    status: pickText(fusion.level, 'stable').toLowerCase() === 'critical' ? 'error' : 'info',
    message: pickText(text, '-'),
    createdAt: pickText(payload.health?.time)
  }));

  renderTaskList(dom.dashboardFusionAlerts, alertRows, {
    emptyText: '暂无 V3 风险告警'
  });

  const planRows = toArray(fusion.recommendations).slice(0, 6).map((text, idx) => ({
    id: `fusion-plan-${idx}`,
    type: 'v3.plan',
    status: pickText(fusion.level, 'stable').toLowerCase() === 'critical' ? 'pending' : 'success',
    message: pickText(text, '-'),
    createdAt: pickText(payload.health?.time)
  }));

  renderTaskList(dom.dashboardActionPlan, planRows, {
    emptyText: '暂无迭代建议'
  });
}
function normalizeDashboardLogs(logs) {
  return toArray(logs).map((row) => ({
    id: pickText(row?.id),
    action: pickText(row?.action, row?.type, 'operation'),
    target: pickText(row?.target, '-'),
    status: pickText(row?.status, 'info'),
    message: pickText(row?.message, '-'),
    createdAt: pickText(row?.createdAt)
  }));
}

async function fetchOpenClawServiceStatus() {
  await withButtons([dom.quickServiceStatusBtn], async () => {
    const payload = await apiJson('/api/openclaw/service/status');
    const summaryPayload = {
      serviceStatus: asObject(payload.detail),
      serviceFriendlyStatus: asObject(payload.friendlyState),
      runtime: {
        serviceUptimeText: pickText(payload.runtimeText)
      }
    };
    renderLobsterServiceStatus(summaryPayload);
    const label = pickText(payload.friendlyState?.stateLabel, '状态已同步');
    setMessage(dom.dashboardMsg, label, 'success');
  });
}

async function startOpenClawService() {
  if (!window.confirm('确认执行 systemctl start openclaw.service？')) return;

  await withButtons([dom.quickServiceStartBtn], async () => {
    await apiJson('/api/openclaw/service/start', {
      method: 'POST'
    });
    state.serviceVisualState = '';
    await loadDashboardSummary();
    setMessage(dom.dashboardMsg, '引擎启动，服务运行中', 'success');
  });
}

async function restartOpenClawService() {
  if (!window.confirm('确认执行 systemctl restart openclaw.service？这是危险操作。')) return;

  await withButtons([dom.quickServiceRestartBtn], async () => {
    state.serviceVisualState = 'starting';
    renderLobsterServiceStatus({
      serviceStatus: { activeState: 'activating', subState: 'auto-restart' },
      serviceFriendlyStatus: { stateCode: 'starting', stateLabel: '启动中' },
      runtime: { serviceUptimeText: '不足1分钟' }
    });
    setMessage(dom.dashboardMsg, '设备重启中，稍后刷新状态', 'info', 3200);

    await apiJson('/api/openclaw/service/restart', {
      method: 'POST'
    });

    await sleep(2800);
    state.serviceVisualState = '';
    await loadDashboardSummary();
  });
}

async function stopOpenClawService() {
  if (!window.confirm('确认执行 systemctl stop openclaw.service？这是危险操作。')) return;

  await withButtons([dom.quickServiceStopBtn], async () => {
    await apiJson('/api/openclaw/service/stop', {
      method: 'POST'
    });
    state.serviceVisualState = '';
    await loadDashboardSummary();
    setMessage(dom.dashboardMsg, '系统停止，安全锁定', 'success');
  });
}

async function runSkillSearch() {
  await Promise.allSettled([loadSkills(), loadSkillSearchLinks()]);
}

async function loadSkills() {
  const params = new URLSearchParams();
  const q = pickText(dom.skillsSearchInput?.value);
  const status = pickText(dom.skillsStatusFilter?.value, 'all');
  if (q) params.set('q', q);
  if (status) params.set('status', status);

  const payload = await apiJson(`/api/skills?${params.toString()}`);
  state.skills = toArray(payload.skills);

  const valid = new Set(state.skills.map((item) => pickText(item.slug)));
  Array.from(state.selectedSkills).forEach((slug) => {
    if (!valid.has(slug)) state.selectedSkills.delete(slug);
  });

  renderSkillTable();
}

async function loadSkillSearchLinks() {
  const q = pickText(dom.skillsSearchInput?.value);
  const payload = await apiJson(`/api/skills/search-links?q=${encodeURIComponent(q)}`);
  state.skillsSearchLinks = toArray(payload.links);
  renderSkillSearchLinks();
}

function renderSkillSearchLinks() {
  if (!dom.skillsSearchLinks) return;
  dom.skillsSearchLinks.innerHTML = '';

  if (!state.skillsSearchLinks.length) {
    dom.skillsSearchLinks.appendChild(buildEmpty('请输入关键词后点击“搜索”'));
    return;
  }

  state.skillsSearchLinks.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'list-item ripple-surface';

    const line = document.createElement('div');
    line.className = 'list-line';

    const a = document.createElement('a');
    a.href = pickText(row.url);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = pickText(row.title, row.url, '打开链接');

    const small = document.createElement('small');
    small.textContent = pickText(row.url);

    line.append(a);
    item.append(line, small);
    dom.skillsSearchLinks.appendChild(item);
  });

  bindInteractiveSurfaces(dom.skillsSearchLinks);
}

function renderSkillTable() {
  if (!dom.skillsList) return;
  dom.skillsList.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'table-head';
  head.innerHTML = '<span></span><span>Slug</span><span>版本</span><span>来源</span><span>更新时间</span><span>状态</span><span>最近结果</span>';
  dom.skillsList.appendChild(head);

  if (!state.skills.length) {
    dom.skillsList.appendChild(buildEmpty('暂无 Skills'));
    return;
  }

  state.skills.forEach((skill) => {
    const slug = pickText(skill.slug);
    const row = document.createElement('div');
    row.className = 'table-row ripple-surface';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedSkills.has(slug);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedSkills.add(slug);
      else state.selectedSkills.delete(slug);
    });

    const slugCell = document.createElement('button');
    slugCell.className = 'ghost';
    slugCell.textContent = slug;
    slugCell.addEventListener('click', () => {
      if (dom.skillSlugInput) dom.skillSlugInput.value = slug;
    });

    const statusBadge = buildBadge(pickText(skill.status, 'unknown'));

    row.append(
      checkbox,
      slugCell,
      textCell(pickText(skill.version, '-')),
      textCell(pickText(skill.source, '-')),
      textCell(formatTime(skill.updatedAt)),
      statusBadge,
      textCell(pickText(skill.recentResult, '-'))
    );

    dom.skillsList.appendChild(row);
  });

  bindInteractiveSurfaces(dom.skillsList);
}

function getCurrentSlug() {
  return pickText(dom.skillSlugInput?.value);
}

function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9-_]{0,80}$/i.test(slug);
}

function skillButtons() {
  return [
    dom.installSkillBtn,
    dom.updateSkillBtn,
    dom.removeSkillBtn,
    dom.updateAllSkillsBtn,
    dom.batchUpdateBtn,
    dom.installSkillZipBtn
  ];
}

function renderSkillsOpsStatus() {
  const ops = state.skillsOps;
  const total = Math.max(1, Number(ops.total) || 1);
  const done = Math.max(0, Number(ops.done) || 0);
  const failed = Math.max(0, Number(ops.failed) || 0);
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));

  if (dom.skillsOpsProgressBar) {
    dom.skillsOpsProgressBar.style.width = `${pct}%`;
    dom.skillsOpsProgressBar.classList.toggle('failed', failed > 0);
  }

  if (dom.skillsOpsStatus) {
    dom.skillsOpsStatus.classList.toggle('running', Boolean(ops.active));
    dom.skillsOpsStatus.classList.toggle('failed', !ops.active && failed > 0);
  }

  if (!dom.skillsOpsText) return;

  if (!ops.active && done === 0 && !failed) {
    dom.skillsOpsText.textContent = '待命';
    return;
  }

  const statusText = ops.active ? '进行中' : failed > 0 ? '完成（含失败）' : '完成';
  const label = pickText(ops.label, 'Skills 操作');
  const failPart = failed > 0 ? `，失败 ${failed}` : '';
  dom.skillsOpsText.textContent = `${label} · ${statusText} ${Math.min(done, total)}/${total}${failPart}`;
}

function beginSkillsOps(label, total = 1) {
  state.skillsOps = {
    active: true,
    total: Math.max(1, Number(total) || 1),
    done: 0,
    failed: 0,
    label: pickText(label, 'Skills 操作')
  };
  renderSkillsOpsStatus();
}

function tickSkillsOps(ok = true) {
  state.skillsOps.done += 1;
  if (!ok) state.skillsOps.failed += 1;
  renderSkillsOpsStatus();
}

function endSkillsOps(message, failed = false) {
  state.skillsOps.active = false;
  renderSkillsOpsStatus();
  if (message) {
    setMessage(dom.skillsMsg, message, failed ? 'error' : 'success', 5000);
  }
}

async function installSkill() {
  const slug = getCurrentSlug();
  if (!isValidSlug(slug)) {
    setMessage(dom.skillsMsg, '请输入有效 slug', 'error');
    return;
  }

  await withButtons(skillButtons(), async () => {
    beginSkillsOps(`安装 ${slug}`, 1);
    setMessage(dom.skillsMsg, `安装 ${slug}...`, 'info', 0);

    try {
      const payload = await apiJson('/api/skills/install', {
        method: 'POST',
        body: { slug }
      });
      appendTaskResult(payload.task);
      tickSkillsOps(true);
      endSkillsOps(`安装完成: ${slug}`, false);
      await refreshSkillsAndDashboard().catch(() => {});
    } catch (err) {
      tickSkillsOps(false);
      endSkillsOps(`安装失败: ${pickText(err?.message, 'unknown error')}`, true);
      throw err;
    }
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function installSkillZip() {
  const file = dom.skillZipInput?.files?.[0];
  if (!file) {
    setMessage(dom.skillsMsg, '请先选择 ZIP 包', 'error');
    return;
  }

  if (!/\.zip$/i.test(file.name)) {
    setMessage(dom.skillsMsg, '仅支持 .zip 文件', 'error');
    return;
  }

  await withButtons([dom.installSkillZipBtn], async () => {
    beginSkillsOps(`ZIP 安装 ${file.name}`, 1);
    setMessage(dom.skillsMsg, `上传并安装 ${file.name}...`, 'info', 0);

    try {
      const zipBase64 = arrayBufferToBase64(await file.arrayBuffer());
      const payload = await apiJson('/api/skills/install-zip', {
        method: 'POST',
        body: {
          fileName: file.name,
          zipBase64
        }
      });

      appendTaskResult(payload.task);
      if (dom.skillSlugInput && payload.slug) {
        dom.skillSlugInput.value = payload.slug;
      }

      if (dom.skillZipInput) dom.skillZipInput.value = '';

      tickSkillsOps(true);
      endSkillsOps(`ZIP 安装完成: ${pickText(payload.slug, file.name)}`, false);
      setMessage(
        dom.skillsMsg,
        `ZIP 安装完成: ${pickText(payload.slug, file.name)}，安装目录 ${pickText(payload.installPath, '-')}`,
        'success',
        7000
      );

      await refreshSkillsAndDashboard().catch(() => {});
    } catch (err) {
      tickSkillsOps(false);
      endSkillsOps(`ZIP 安装失败: ${pickText(err?.message, 'unknown error')}`, true);
      throw err;
    }
  });
}

async function updateSkill() {
  const slug = getCurrentSlug();
  if (!isValidSlug(slug)) {
    setMessage(dom.skillsMsg, '请输入有效 slug', 'error');
    return;
  }

  await withButtons(skillButtons(), async () => {
    beginSkillsOps(`更新 ${slug}`, 1);
    setMessage(dom.skillsMsg, `更新 ${slug}...`, 'info', 0);

    try {
      const payload = await apiJson('/api/skills/update', {
        method: 'POST',
        body: { slug }
      });
      appendTaskResult(payload.task);
      tickSkillsOps(true);
      endSkillsOps(`更新完成: ${slug}`, false);
      await refreshSkillsAndDashboard().catch(() => {});
    } catch (err) {
      tickSkillsOps(false);
      endSkillsOps(`更新失败: ${pickText(err?.message, 'unknown error')}`, true);
      throw err;
    }
  });
}

async function removeSkill() {
  const slug = getCurrentSlug();
  if (!isValidSlug(slug)) {
    setMessage(dom.skillsMsg, '请输入有效 slug', 'error');
    return;
  }

  if (!window.confirm(`确认卸载 ${slug}？这是危险操作。`)) return;

  await withButtons(skillButtons(), async () => {
    beginSkillsOps(`卸载 ${slug}`, 1);
    setMessage(dom.skillsMsg, `卸载 ${slug}...`, 'info', 0);

    try {
      const payload = await apiJson(`/api/skills/${encodeURIComponent(slug)}`, {
        method: 'DELETE'
      });
      appendTaskResult(payload.task);
      tickSkillsOps(true);
      endSkillsOps(`卸载完成: ${slug}`, false);
      await refreshSkillsAndDashboard().catch(() => {});
    } catch (err) {
      tickSkillsOps(false);
      endSkillsOps(`卸载失败: ${pickText(err?.message, 'unknown error')}`, true);
      throw err;
    }
  });
}

async function updateAllSkills() {
  if (!window.confirm('确认更新全部 Skills？')) return;

  await withButtons(skillButtons(), async () => {
    beginSkillsOps('更新全部 Skills', 1);
    setMessage(dom.skillsMsg, '更新全部 Skills 中...', 'info', 0);

    try {
      const payload = await apiJson('/api/skills/update', {
        method: 'POST',
        body: {}
      });
      appendTaskResult(payload.task);
      tickSkillsOps(true);
      endSkillsOps('全部 Skills 更新任务已提交', false);
      await refreshSkillsAndDashboard().catch(() => {});
    } catch (err) {
      tickSkillsOps(false);
      endSkillsOps(`更新全部失败: ${pickText(err?.message, 'unknown error')}`, true);
      throw err;
    }
  });
}

async function batchUpdateSkills() {
  const slugs = Array.from(state.selectedSkills);
  if (!slugs.length) {
    setMessage(dom.skillsMsg, '请先勾选要更新的 Skills', 'error');
    return;
  }

  await withButtons(skillButtons(), async () => {
    beginSkillsOps('批量更新 Skills', slugs.length);
    setMessage(dom.skillsMsg, `批量更新 ${slugs.length} 项...`, 'info', 0);

    try {
      const payload = await apiJson('/api/skills/batch-update', {
        method: 'POST',
        body: { slugs }
      });

      const rows = toArray(payload.results);
      rows.forEach((row) => {
        let ok = Boolean(row?.ok);
        if (row?.task) {
          appendTaskResult(row.task);
          const status = pickText(row.task?.status, '').toLowerCase();
          if (status) ok = !['failed', 'error'].includes(status);
        } else {
          state.batchResults.unshift({
            id: pickText(row?.slug, `batch-${Date.now()}`),
            type: 'skills.update',
            target: pickText(row?.slug),
            status: row?.ok ? 'success' : 'failed',
            message: pickText(row?.message, row?.error),
            error: pickText(row?.error),
            createdAt: new Date().toISOString()
          });
        }

        tickSkillsOps(ok);
      });

      const miss = Math.max(0, slugs.length - rows.length);
      for (let i = 0; i < miss; i += 1) tickSkillsOps(false);

      renderBatchResults();
      const doneMsg = `批量完成：成功 ${payload.success}，失败 ${payload.failed}`;
      endSkillsOps(doneMsg, Number(payload.failed) > 0);

      await refreshSkillsAndDashboard().catch(() => {});
    } catch (err) {
      const remain = Math.max(0, state.skillsOps.total - state.skillsOps.done);
      for (let i = 0; i < remain; i += 1) tickSkillsOps(false);
      endSkillsOps(`批量更新失败: ${pickText(err?.message, 'unknown error')}`, true);
      throw err;
    }
  });
}

function appendTaskResult(task) {
  if (!task || typeof task !== 'object') return;
  state.batchResults.unshift({ ...task });
  if (state.batchResults.length > 120) state.batchResults.length = 120;
  renderBatchResults();
}

function renderBatchResults() {
  if (!dom.batchResultList) return;
  dom.batchResultList.innerHTML = '';

  if (!state.batchResults.length) {
    dom.batchResultList.appendChild(buildEmpty('暂无批处理结果'));
    return;
  }

  state.batchResults.slice(0, 25).forEach((task) => {
    const item = document.createElement('div');
    item.className = 'list-item ripple-surface';

    const line = document.createElement('div');
    line.className = 'list-line';

    const left = document.createElement('strong');
    left.textContent = `${pickText(task.type, 'task')} · ${pickText(task.target, '-')}`;

    const badge = buildBadge(pickText(task.status, 'unknown'));

    const msg = document.createElement('small');
    msg.textContent = pickText(task.message, task.error, '-');

    line.append(left, badge);
    item.append(line, msg);
    dom.batchResultList.appendChild(item);
  });

  bindInteractiveSurfaces(dom.batchResultList);
}

async function refreshTrending() {
  setMessage(dom.contentMsg, '刷新热门中...', 'info', 0);
  const payload = await apiJson('/api/media/trending');
  state.trendingData = asObject(payload.data || payload);
  renderContentLists();
  setMessage(dom.contentMsg, '热门数据已刷新', 'success');
}

async function fetchWechatRecommendations(announce) {
  const query = pickText(dom.wechatSearchInput?.value, WECHAT_DEFAULT_QUERY);
  const params = new URLSearchParams();
  params.set('limit', String(WECHAT_RECO_LIMIT));
  params.set('q', query);

  await withButtons([dom.wechatSearchBtn], async () => {
    if (announce) setMessage(dom.contentMsg, '获取公众号推荐中...', 'info', 0);
    const payload = await apiJson(`/api/media/wechat/recommendations?${params.toString()}`);
    state.wechatRecommendations = toArray(payload.items);

    if (dom.wechatSearchInput && !pickText(dom.wechatSearchInput.value)) {
      dom.wechatSearchInput.value = pickText(payload.query, query);
    }

    renderContentLists();

    if (announce) {
      const warning = toArray(payload.warnings)[0];
      setMessage(
        dom.contentMsg,
        warning
          ? `已加载 ${state.wechatRecommendations.length} 条（${warning}）`
          : `已加载 ${state.wechatRecommendations.length} 条推荐`,
        warning ? 'info' : 'success',
        6000
      );
    }
  });
}

async function loadContentState() {
  const payload = await apiJson('/api/content/state');
  state.contentFavorites = toArray(payload.favorites);
  state.contentTopics = toArray(payload.topics);
  renderFavorites();
  renderTopics();
  renderContentLists();
}

function renderContentLists() {
  if (!dom.contentList) return;
  dom.contentList.innerHTML = '';

  const rows = currentContentItems();
  if (!rows.length) {
    dom.contentList.appendChild(buildEmpty('暂无内容'));
    return;
  }

  rows.forEach((item) => {
    const entry = normalizeContentItem(item, state.activeTab);
    const favorite = findFavorite(entry);

    const card = document.createElement('article');
    card.className = 'content-item ripple-surface';

    const title = document.createElement('h5');
    if (entry.url) {
      const link = document.createElement('a');
      link.href = entry.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = entry.title;
      title.appendChild(link);
    } else {
      title.textContent = entry.title;
    }

    const summary = document.createElement('small');
    summary.textContent = entry.summary || '-';

    const meta = document.createElement('small');
    meta.textContent = `${entry.platform} · ${pickText(entry.source, '-')}`;

    const actions = document.createElement('div');
    actions.className = 'content-actions';

    const favBtn = document.createElement('button');
    favBtn.textContent = favorite ? '取消收藏' : '收藏';
    favBtn.addEventListener('click', () => {
      toggleFavorite(entry, favorite).catch((err) => setMessage(dom.contentMsg, err.message, 'error'));
    });

    const noteInput = document.createElement('textarea');
    noteInput.className = 'content-note';
    noteInput.placeholder = '备注';
    noteInput.value = pickText(favorite?.note);

    const noteBtn = document.createElement('button');
    noteBtn.className = 'ghost';
    noteBtn.textContent = '保存备注';
    noteBtn.addEventListener('click', () => {
      saveContentNote(entry, favorite, noteInput.value).catch((err) => setMessage(dom.contentMsg, err.message, 'error'));
    });

    const topicBtn = document.createElement('button');
    topicBtn.className = 'ghost';
    topicBtn.textContent = '转为 Topic';
    topicBtn.addEventListener('click', () => {
      convertToTopic(entry, favorite, noteInput.value).catch((err) => setMessage(dom.contentMsg, err.message, 'error'));
    });

    actions.append(favBtn, noteBtn, topicBtn);
    card.append(title, summary, meta, actions, noteInput);
    dom.contentList.appendChild(card);
  });

  bindInteractiveSurfaces(dom.contentList);
}

function currentContentItems() {
  if (state.activeTab === 'wechat') {
    return state.wechatRecommendations;
  }
  const platform = asObject(state.trendingData)[state.activeTab];
  return toArray(platform?.articles);
}

function normalizeContentItem(item, platform) {
  const obj = asObject(item);
  return {
    id: pickText(obj.id),
    title: pickText(obj.title, obj.name, obj.topic, 'Untitled'),
    url: pickText(obj.url, obj.link, obj.href),
    summary: pickText(obj.summary, obj.idea, obj.tag),
    source: pickText(obj.source),
    platform: pickText(obj.platform, platform, 'unknown')
  };
}

function findFavorite(entry) {
  return (
    state.contentFavorites.find((row) => {
      if (!row) return false;
      if (pickText(row.id) && pickText(entry.id) && row.id === entry.id) return true;
      return (
        pickText(row.platform) === pickText(entry.platform) &&
        pickText(row.url) === pickText(entry.url) &&
        pickText(row.title) === pickText(entry.title)
      );
    }) || null
  );
}

async function toggleFavorite(entry, favorite) {
  if (favorite) {
    await apiJson('/api/content/unfavorite', {
      method: 'POST',
      body: { id: favorite.id }
    });
    setMessage(dom.contentMsg, '已取消收藏', 'success');
  } else {
    await apiJson('/api/content/favorite', {
      method: 'POST',
      body: { item: entry }
    });
    setMessage(dom.contentMsg, '收藏成功', 'success');
  }

  await loadContentState();
}

async function saveContentNote(entry, favorite, note) {
  await apiJson('/api/content/note', {
    method: 'POST',
    body: {
      id: favorite?.id,
      note: pickText(note),
      item: entry
    }
  });
  setMessage(dom.contentMsg, '备注已保存', 'success');
  await loadContentState();
}

async function convertToTopic(entry, favorite, note) {
  if (!window.confirm('确认将此内容转换为 Topic？')) return;

  await apiJson('/api/content/topic', {
    method: 'POST',
    body: {
      id: favorite?.id,
      item: entry,
      note: pickText(note)
    }
  });
  setMessage(dom.contentMsg, '已转换为 Topic', 'success');
  await loadContentState();
}

function renderFavorites() {
  if (!dom.favoritesList) return;
  dom.favoritesList.innerHTML = '';

  if (!state.contentFavorites.length) {
    dom.favoritesList.appendChild(buildEmpty('暂无收藏'));
    return;
  }

  state.contentFavorites.slice(0, 20).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-item ripple-surface';

    const line = document.createElement('div');
    line.className = 'list-line';

    const title = document.createElement('strong');
    title.textContent = pickText(item.title, 'Untitled');

    const meta = document.createElement('small');
    meta.textContent = `${pickText(item.platform, '-')} · ${formatTime(item.updatedAt)}`;

    const note = document.createElement('small');
    note.textContent = pickText(item.note, '-');

    line.append(title, meta);
    row.append(line, note);
    dom.favoritesList.appendChild(row);
  });

  bindInteractiveSurfaces(dom.favoritesList);
}

function renderTopics() {
  if (!dom.topicsList) return;
  dom.topicsList.innerHTML = '';

  if (!state.contentTopics.length) {
    dom.topicsList.appendChild(buildEmpty('暂无选题'));
    return;
  }

  state.contentTopics.slice(0, 20).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'list-item ripple-surface';

    const line = document.createElement('div');
    line.className = 'list-line';

    const title = document.createElement('strong');
    title.textContent = pickText(item.title, 'Untitled');

    const meta = document.createElement('small');
    meta.textContent = `${pickText(item.platform, '-')} · ${formatTime(item.createdAt)}`;

    const note = document.createElement('small');
    note.textContent = pickText(item.note, '-');

    line.append(title, meta);
    row.append(line, note);
    dom.topicsList.appendChild(row);
  });

  bindInteractiveSurfaces(dom.topicsList);
}


async function loadSquadState() {
  const payload = await apiJson('/api/squad/state');
  state.squad = {
    roles: toArray(payload.roles),
    tasks: toArray(payload.tasks),
    summary: asObject(payload.summary),
    warningRoles: toArray(payload.warningRoles),
    executor: asObject(payload.executor),
    causeLabels: asObject(payload.causeLabels),
    reporting: asObject(payload.reporting)
  };
  renderSquadState();
}

function renderSquadState() {
  renderSquadRoles();
  renderSquadLeaderboard();
  renderSquadTasks();
  renderSquadRoleSelectors();
}

function renderSquadRoles() {
  if (!dom.squadRoleBoard) return;
  dom.squadRoleBoard.innerHTML = '';

  const roles = toArray(state.squad.roles);
  const executor = state.squad.executor || {};
  const causeLabels = state.squad.causeLabels || {};
  if (!roles.length) {
    dom.squadRoleBoard.appendChild(buildEmpty('暂无角色数据'));
    return;
  }

  const executorItem = document.createElement('div');
  executorItem.className = 'list-item';
  const executorLine = document.createElement('small');
  const tickSec = Math.max(1, Math.round(Number(executor.tickMs || 0) / 1000));
  executorLine.textContent = `执行器：${executor.enabled ? '已启用' : '未启用'}｜tick ${tickSec}s｜最近心跳 ${formatTime(executor.lastTickAt)}｜自动闭环 ${formatNumber(executor.stats?.autoCompleted)} 次`;
  executorItem.append(executorLine);
  dom.squadRoleBoard.appendChild(executorItem);

  const reporting = state.squad.reporting || {};
  const alertRows = toArray(reporting.alerts).slice(0, 4).map((item) => pickText(item)).filter(Boolean);
  const digestRows = toArray(reporting.memoryDigest?.dailyBullets).map((item) => pickText(item)).filter(Boolean);
  const memoryRows = (digestRows.length ? digestRows : toArray(reporting.memoryTips)).slice(0, 3).map((item) => pickText(item)).filter(Boolean);
  if (pickText(reporting.liveBrief) || alertRows.length || memoryRows.length) {
    const reportItem = document.createElement('div');
    reportItem.className = 'list-item';

    if (pickText(reporting.liveBrief)) {
      const brief = document.createElement('small');
      brief.textContent = `实时播报：${pickText(reporting.liveBrief)}`;
      reportItem.append(brief);
    }

    if (alertRows.length) {
      const alert = document.createElement('small');
      alert.className = 'warning-text';
      alert.textContent = `风险提醒：${alertRows.join(' ｜ ')}`;
      reportItem.append(alert);
    }

    if (memoryRows.length) {
      const memo = document.createElement('small');
      memo.textContent = `记忆建议：${memoryRows.join(' ｜ ')}`;
      reportItem.append(memo);
    }

    const engine = document.createElement('small');
    engine.textContent = `播报引擎：${pickText(reporting.engine, 'unknown')} · ${formatTime(reporting.generatedAt)}`;
    reportItem.append(engine);

    dom.squadRoleBoard.appendChild(reportItem);
  }

  roles.forEach((role) => {
    const item = document.createElement('div');
    item.className = 'list-item ripple-surface';

    const line = document.createElement('div');
    line.className = 'list-line';

    const title = document.createElement('strong');
    title.textContent = `${pickText(role.name)} (${pickText(role.codename)})`;

    const blockedCount = Number(role.blockedTasks) || 0;
    const status = pickText(role.status, blockedCount > 0 || Number(role.score) < 60 ? 'warning' : 'active').toLowerCase();
    const badge = buildBadge(status);

    const pressureCount = Number(role.blockedPressure24h) || 0;
    const pressureMul = Number(role.blockedPenaltyMultiplier) || 1;
    const rewardStreak = Number(role.rewardStreak) || 0;
    const bestRewardStreak = Number(role.bestRewardStreak) || 0;
    const rewardPoints = Number(role.rewardPoints) || 0;
    const capabilityIndex = Number(role.capabilityIndex) || 0;

    const meta = document.createElement('small');
    meta.textContent = `${pickText(role.specialty)} · 评分 ${formatNumber(role.score)} · 能力指数 ${formatNumber(capabilityIndex)} · 历史失败 ${formatNumber(role.failureEvents)} · 连胜 ${formatNumber(rewardStreak)}(最高${formatNumber(bestRewardStreak)}) · 奖励积分 ${formatNumber(rewardPoints)} · 24h阻塞压力 ${formatNumber(pressureCount)} · 惩罚倍率 x${pressureMul.toFixed(2)}`;

    const stat = document.createElement('small');
    stat.textContent = `任务 ${formatNumber(role.totalTasks)}｜进行中 ${formatNumber(role.pendingTasks)}｜风险中 ${formatNumber(role.atRiskTasks)}｜阻塞 ${formatNumber(role.blockedTasks)}｜完成 ${formatNumber(role.doneTasks)}｜失败 ${formatNumber(role.failedTasks)}｜完成度 ${formatNumber(role.avgCompletion)}｜质量 ${formatNumber(role.avgQuality)}`;

    line.append(title, badge);
    item.append(line, meta, stat);

    if (status === 'warning') {
      const warn = document.createElement('small');
      warn.className = 'warning-text';
      const topCause = pickText(role.topBlockCause);
      const topCauseLabel = pickText(causeLabels[topCause], topCause, '-');
      warn.textContent =
        blockedCount > 0
          ? `⚠ 当前有 ${formatNumber(blockedCount)} 条阻塞任务（主因：${topCauseLabel}）：${pickText(role.reflection, '请立即排障并补充进度心跳')}`
          : `⚠ 低于60分：${pickText(role.reflection, '需提交自省与改进计划')}`;
      item.append(warn);
    }

    if (pickText(role.growthFocus)) {
      const growth = document.createElement('small');
      growth.textContent = `成长建议：${pickText(role.growthFocus)}`;
      item.append(growth);
    }

    dom.squadRoleBoard.appendChild(item);
  });

  bindInteractiveSurfaces(dom.squadRoleBoard);
}

function renderSquadLeaderboard() {
  if (!dom.squadLeaderboard) return;
  dom.squadLeaderboard.innerHTML = '';

  const roles = toArray(state.squad.roles)
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  if (!roles.length) {
    dom.squadLeaderboard.appendChild(buildEmpty('暂无排行数据'));
    return;
  }

  roles.forEach((role, idx) => {
    const item = document.createElement('div');
    item.className = 'list-item ripple-surface';

    const line = document.createElement('div');
    line.className = 'list-line';

    const title = document.createElement('strong');
    title.textContent = `#${idx + 1} ${pickText(role.name)}`;

    const badge = buildBadge(Number(role.score) < 60 ? 'warning' : 'ok');
    badge.textContent = `${formatNumber(role.score)}分`;

    const meta = document.createElement('small');
    meta.textContent = `${pickText(role.codename)} · ${pickText(role.vibe)}`;

    line.append(title, badge);
    item.append(line, meta);
    dom.squadLeaderboard.appendChild(item);
  });

  bindInteractiveSurfaces(dom.squadLeaderboard);
}

function renderSquadTasks() {
  if (!dom.squadTaskBoard) return;
  dom.squadTaskBoard.innerHTML = '';

  const tasks = toArray(state.squad.tasks);
  const causeLabels = state.squad.causeLabels || {};
  if (!tasks.length) {
    dom.squadTaskBoard.appendChild(buildEmpty('暂无任务，先创建一条吧'));
    return;
  }

  tasks.slice(0, 25).forEach((task) => {
    const item = document.createElement('div');
    item.className = 'list-item ripple-surface';

    const line = document.createElement('div');
    line.className = 'list-line';

    const title = document.createElement('strong');
    title.textContent = `${pickText(task.title)} · ${pickText(task.roleName)}`;

    const taskStatus = pickText(task.status, 'pending').toLowerCase();
    const badge = buildBadge(taskStatus);
    if (pickText(task.runtimeRisk).toLowerCase() === 'at-risk' && taskStatus === 'running') {
      badge.className = 'badge warning';
      badge.textContent = 'at-risk';
    }

    const detail = document.createElement('small');
    const relation = pickText(task.relationType, 'primary') === 'linked' ? '协同子任务' : '主任务';
    detail.textContent = `ID ${pickText(task.id)} · ${relation} · 权重 ${formatNumber(task.weight)} · Δ ${Number(task.scoreDelta) > 0 ? '+' : ''}${formatNumber(task.scoreDelta)}`;

    const judge = document.createElement('small');
    const reviewText =
      taskStatus === 'completed'
        ? '已通过'
        : taskStatus === 'failed'
          ? '已失败'
          : taskStatus === 'blocked'
            ? '已阻塞'
            : taskStatus === 'running'
              ? '进行中'
              : '待处理';
    judge.textContent = `进度 ${formatNumber(task.progressPercent)}%｜完成度 ${formatNumber(task.completion)}｜质量 ${formatNumber(task.quality)}｜${reviewText}`;

    line.append(title, badge);
    item.append(line, detail, judge);

    if (pickText(task.description)) {
      const desc = document.createElement('small');
      desc.textContent = task.description;
      item.append(desc);
    }

    if (pickText(task.assignmentReason)) {
      const reason = document.createElement('small');
      reason.textContent = `路由依据：${task.assignmentReason}`;
      item.append(reason);
    }

    const rewardBonus = Number(task.rewardBonus) || 0;
    if (rewardBonus > 0 || pickText(task.rewardReason)) {
      const reward = document.createElement('small');
      reward.textContent = `奖励 +${formatNumber(rewardBonus)}｜${pickText(task.rewardReason, '高质量执行奖励')}`;
      item.append(reward);
    }

    if (pickText(task.blockedRootCause) || pickText(task.recoveryHint)) {
      const diagnosis = document.createElement('small');
      const reasonCode = pickText(task.blockedReasonCode);
      const reasonLabel = pickText(causeLabels[reasonCode], reasonCode);
      diagnosis.textContent = `阻塞诊断：${pickText(task.blockedRootCause, '-')}`;
      if (reasonLabel) diagnosis.textContent = `阻塞诊断(${reasonLabel})：${pickText(task.blockedRootCause, '-')}`;
      if (pickText(task.recoveryHint)) {
        diagnosis.textContent += `｜改进建议：${pickText(task.recoveryHint)}`;
      }
      item.append(diagnosis);
    }

    const runtime = document.createElement('small');
    const heartbeatLagMs = Date.now() - parseDateMs(pickText(task.lastHeartbeatAt, task.createdAt));
    const heartbeatLagMin = heartbeatLagMs > 0 ? Math.floor(heartbeatLagMs / 60000) : 0;
    const runtimeParts = [
      `开始 ${formatTime(task.startedAt || task.createdAt)}`,
      `最近心跳 ${formatTime(task.lastHeartbeatAt || task.createdAt)}`,
      `静默 ${heartbeatLagMin} 分钟`
    ];
    if (pickText(task.runtimeRisk)) runtimeParts.push(`风险态：${pickText(task.runtimeRisk)} ${pickText(task.riskReason)}`);
    if (pickText(task.stalledReason)) runtimeParts.push(`阻塞原因：${pickText(task.stalledReason)}`);
    if (pickText(task.progressNote)) runtimeParts.push(`进展：${pickText(task.progressNote)}`);
    runtime.textContent = runtimeParts.join('｜');
    item.append(runtime);

    if (['running', 'blocked', 'pending'].includes(taskStatus)) {
      const actions = document.createElement('div');
      actions.className = 'row';

      const heartbeatBtn = document.createElement('button');
      heartbeatBtn.textContent = taskStatus === 'blocked' ? '恢复并上报进度' : '上报进度心跳';
      heartbeatBtn.addEventListener('click', () => {
        reportSquadTaskHeartbeat(task).catch((err) => setMessage(dom.squadMsg, err.message, 'error'));
      });

      const useForReviewBtn = document.createElement('button');
      useForReviewBtn.textContent = '填入评分ID';
      useForReviewBtn.addEventListener('click', () => {
        if (dom.squadReviewTaskIdInput) dom.squadReviewTaskIdInput.value = pickText(task.id);
        setMessage(dom.squadMsg, `已填入任务ID：${pickText(task.id)}`, 'info');
      });

      actions.append(heartbeatBtn, useForReviewBtn);
      item.append(actions);
    }

    dom.squadTaskBoard.appendChild(item);
  });

  bindInteractiveSurfaces(dom.squadTaskBoard);
}

function renderSquadRoleSelectors() {
  const roles = toArray(state.squad.roles);

  if (dom.squadTaskRoleSelect) {
    const current = pickText(dom.squadTaskRoleSelect.value);
    dom.squadTaskRoleSelect.innerHTML = '';

    const autoOpt = document.createElement('option');
    autoOpt.value = 'auto';
    autoOpt.textContent = '自动路由（关键词 + 负载）';
    dom.squadTaskRoleSelect.appendChild(autoOpt);

    roles.forEach((role) => {
      const opt = document.createElement('option');
      opt.value = pickText(role.id);
      opt.textContent = `${pickText(role.name)} (${pickText(role.codename)})`;
      dom.squadTaskRoleSelect.appendChild(opt);
    });

    if (current === 'auto' || !current) {
      dom.squadTaskRoleSelect.value = 'auto';
    } else if (roles.some((r) => r.id === current)) {
      dom.squadTaskRoleSelect.value = current;
    } else {
      dom.squadTaskRoleSelect.value = 'auto';
    }
  }

  if (dom.squadReflectionRoleSelect) {
    const current = pickText(dom.squadReflectionRoleSelect.value);
    dom.squadReflectionRoleSelect.innerHTML = '';

    const first = document.createElement('option');
    first.value = '';
    first.textContent = '选择提交自省的角色';
    dom.squadReflectionRoleSelect.appendChild(first);

    roles.forEach((role) => {
      const opt = document.createElement('option');
      opt.value = pickText(role.id);
      opt.textContent = `${pickText(role.name)} (${pickText(role.codename)})`;
      dom.squadReflectionRoleSelect.appendChild(opt);
    });

    if (current && roles.some((r) => r.id === current)) {
      dom.squadReflectionRoleSelect.value = current;
    } else if (!current && roles[0]) {
      dom.squadReflectionRoleSelect.value = roles[0].id;
    }
  }
}

async function syncSquadReportingMemory() {
  await withButtons([dom.squadSyncMemoryBtn], async () => {
    setMessage(dom.squadMsg, '记忆同步中...', 'info', 0);
    const payload = await apiJson('/api/squad/reporting/sync-memory', {
      method: 'POST',
      body: {
        source: 'ui.manual'
      }
    });

    await Promise.allSettled([loadSquadState(), loadDashboardSummary()]);

    const dedup = payload?.dedupHit === true;
    const dailyPath = pickText(payload?.dailyMemoryPath, '-');
    const archivePath = pickText(payload?.blockedArchivePath);
    const wroteDaily = Number(payload?.wrote?.daily) || 0;
    const wroteBlocked = Number(payload?.wrote?.blocked) || 0;
    const archiveText = archivePath ? `；阻塞归档 ${archivePath}` : '';

    if (dedup) {
      setMessage(dom.squadMsg, `记忆同步命中去重：${dailyPath}${archiveText}`, 'info');
      return;
    }

    setMessage(dom.squadMsg, `记忆已同步：${dailyPath}（写入 ${wroteDaily} 行，阻塞 ${wroteBlocked} 条）${archiveText}`, 'success');
  });
}

async function createSquadTask() {
  const title = pickText(dom.squadTaskTitleInput?.value);
  const roleId = pickText(dom.squadTaskRoleSelect?.value, 'auto');
  const description = pickText(dom.squadTaskDescInput?.value);
  const weight = Number(dom.squadTaskWeightInput?.value || 1);

  if (!title) {
    setMessage(dom.squadMsg, '请先输入任务标题', 'error');
    return;
  }

  await withButtons([dom.squadCreateTaskBtn], async () => {
    setMessage(dom.squadMsg, '任务派发中...', 'info', 0);
    const payload = await apiJson('/api/squad/task', {
      method: 'POST',
      body: {
        title,
        roleId,
        description,
        weight
      }
    });

    if (dom.squadTaskTitleInput) dom.squadTaskTitleInput.value = '';
    if (dom.squadTaskDescInput) dom.squadTaskDescInput.value = '';
    if (dom.squadReviewTaskIdInput) dom.squadReviewTaskIdInput.value = pickText(payload.task?.id);

    await Promise.allSettled([loadSquadState(), loadDashboardSummary()]);
    const routedRole = pickText(payload.task?.roleName, payload.task?.roleId, '自动路由');
    const routedReason = pickText(payload.task?.assignmentReason);
    const linkedTasks = toArray(payload.linkedTasks);
    const linkedRoleNames = linkedTasks.map((row) => pickText(row.roleName)).filter(Boolean);
    const linkedHint = linkedRoleNames.length ? `；已联动：${linkedRoleNames.join('、')}` : '';
    const resultText = routedReason
      ? `已派发任务：${title} -> ${routedRole}（${routedReason}）${linkedHint}`
      : `已派发任务：${title} -> ${routedRole}${linkedHint}`;
    setMessage(dom.squadMsg, resultText, 'success');
  });
}

async function reportSquadTaskHeartbeat(task) {
  const taskId = pickText(task?.id);
  if (!taskId) {
    setMessage(dom.squadMsg, '任务ID缺失，无法上报心跳', 'error');
    return;
  }

  const currentProgress = Math.max(0, Math.min(99, Number(task?.progressPercent) || 0));
  const progressInput = window.prompt('请输入当前进度（0-99）', String(Math.max(currentProgress, 10)));
  if (progressInput === null) return;

  const progressPercent = Number(progressInput);
  if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 99) {
    setMessage(dom.squadMsg, '进度必须是 0-99 的数字', 'error');
    return;
  }

  const noteInput = window.prompt('请输入进展备注（可选）', pickText(task?.progressNote));
  const note = noteInput === null ? '' : pickText(noteInput);

  setMessage(dom.squadMsg, '心跳上报中...', 'info', 0);
  await apiJson(`/api/squad/task/${encodeURIComponent(taskId)}/heartbeat`, {
    method: 'POST',
    body: { progressPercent, note }
  });

  await Promise.allSettled([loadSquadState(), loadDashboardSummary()]);
  setMessage(dom.squadMsg, `已上报心跳：${pickText(task.title)} -> ${formatNumber(progressPercent)}%`, 'success');
}

async function submitSquadReview() {
  const taskId = pickText(dom.squadReviewTaskIdInput?.value);
  if (!taskId) {
    setMessage(dom.squadMsg, '请输入任务ID', 'error');
    return;
  }

  const completion = Number(dom.squadReviewCompletionInput?.value || 0);
  const quality = Number(dom.squadReviewQualityInput?.value || 0);
  const ownerScore = Number(dom.squadReviewOwnerInput?.value || 0);
  const captainScore = Number(dom.squadReviewCaptainInput?.value || 0);
  const passed = pickText(dom.squadReviewPassedSelect?.value, 'true') === 'true';
  const reviewNote = pickText(dom.squadReviewNoteInput?.value);

  await withButtons([dom.squadSubmitReviewBtn], async () => {
    setMessage(dom.squadMsg, '评分提交中...', 'info', 0);
    const payload = await apiJson(`/api/squad/task/${encodeURIComponent(taskId)}/review`, {
      method: 'POST',
      body: {
        completion,
        quality,
        ownerScore,
        captainScore,
        passed,
        reviewNote
      }
    });

    await Promise.allSettled([loadSquadState(), loadDashboardSummary()]);
    const roleName = pickText(payload.role?.name, payload.role?.codename, '角色');
    setMessage(dom.squadMsg, `评分完成：${roleName} 当前 ${formatNumber(payload.role?.score)} 分`, 'success');
  });
}

async function submitSquadReflection() {
  const roleId = pickText(dom.squadReflectionRoleSelect?.value);
  const reflection = pickText(dom.squadReflectionText?.value);

  if (!roleId) {
    setMessage(dom.squadMsg, '请选择角色', 'error');
    return;
  }
  if (!reflection) {
    setMessage(dom.squadMsg, '请填写自省内容', 'error');
    return;
  }

  await withButtons([dom.squadSubmitReflectionBtn], async () => {
    setMessage(dom.squadMsg, '自省提交中...', 'info', 0);
    await apiJson(`/api/squad/role/${encodeURIComponent(roleId)}/reflection`, {
      method: 'POST',
      body: { reflection }
    });

    if (dom.squadReflectionText) dom.squadReflectionText.value = '';
    await Promise.allSettled([loadSquadState(), loadDashboardSummary()]);
    setMessage(dom.squadMsg, '已提交自省，积分模型已更新', 'success');
  });
}

function renderTaskList(container, rows, options = {}) {
  if (!container) return;
  container.innerHTML = '';

  const list = toArray(rows);
  if (!list.length) {
    container.appendChild(buildEmpty(options.emptyText || '暂无数据'));
    return;
  }

  list.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'list-item ripple-surface';

    const line = document.createElement('div');
    line.className = 'list-line';

    const title = document.createElement('strong');
    title.textContent = pickText(row.type, row.action, row.target, '-');

    const badge = buildBadge(pickText(row.status, 'info'));

    const detail = document.createElement('small');
    detail.textContent = `${pickText(row.message, row.error, '-')}${row.createdAt ? ` · ${formatTime(row.createdAt)}` : ''}`;

    line.append(title, badge);
    item.append(line, detail);
    container.appendChild(item);
  });

  bindInteractiveSurfaces(container);
}

function renderKeyValue(container, map) {
  if (!container) return;
  container.innerHTML = '';

  Object.entries(asObject(map)).forEach(([key, value]) => {
    const row = document.createElement('div');
    row.className = 'kv-item';

    const keyEl = document.createElement('span');
    keyEl.className = 'kv-key';
    keyEl.textContent = key;

    const valEl = document.createElement('span');
    valEl.className = 'kv-val';
    valEl.textContent = pickText(value, '-');

    row.append(keyEl, valEl);
    container.appendChild(row);
  });
}

function textCell(text) {
  const el = document.createElement('span');
  el.textContent = pickText(text, '-');
  return el;
}

function buildBadge(statusInput) {
  const status = pickText(statusInput, 'unknown').toLowerCase();
  const badge = document.createElement('span');
  badge.className = `badge ${status}`;
  badge.textContent = status;
  return badge;
}

function buildEmpty(text) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = pickText(text, '暂无数据');
  return empty;
}

function formatTime(input) {
  const ms = parseDateMs(input);
  if (!ms) return '-';
  return new Date(ms).toLocaleString();
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n));
}

function parseDateMs(input) {
  const t = Date.parse(String(input || ''));
  return Number.isFinite(t) ? t : 0;
}

function humanizeRuntimeZh(secondsInput) {
  const totalSeconds = Math.max(0, Math.floor(Number(secondsInput) || 0));
  const month = 30 * 24 * 60 * 60;
  const day = 24 * 60 * 60;
  const hour = 60 * 60;
  const minute = 60;

  let rest = totalSeconds;
  const months = Math.floor(rest / month);
  rest -= months * month;
  const days = Math.floor(rest / day);
  rest -= days * day;
  const hours = Math.floor(rest / hour);
  rest -= hours * hour;
  const minutes = Math.floor(rest / minute);

  const parts = [];
  if (months) parts.push(`${months}月`);
  if (days) parts.push(`${days}天`);
  if (hours) parts.push(`${hours}小时`);
  if (minutes) parts.push(`${minutes}分钟`);

  return parts.length ? parts.join('') : '不足1分钟';
}

function syncLanHint() {
  const host = window.location.host || '-';
  if (dom.lanHint) dom.lanHint.textContent = `LAN: ${host}`;
}

function pickText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
  }
  return '';
}

function asObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input;
}

function toArray(input) {
  return Array.isArray(input) ? input : [];
}

function shrink(textInput, maxLen = 220) {
  const text = String(textInput || '').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setMessage(el, message, type = 'info', holdMs = 3500) {
  if (!el) return;

  const text = pickText(message);
  el.textContent = text;
  el.classList.remove('error', 'success', 'info');
  el.classList.add(type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');

  const oldTimer = msgTimers.get(el);
  if (oldTimer) {
    clearTimeout(oldTimer);
    msgTimers.delete(el);
  }

  if (!holdMs || holdMs <= 0) return;

  const timer = setTimeout(() => {
    if (el.textContent === text) {
      el.textContent = '';
      el.classList.remove('error', 'success');
      el.classList.add('info');
    }
    msgTimers.delete(el);
  }, holdMs);

  msgTimers.set(el, timer);
}

function clearMessageTimers() {
  msgTimers.forEach((timer) => clearTimeout(timer));
  msgTimers.clear();
}

function registerCleanup(fn) {
  if (typeof fn !== 'function') return;
  state.cleanupFns.push(fn);
}

async function withButtons(buttons, task) {
  const list = toArray(buttons).filter(Boolean);
  list.forEach((btn) => {
    btn.disabled = true;
  });
  try {
    return await task();
  } finally {
    list.forEach((btn) => {
      btn.disabled = false;
    });
  }
}

function loadToken() {
  try {
    return localStorage.getItem('openclaw_console_token') || '';
  } catch {
    return '';
  }
}

function saveToken(token) {
  try {
    localStorage.setItem('openclaw_console_token', token);
  } catch {
    // ignore
  }
}

function clearToken() {
  try {
    localStorage.removeItem('openclaw_console_token');
  } catch {
    // ignore
  }
}

async function apiJson(url, options = {}) {
  const auth = options.auth !== false;
  const init = { method: 'GET', ...options };
  delete init.auth;

  const headers = new Headers(options.headers || {});
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (auth && state.token) headers.set('Authorization', `Bearer ${state.token}`);

  if (init.body !== undefined && init.body !== null && !(init.body instanceof FormData)) {
    if (typeof init.body !== 'string') init.body = JSON.stringify(init.body);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }

  init.headers = headers;

  let response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new Error(`网络错误: ${pickText(err?.message, String(err))}`);
  }

  let raw = '';
  try {
    raw = await response.text();
  } catch {
    raw = '';
  }

  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }

  if (response.status === 401 && auth) {
    clearToken();
    state.token = '';
    setAuthenticated(false);
    clearDashboardAutoTimer();
    renderDashboardAutoRefreshHint();
    throw new Error('登录已失效，请重新登录');
  }

  if (!response.ok || parsed.ok === false) {
    const message =
      pickText(parsed?.error?.message, parsed?.error, parsed?.message, parsed?.msg) ||
      pickText(raw) ||
      `请求失败 (${response.status})`;
    throw new Error(shrink(message, 240));
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'data')) {
    return parsed.data;
  }

  return parsed;
}

function cleanupAppLifecycle() {
  clearDashboardAutoTimer();

  if (state.particle.rafId) {
    cancelAnimationFrame(state.particle.rafId);
    state.particle.rafId = 0;
  }

  while (state.cleanupFns.length) {
    const fn = state.cleanupFns.pop();
    try {
      fn();
    } catch {
      // ignore cleanup errors
    }
  }

  clearMessageTimers();
}

function bindMouseGlow() {
  if (!dom.mouseGlow) return;

  const onPointerMove = (event) => {
    dom.mouseGlow?.classList.add('active');
    if (!dom.mouseGlow) return;
    dom.mouseGlow.style.left = `${event.clientX}px`;
    dom.mouseGlow.style.top = `${event.clientY}px`;
  };

  const onPointerLeave = () => {
    dom.mouseGlow?.classList.remove('active');
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', onPointerLeave);

  registerCleanup(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerleave', onPointerLeave);
  });
}

function initParticleBackground() {
  const canvas = dom.particleCanvas;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const motionQuery =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  const stopLoop = () => {
    if (!state.particle.rafId) return;
    cancelAnimationFrame(state.particle.rafId);
    state.particle.rafId = 0;
  };

  const resetParticles = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const count = Math.max(40, Math.min(130, Math.floor((width * height) / 18000)));
    const particles = [];

    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.32,
        vy: (Math.random() - 0.5) * 0.32,
        r: Math.random() * 1.8 + 0.6,
        a: Math.random() * 0.6 + 0.2
      });
    }

    state.particle.particles = particles;
  };

  const draw = () => {
    if (state.particle.reducedMotion || document.hidden) {
      stopLoop();
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const particles = state.particle.particles;
    const maxDist = 120;
    const maxDist2 = maxDist * maxDist;

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -10 || p.x > width + 10) p.vx *= -1;
      if (p.y < -10 || p.y > height + 10) p.vy *= -1;

      ctx.beginPath();
      ctx.fillStyle = `rgba(120, 224, 255, ${p.a})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < particles.length; i += 1) {
      for (let j = i + 1; j < particles.length; j += 1) {
        const p1 = particles[i];
        const p2 = particles[j];
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > maxDist2) continue;

        const alpha = (1 - dist2 / maxDist2) * 0.18;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(110, 247, 195, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }

    state.particle.rafId = requestAnimationFrame(draw);
  };

  const startLoop = () => {
    if (state.particle.reducedMotion || document.hidden) return;
    if (state.particle.rafId) return;
    state.particle.rafId = requestAnimationFrame(draw);
  };

  const syncMotionPreference = () => {
    state.particle.reducedMotion = Boolean(motionQuery?.matches);
    canvas.style.display = state.particle.reducedMotion ? 'none' : '';

    if (state.particle.reducedMotion) {
      stopLoop();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    if (!canvas.width || !canvas.height) {
      resetParticles();
    }

    startLoop();
  };

  const onResize = () => {
    resetParticles();
    startLoop();
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      stopLoop();
      return;
    }

    startLoop();
  };

  const onMotionChange = () => syncMotionPreference();

  resetParticles();
  syncMotionPreference();

  window.addEventListener('resize', onResize, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);

  if (motionQuery) {
    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', onMotionChange);
    } else if (typeof motionQuery.addListener === 'function') {
      motionQuery.addListener(onMotionChange);
    }
  }

  registerCleanup(() => {
    stopLoop();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);

    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === 'function') {
        motionQuery.removeEventListener('change', onMotionChange);
      } else if (typeof motionQuery.removeListener === 'function') {
        motionQuery.removeListener(onMotionChange);
      }
    }
  });
}

function bindInteractiveSurfaces(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  root.querySelectorAll('[data-tilt]').forEach((card) => {
    if (card.dataset.tiltBound === '1') return;
    card.dataset.tiltBound = '1';

    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      card.style.setProperty('--mx', `${(px * 100).toFixed(2)}%`);
      card.style.setProperty('--my', `${(py * 100).toFixed(2)}%`);

      const rx = ((0.5 - py) * 8).toFixed(2);
      const ry = ((px - 0.5) * 10).toFixed(2);
      card.style.setProperty('--rzx', `${rx}deg`);
      card.style.setProperty('--rzy', `${ry}deg`);
    });

    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rzx', '0deg');
      card.style.setProperty('--rzy', '0deg');
      card.style.setProperty('--mx', '50%');
      card.style.setProperty('--my', '50%');
    });
  });

  root.querySelectorAll('.ripple-surface').forEach((node) => {
    if (node.dataset.rippleBound === '1') return;
    node.dataset.rippleBound = '1';

    node.addEventListener('click', (event) => {
      const rect = node.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
      node.appendChild(ripple);
      setTimeout(() => ripple.remove(), 620);
    });
  });
}
