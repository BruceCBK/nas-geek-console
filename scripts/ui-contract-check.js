#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'public', 'index.html');
const APP_PATH = path.join(ROOT, 'public', 'app.js');

// UI contract v3: dashboard fusion signals + skills + content
const requiredIds = [
  // auth shell
  'loginOverlay',
  'loginPassword',
  'loginBtn',
  'logoutBtn',
  'lanHint',

  // visual deck
  'mouseGlow',
  'particleCanvas',

  // views
  'dashboardView',
  'skillsView',
  'squadView',
  'contentView',

  // dashboard
  'dashboardRefreshBtn',
  'dashboardAutoRefreshToggle',
  'dashboardAutoRefreshInterval',
  'dashboardAutoRefreshHint',
  'healthCard',
  'modelSwitchSelect',
  'modelSwitchApplyBtn',
  'modelSummaryCard',
  'skillsSummaryCard',
  'gatewaySummaryCard',
  'runtimeSummaryCard',
  'fusionSummaryCard',
  'dashboardRecentTasks',
  'dashboardFusionAlerts',
  'dashboardActionPlan',
  'dashboardRecentLogs',
  'dashboardRecentChanges',
  'dashboardMsg',
  'quickServiceStatusBtn',
  'quickServiceStartBtn',
  'quickServiceRestartBtn',
  'quickServiceStopBtn',

  // skills center
  'skillsSearchInput',
  'skillsStatusFilter',
  'skillsSearchBtn',
  'refreshSkillsBtn',
  'skillSlugInput',
  'installSkillBtn',
  'updateSkillBtn',
  'removeSkillBtn',
  'updateAllSkillsBtn',
  'batchUpdateBtn',
  'skillZipInput',
  'installSkillZipBtn',
  'skillsList',
  'batchResultList',
  'skillsSearchLinks',
  'skillsMsg',
  'skillsOpsStatus',
  'skillsOpsProgressBar',
  'skillsOpsText',

  // lobster squad
  'squadRefreshBtn',
  'squadSyncMemoryBtn',
  'squadRoleBoard',
  'squadLeaderboard',
  'squadTaskBoard',
  'squadTaskSyncNowBtn',
  'squadTaskPageSizeSelect',
  'squadTaskPrevBtn',
  'squadTaskNextBtn',
  'squadTaskPageInfo',
  'squadTaskTitleInput',
  'squadTaskDescInput',
  'squadTaskWeightInput',
  'squadCreateTaskBtn',
  'squadMsg',

  // content studio
  'wechatSearchInput',
  'wechatSearchBtn',
  'refreshTrendingBtn',
  'contentMsg',
  'contentList',
  'favoritesList',
  'topicsList'
];

const requiredAppHooks = [
  'function init()',
  'async function verifySessionAndLoad()',
  'async function loadDashboardSummary()',
  'function renderDashboardMonitor(',
  'function renderV3Fusion(',
  'function scheduleDashboardAutoRefresh(',
  'function renderDashboardAutoRefreshHint()',
  'function mapLobsterServiceState(',
  'async function fetchOpenClawServiceStatus()',
  'async function startOpenClawService()',
  'async function restartOpenClawService()',
  'async function stopOpenClawService()',
  'async function loadSkills()',
  'async function loadSquadState(options = {})',
  'function renderSquadState()',
  'function renderSkillTable()',
  'function renderSkillsOpsStatus()',
  'async function installSkill()',
  'async function installSkillZip()',
  'async function fetchWechatRecommendations(',
  'async function loadContentState()',
  'function renderContentLists()',
  'function cleanupAppLifecycle()'
];

function checkIds(html) {
  const idSet = extractIdSet(html);
  return requiredIds.filter((id) => !idSet.has(id));
}

function extractIdSet(html) {
  const ids = new Set();
  const re = /\bid\s*=\s*['\"]([^'\"]+)['\"]/g;
  let match = null;
  while ((match = re.exec(html))) {
    ids.add(match[1]);
  }
  return ids;
}

function findDuplicateIds(html) {
  const count = new Map();
  const re = /\bid\s*=\s*['\"]([^'\"]+)['\"]/g;
  let match = null;
  while ((match = re.exec(html))) {
    const key = match[1];
    count.set(key, (count.get(key) || 0) + 1);
  }
  return Array.from(count.entries())
    .filter(([, value]) => value > 1)
    .map(([id, value]) => ({ id, count: value }));
}

function checkHooks(js) {
  return requiredAppHooks.filter((marker) => !js.includes(marker));
}

function checkSelectors(html) {
  const missing = [];

  if (!/class=['\"][^'\"]*nav-btn[^'\"]*['\"][^>]*data-view=['\"][^'\"]+['\"]/.test(html)) {
    missing.push('expected at least one .nav-btn[data-view] control');
  }

  if (!/class=['\"][^'\"]*tab-btn[^'\"]*['\"][^>]*data-tab=['\"][^'\"]+['\"]/.test(html)) {
    missing.push('expected at least one .tab-btn[data-tab] control');
  }

  return missing;
}

function main() {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const js = fs.readFileSync(APP_PATH, 'utf8');

  const missingIds = checkIds(html);
  const duplicateIds = findDuplicateIds(html);
  const missingHooks = checkHooks(js);
  const selectorContractIssues = checkSelectors(html);

  if (missingIds.length || duplicateIds.length || missingHooks.length || selectorContractIssues.length) {
    console.error('UI contract check failed.');

    if (duplicateIds.length) {
      console.error('Duplicate DOM ids:');
      for (const row of duplicateIds) console.error(`- ${row.id} (${row.count})`);
    }

    if (missingIds.length) {
      console.error('Missing DOM ids:');
      for (const id of missingIds) console.error(`- ${id}`);
    }

    if (missingHooks.length) {
      console.error('Missing app hooks:');
      for (const hook of missingHooks) console.error(`- ${hook}`);
    }

    if (selectorContractIssues.length) {
      console.error('Selector contract issues:');
      for (const issue of selectorContractIssues) console.error(`- ${issue}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log('UI contract check passed.');
}

main();
