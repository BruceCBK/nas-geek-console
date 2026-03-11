const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  HOME,
  OPENCLAW_BIN,
  CLAWHUB_BIN,
  OPENCLAW_CONFIG,
  OPENCLAW_CONFIG_BACKUP_DIR
} = require('../config/paths');
const { HttpError } = require('../utils/http-error');

const run = promisify(execFile);
const OPENCLAW_SERVICE_NAME = 'openclaw';
const SKILLS_LOCAL_DIR = '/home/openclaw/skills';
const STATE_RUNNING = 'running';
const STATE_STARTING = 'starting';
const STATE_STOPPED = 'stopped';
const STATE_ERROR = 'error';
const STATE_UNKNOWN = 'unknown';
const OPENCLAW_EDITABLE_CONFIG_SPECS = [
  {
    path: 'agents.defaults.model.primary',
    label: 'Primary Model',
    type: 'string'
  },
  {
    path: 'agents.defaults.thinkingDefault',
    label: 'Thinking Default',
    type: 'string'
  },
  {
    path: 'models.mode',
    label: 'Models Mode',
    type: 'string'
  }
];

const SERVICE_STATE_PRESETS = {
  [STATE_RUNNING]: {
    stateCode: STATE_RUNNING,
    stateLabel: '运行中',
    description: 'OpenClaw 服务已在线并稳定运行'
  },
  [STATE_STARTING]: {
    stateCode: STATE_STARTING,
    stateLabel: '启动中',
    description: 'OpenClaw 服务正在启动或重载'
  },
  [STATE_STOPPED]: {
    stateCode: STATE_STOPPED,
    stateLabel: '已停止',
    description: 'OpenClaw 服务当前未运行'
  },
  [STATE_ERROR]: {
    stateCode: STATE_ERROR,
    stateLabel: '异常',
    description: 'OpenClaw 服务状态异常，请检查日志'
  },
  [STATE_UNKNOWN]: {
    stateCode: STATE_UNKNOWN,
    stateLabel: '状态采集中',
    description: '暂未获取到完整服务遥测'
  }
};

const GATEWAY_STATE_PRESETS = {
  [STATE_RUNNING]: {
    stateCode: STATE_RUNNING,
    stateLabel: '在线',
    description: 'Gateway 遥测正常'
  },
  [STATE_STARTING]: {
    stateCode: STATE_STARTING,
    stateLabel: '初始化中',
    description: 'Gateway 正在启动或热更新'
  },
  [STATE_STOPPED]: {
    stateCode: STATE_STOPPED,
    stateLabel: '离线',
    description: 'Gateway 未在线'
  },
  [STATE_ERROR]: {
    stateCode: STATE_ERROR,
    stateLabel: '异常',
    description: 'Gateway 出现错误或崩溃'
  },
  [STATE_UNKNOWN]: {
    stateCode: STATE_UNKNOWN,
    stateLabel: '状态暂不可用（等待网关遥测）',
    description: '未读取到网关状态，已启用兜底文案'
  }
};

function nowStamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-');
}

function sanitizeSkillSlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const s = slug.trim();
  if (!/^[a-z0-9][a-z0-9-_]{0,80}$/i.test(s)) return null;
  return s;
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function splitPath(pathText) {
  return String(pathText || '')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

function getByPath(root, pathText) {
  const parts = splitPath(pathText);
  if (!parts.length) return undefined;
  let cursor = root;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setByPath(root, pathText, value) {
  const parts = splitPath(pathText);
  if (!parts.length) return;
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const current = cursor[key];
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function normalizeItemValue(value, type) {
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const text = String(value || '').trim().toLowerCase();
    if (text === 'true' || text === '1' || text === 'yes') return true;
    if (text === 'false' || text === '0' || text === 'no') return false;
    throw new HttpError(400, 'INVALID_CONFIG_ITEM_VALUE', 'boolean value required');
  }

  if (type === 'number') {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new HttpError(400, 'INVALID_CONFIG_ITEM_VALUE', 'number value required');
    }
    return num;
  }

  return typeof value === 'string' ? value : String(value ?? '');
}

function parseSystemctlShow(text) {
  const raw = stripAnsi(text);
  const rows = {};
  raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const idx = line.indexOf('=');
      if (idx <= 0) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      rows[key] = value;
    });

  return {
    id: rows.Id || `${OPENCLAW_SERVICE_NAME}.service`,
    description: rows.Description || '',
    loadState: rows.LoadState || 'unknown',
    activeState: rows.ActiveState || 'unknown',
    subState: rows.SubState || 'unknown',
    unitFileState: rows.UnitFileState || 'unknown',
    activeEnterTimestamp: rows.ActiveEnterTimestamp || '',
    execMainStartTimestamp: rows.ExecMainStartTimestamp || ''
  };
}

function parseClawhubList(text) {
  const lines = stripAnsi(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  for (const line of lines) {
    if (line.startsWith('Config warnings')) continue;
    if (line.startsWith('-')) continue;
    if (line.toLowerCase().startsWith('slug')) continue;
    const match = line.match(/^([a-z0-9][a-z0-9-_]*)\s+(.+)$/i);
    if (!match) continue;
    rows.push({ slug: match[1], version: match[2].trim() });
  }
  return rows;
}


function parseJsonObject(textInput, fallback = {}) {
  const text = String(textInput || '').trim();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text);
    return payload && typeof payload === 'object' ? payload : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStateCode(input) {
  const state = String(input || '').trim().toLowerCase();
  if ([STATE_RUNNING, STATE_STARTING, STATE_STOPPED, STATE_ERROR].includes(state)) {
    return state;
  }
  return STATE_UNKNOWN;
}

function normalizeSystemdState(detail = {}) {
  const active = String(detail.activeState || '').toLowerCase();
  const sub = String(detail.subState || '').toLowerCase();

  if (active === 'active') return STATE_RUNNING;
  if (active === 'failed') return STATE_ERROR;
  if (
    active === 'activating' ||
    active === 'reloading' ||
    sub.includes('auto-restart') ||
    sub.includes('reload') ||
    sub.includes('start')
  ) {
    return STATE_STARTING;
  }
  if (active === 'inactive' || active === 'deactivating') return STATE_STOPPED;
  return STATE_UNKNOWN;
}

function parseIsoTimestamp(textInput) {
  const text = String(textInput || '').trim();
  if (!text) return NaN;

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const driftMs = parsed - Date.now();
    // systemd in CN often prints "CST" (China Standard Time), but JS parses CST as UTC-6.
    // If parsed time is clearly in the future, try a China-time fallback parser.
    if (driftMs <= 5 * 60 * 1000) {
      return parsed;
    }
  }

  const cstMatch = text.match(/^[A-Za-z]{3}\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+CST$/);
  if (cstMatch) {
    const [, y, m, d, hh, mm, ss] = cstMatch;
    // Treat systemd "CST" as Asia/Shanghai (+08:00)
    return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh) - 8, Number(mm), Number(ss));
  }

  return Number.isFinite(parsed) ? parsed : NaN;
}
function inferGatewayStateFromText(textInput) {
  const text = stripAnsi(textInput || '');
  const lower = text.toLowerCase();

  const hasRpcOk = /rpc probe:\s*ok/.test(lower);
  const hasRpcFail = /rpc probe:\s*(failed|error|unavailable)/.test(lower);
  const hasHardFailure = /panic|crash|segfault|fatal/.test(lower);
  const hasListening = /\blistening\b/.test(lower);

  let stateCode = STATE_UNKNOWN;

  if (hasRpcOk || (hasListening && !hasHardFailure && !hasRpcFail)) {
    stateCode = STATE_RUNNING;
  } else if (hasHardFailure || hasRpcFail) {
    stateCode = STATE_ERROR;
  } else if (/activating|starting|booting|initializing|reloading/.test(lower)) {
    stateCode = STATE_STARTING;
  } else if (/inactive|stopped|offline|disabled|dead/.test(lower)) {
    stateCode = STATE_STOPPED;
  } else if (/active|running|online|ready/.test(lower)) {
    stateCode = STATE_RUNNING;
  }

  if (stateCode === STATE_ERROR && hasRpcOk) {
    stateCode = STATE_RUNNING;
  }

  const endpointMatch =
    text.match(/(wss?:\/\/[^\s"'<>]+)/i) ||
    text.match(/(https?:\/\/[^\s"'<>]+)/i);
  const endpoint = endpointMatch ? endpointMatch[1] : '';

  const portMatch =
    text.match(/\bport\b\s*[:=]\s*(\d{2,5})/i) ||
    text.match(/\*:(\d{2,5})/) ||
    endpoint.match(/:(\d{2,5})(?:\/|$)/);
  const port = portMatch ? Number.parseInt(portMatch[1], 10) : null;

  return {
    stateCode,
    endpoint,
    port: Number.isFinite(port) ? port : null
  };
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


async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSkillRoots(rootDir, maxDepth = 4, depth = 0) {
  const rows = [];
  const skillFile = path.join(rootDir, 'SKILL.md');
  if (await pathExists(skillFile)) {
    rows.push(rootDir);
  }

  if (depth >= maxDepth) return rows;

  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const child = path.join(rootDir, entry.name);
    const nested = await findSkillRoots(child, maxDepth, depth + 1);
    rows.push(...nested);
  }

  return rows;
}

class OpenClawService {
  async runBinCapture(bin, args = [], timeout = 120000) {
    try {
      const extraPath = [
        path.join(HOME, '.local', 'bin'),
        path.join(HOME, '.npm-global', 'bin')
      ].join(':');

      const env = {
        ...process.env,
        PATH: `${extraPath}:${process.env.PATH || ''}`
      };

      const { stdout, stderr } = await run(bin, args, {
        cwd: HOME,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        env
      });
      return {
        ok: true,
        code: 0,
        stdout: (stdout || '').toString(),
        stderr: (stderr || '').toString(),
        message: ''
      };
    } catch (err) {
      return {
        ok: false,
        code: Number.isInteger(err?.code) ? err.code : 1,
        stdout: (err?.stdout || '').toString(),
        stderr: (err?.stderr || '').toString(),
        message: (err && typeof err.message === 'string' && err.message) || 'Command failed'
      };
    }
  }

  async runBin(bin, args = [], timeout = 120000) {
    const output = await this.runBinCapture(bin, args, timeout);
    if (output.ok) return output;

    const message = output.message || 'Command failed';
    throw new HttpError(500, 'COMMAND_FAILED', message);
  }

  humanizeRuntimeZh(secondsInput) {
    return humanizeRuntimeZh(secondsInput);
  }

  serviceRuntimeSec(detail = {}) {
    const serviceState = normalizeSystemdState(detail);
    if (![STATE_RUNNING, STATE_STARTING].includes(serviceState)) return 0;

    const timeMs = parseIsoTimestamp(detail.activeEnterTimestamp) ||
      parseIsoTimestamp(detail.execMainStartTimestamp);
    if (!Number.isFinite(timeMs)) return 0;

    const deltaMs = Date.now() - timeMs;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
    return Math.floor(deltaMs / 1000);
  }

  describeServiceState(detail = {}) {
    const stateCode = normalizeSystemdState(detail);
    const preset = SERVICE_STATE_PRESETS[stateCode] || SERVICE_STATE_PRESETS[STATE_UNKNOWN];
    return {
      ...preset,
      activeState: String(detail.activeState || 'unknown'),
      subState: String(detail.subState || 'unknown')
    };
  }

  describeGatewayState(gateway = {}, serviceDetail = {}) {
    let stateCode = normalizeStateCode(gateway.stateCode);
    let source = String(gateway.source || 'openclaw gateway status');
    let fallbackUsed = false;

    if (stateCode === STATE_UNKNOWN) {
      const serviceMapped = normalizeSystemdState(serviceDetail);
      if ([STATE_RUNNING, STATE_STARTING, STATE_STOPPED, STATE_ERROR].includes(serviceMapped)) {
        stateCode = serviceMapped;
        source = `${source} (fallback: service state)`;
        fallbackUsed = true;
      }
    }

    const preset = GATEWAY_STATE_PRESETS[stateCode] || GATEWAY_STATE_PRESETS[STATE_UNKNOWN];
    return {
      ...preset,
      source,
      fallbackUsed,
      endpoint: String(gateway.endpoint || ''),
      port: Number.isFinite(gateway.port) ? gateway.port : null,
      text: String(gateway.text || ''),
      error: String(gateway.error || '')
    };
  }

  listEditableConfigItems(config) {
    const items = OPENCLAW_EDITABLE_CONFIG_SPECS.map((spec) => ({
      path: spec.path,
      label: spec.label,
      type: spec.type,
      value: getByPath(config, spec.path) ?? ''
    }));

    const providers = config?.models?.providers;
    if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
      Object.keys(providers)
        .sort()
        .forEach((providerKey) => {
          const providerPath = `models.providers.${providerKey}`;
          items.push({
            path: `${providerPath}.api`,
            label: `Provider ${providerKey} API`,
            type: 'string',
            value: getByPath(config, `${providerPath}.api`) ?? ''
          });
          items.push({
            path: `${providerPath}.baseUrl`,
            label: `Provider ${providerKey} Base URL`,
            type: 'string',
            value: getByPath(config, `${providerPath}.baseUrl`) ?? ''
          });
        });
    }

    return items;
  }

  validateConfigItemPatches(config, inputItems) {
    const current = this.listEditableConfigItems(config);
    const specMap = new Map(current.map((item) => [item.path, item]));
    const patches = [];

    for (const row of inputItems) {
      const pathText = typeof row?.path === 'string' ? row.path.trim() : '';
      if (!pathText) continue;

      const spec = specMap.get(pathText);
      if (!spec) {
        throw new HttpError(400, 'INVALID_CONFIG_ITEM_PATH', `unsupported path: ${pathText}`);
      }

      const value = normalizeItemValue(row?.value, spec.type);
      patches.push({
        path: pathText,
        type: spec.type,
        value
      });
    }

    if (!patches.length) {
      throw new HttpError(400, 'INVALID_CONFIG_ITEMS', 'items[] is required');
    }

    return patches;
  }

  async getStatus() {
    const out = await this.runBin(OPENCLAW_BIN, ['status'], 120000);
    return { text: out.stdout || out.stderr || '' };
  }

  async getServiceStatus() {
    const show = await this.runBinCapture(
      'sudo',
      [
        '-n',
        'systemctl',
        'show',
        OPENCLAW_SERVICE_NAME,
        '--property=Id,LoadState,ActiveState,SubState,UnitFileState,Description,ActiveEnterTimestamp,ExecMainStartTimestamp',
        '--no-pager'
      ],
      30000
    );

    if (!show.ok) {
      throw new HttpError(
        500,
        'SERVICE_STATUS_FAILED',
        show.message || show.stderr || show.stdout || 'Failed to query openclaw service'
      );
    }

    const detail = parseSystemctlShow(show.stdout);
    const statusOut = await this.runBinCapture(
      'sudo',
      ['-n', 'systemctl', 'status', OPENCLAW_SERVICE_NAME, '--no-pager'],
      30000
    );
    const text = `${statusOut.stdout}${statusOut.stderr}`.trim();
    const runtimeSec = this.serviceRuntimeSec(detail);
    const friendlyState = this.describeServiceState(detail);

    return {
      service: OPENCLAW_SERVICE_NAME,
      detail,
      text,
      code: statusOut.code,
      runtimeSec,
      runtimeText: this.humanizeRuntimeZh(runtimeSec),
      friendlyState
    };
  }

  async getGatewayStatus() {
    const out = await this.runBinCapture(OPENCLAW_BIN, ['gateway', 'status'], 45000);
    const text = `${out.stdout}${out.stderr}`.trim();
    const inferred = inferGatewayStateFromText(text);

    return {
      source: 'openclaw gateway status',
      stateCode: inferred.stateCode,
      endpoint: inferred.endpoint,
      port: inferred.port,
      text,
      ok: out.ok,
      code: out.code,
      error: out.ok ? '' : out.message || out.stderr || out.stdout || 'gateway telemetry unavailable'
    };
  }

  async restartService() {
    const out = await this.runBinCapture(
      'sudo',
      ['-n', 'systemctl', 'restart', OPENCLAW_SERVICE_NAME],
      60000
    );
    if (!out.ok) {
      throw new HttpError(
        500,
        'SERVICE_RESTART_FAILED',
        out.stderr || out.stdout || out.message || 'Failed to restart openclaw service'
      );
    }

    const status = await this.getServiceStatus();
    if (status?.detail?.activeState !== 'active') {
      throw new HttpError(
        500,
        'SERVICE_RESTART_NOT_ACTIVE',
        `openclaw.service restart后状态异常: ${status?.detail?.activeState}/${status?.detail?.subState}`
      );
    }
    return {
      text: `${out.stdout}${out.stderr}`.trim() || 'Service restarted',
      status
    };
  }

  async startService() {
    const out = await this.runBinCapture(
      'sudo',
      ['-n', 'systemctl', 'start', OPENCLAW_SERVICE_NAME],
      60000
    );
    if (!out.ok) {
      throw new HttpError(
        500,
        'SERVICE_START_FAILED',
        out.stderr || out.stdout || out.message || 'Failed to start openclaw service'
      );
    }

    const status = await this.getServiceStatus();
    if (status?.detail?.activeState !== 'active') {
      throw new HttpError(
        500,
        'SERVICE_START_NOT_ACTIVE',
        `openclaw.service 启动后状态异常: ${status?.detail?.activeState}/${status?.detail?.subState}`
      );
    }
    return {
      text: `${out.stdout}${out.stderr}`.trim() || 'Service started',
      status
    };
  }

  async stopService() {
    const out = await this.runBinCapture(
      'sudo',
      ['-n', 'systemctl', 'stop', OPENCLAW_SERVICE_NAME],
      60000
    );
    if (!out.ok) {
      throw new HttpError(
        500,
        'SERVICE_STOP_FAILED',
        out.stderr || out.stdout || out.message || 'Failed to stop openclaw service'
      );
    }

    const status = await this.getServiceStatus();
    const state = String(status?.detail?.activeState || '').toLowerCase();
    if (!['inactive', 'failed'].includes(state)) {
      throw new HttpError(
        500,
        'SERVICE_STOP_NOT_INACTIVE',
        `openclaw.service 停止后状态异常: ${status?.detail?.activeState}/${status?.detail?.subState}`
      );
    }
    return {
      text: `${out.stdout}${out.stderr}`.trim() || 'Service stopped',
      status
    };
  }

  async loadConfigJson() {
    try {
      const raw = await fs.readFile(OPENCLAW_CONFIG, 'utf8');
      const config = JSON.parse(raw);
      const modelPrimary = config?.agents?.defaults?.model?.primary || '';
      const editableItems = this.listEditableConfigItems(config);
      return { config, modelPrimary, editableItems };
    } catch (err) {
      throw new HttpError(500, 'CONFIG_READ_FAILED', err?.message || 'Failed to read config');
    }
  }

  async saveConfigJson(newConfig) {
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
      throw new HttpError(400, 'INVALID_CONFIG', 'config must be an object');
    }
    await fs.mkdir(OPENCLAW_CONFIG_BACKUP_DIR, { recursive: true });
    const backupPath = path.join(
      OPENCLAW_CONFIG_BACKUP_DIR,
      `openclaw.json.backup-${nowStamp()}.json`
    );

    try {
      await fs.copyFile(OPENCLAW_CONFIG, backupPath);
      await fs.writeFile(OPENCLAW_CONFIG, `${JSON.stringify(newConfig, null, 2)}\n`, 'utf8');
      return { backupPath };
    } catch (err) {
      throw new HttpError(500, 'CONFIG_SAVE_FAILED', err?.message || 'Failed to save config');
    }
  }

  async saveEditableConfigItems(itemsInput) {
    const inputItems = Array.isArray(itemsInput) ? itemsInput : [];
    const { config } = await this.loadConfigJson();
    const patches = this.validateConfigItemPatches(config, inputItems);

    for (const patch of patches) {
      setByPath(config, patch.path, patch.value);
    }

    const { backupPath } = await this.saveConfigJson(config);
    return {
      backupPath,
      modelPrimary: getByPath(config, 'agents.defaults.model.primary') || '',
      editableItems: this.listEditableConfigItems(config),
      config
    };
  }

  async listConfigBackups(limit = 20) {
    await fs.mkdir(OPENCLAW_CONFIG_BACKUP_DIR, { recursive: true });
    const entries = await fs.readdir(OPENCLAW_CONFIG_BACKUP_DIR, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith('openclaw.json.backup-'))
      .map((entry) => entry.name);

    const rows = [];
    for (const fileName of files) {
      const fullPath = path.join(OPENCLAW_CONFIG_BACKUP_DIR, fileName);
      const stat = await fs.stat(fullPath);
      rows.push({
        fileName,
        path: fullPath,
        modifiedAt: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs
      });
    }

    return rows.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, Math.max(1, limit));
  }

  async rollbackConfigLatest() {
    const backups = await this.listConfigBackups(1);
    const latest = backups[0];
    if (!latest) {
      throw new HttpError(404, 'CONFIG_BACKUP_NOT_FOUND', 'No config backup found');
    }

    const rollbackBackupPath = path.join(
      OPENCLAW_CONFIG_BACKUP_DIR,
      `openclaw.json.rollback-safety-${nowStamp()}.json`
    );

    await fs.copyFile(OPENCLAW_CONFIG, rollbackBackupPath);
    await fs.copyFile(latest.path, OPENCLAW_CONFIG);

    const loaded = await this.loadConfigJson();
    return {
      appliedBackupPath: latest.path,
      rollbackBackupPath,
      modelPrimary: loaded.modelPrimary,
      editableItems: loaded.editableItems,
      config: loaded.config
    };
  }

  async saveModelPrimary(modelPrimaryInput) {
    const modelPrimary = typeof modelPrimaryInput === 'string' ? modelPrimaryInput.trim() : '';
    if (!modelPrimary) {
      throw new HttpError(400, 'INVALID_MODEL_PRIMARY', 'modelPrimary is required');
    }

    const { config } = await this.loadConfigJson();
    config.agents = config.agents || {};
    config.agents.defaults = config.agents.defaults || {};
    config.agents.defaults.model = config.agents.defaults.model || {};
    config.agents.defaults.model.primary = modelPrimary;

    const { backupPath } = await this.saveConfigJson(config);
    return { backupPath, modelPrimary };
  }

  async restartGateway() {
    const out = await this.runBin(OPENCLAW_BIN, ['gateway', 'restart'], 180000);
    return { text: `${out.stdout}${out.stderr}`.trim() };
  }

  async listSkillsRaw() {
    const out = await this.runBin(CLAWHUB_BIN, ['list'], 120000);
    return {
      rows: parseClawhubList(out.stdout),
      raw: out.stdout || out.stderr || ''
    };
  }

  async listAvailableSkills() {
    const out = await this.runBinCapture(OPENCLAW_BIN, ['skills', 'list', '--json'], 120000);
    const payload = parseJsonObject(out.stdout || out.stderr, {});
    const skills = Array.isArray(payload.skills) ? payload.skills : [];

    return {
      ok: out.ok,
      skills,
      raw: out.stdout || out.stderr || '',
      error: out.ok ? '' : out.message || out.stderr || out.stdout || 'openclaw skills list failed'
    };
  }

  async installSkill(slugInput) {
    const slug = sanitizeSkillSlug(slugInput);
    if (!slug) throw new HttpError(400, 'INVALID_SKILL_SLUG', 'invalid slug');
    const out = await this.runBin(CLAWHUB_BIN, ['install', slug, '--force'], 300000);
    return { slug, text: `${out.stdout}${out.stderr}`.trim() };
  }

  async updateSkill(slugInput) {
    const slug = sanitizeSkillSlug(slugInput);
    if (!slug) throw new HttpError(400, 'INVALID_SKILL_SLUG', 'invalid slug');
    const out = await this.runBin(CLAWHUB_BIN, ['update', slug, '--force'], 300000);
    return { slug, text: `${out.stdout}${out.stderr}`.trim() };
  }

  async updateAllSkills() {
    const out = await this.runBin(CLAWHUB_BIN, ['update', '--all', '--force'], 300000);
    return { text: `${out.stdout}${out.stderr}`.trim() };
  }

  async removeSkill(slugInput) {
    const slug = sanitizeSkillSlug(slugInput);
    if (!slug) throw new HttpError(400, 'INVALID_SKILL_SLUG', 'invalid slug');
    const out = await this.runBin(CLAWHUB_BIN, ['uninstall', slug, '--yes'], 180000);
    return { slug, text: `${out.stdout}${out.stderr}`.trim() };
  }

  buildSkillSearchLinks(queryInput) {
    const query = String(queryInput || '').trim();
    const links = [];

    if (query) {
      links.push({
        title: `在 ClawHub 搜索：${query}`,
        url: `https://clawhub.com/search?q=${encodeURIComponent(query)}`,
        type: 'search'
      });
    } else {
      links.push({
        title: '打开 ClawHub 首页',
        url: 'https://clawhub.com',
        type: 'home'
      });
    }

    const maybeSlug = sanitizeSkillSlug(query);
    if (maybeSlug) {
      links.push({
        title: `打开技能页面：${maybeSlug}`,
        url: `https://clawhub.com/skills/${maybeSlug}`,
        type: 'skill'
      });
    }

    links.push({
      title: '浏览最新技能列表',
      url: 'https://clawhub.com',
      type: 'explore'
    });

    return links;
  }

  async installSkillFromZip(fileNameInput, zipBase64Input) {
    const fileName = String(fileNameInput || '').trim();
    const zipBase64 = String(zipBase64Input || '').trim();
    if (!fileName || !zipBase64) {
      throw new HttpError(400, 'INVALID_SKILL_ZIP', 'fileName and zipBase64 are required');
    }

    if (!fileName.toLowerCase().endsWith('.zip')) {
      throw new HttpError(400, 'INVALID_SKILL_ZIP', 'only .zip package is supported');
    }

    const zipBuffer = Buffer.from(zipBase64, 'base64');
    if (!zipBuffer.length) {
      throw new HttpError(400, 'INVALID_SKILL_ZIP', 'empty zip package');
    }

    const stamp = nowStamp();
    const tmpRoot = path.join('/tmp', `openclaw-skill-upload-${stamp}`);
    const safeFileName = path.basename(fileName).replace(/[^a-z0-9._-]/gi, '_');
    const zipPath = path.join(tmpRoot, safeFileName);
    const extractDir = path.join(tmpRoot, 'extract');

    await fs.mkdir(extractDir, { recursive: true });
    await fs.writeFile(zipPath, zipBuffer);

    const unzipOut = await this.runBinCapture('unzip', ['-oq', zipPath, '-d', extractDir], 180000);
    if (!unzipOut.ok) {
      throw new HttpError(
        500,
        'SKILL_ZIP_UNZIP_FAILED',
        unzipOut.stderr || unzipOut.stdout || unzipOut.message || 'failed to unzip skill package'
      );
    }

    const roots = await findSkillRoots(extractDir, 4, 0);
    if (!roots.length) {
      throw new HttpError(400, 'SKILL_ZIP_INVALID', 'SKILL.md not found in zip package');
    }

    const root = roots.sort((a, b) => a.length - b.length)[0];
    const fromDirName = path.basename(root);
    const fallbackSlug = safeFileName.replace(/\.zip$/i, '').toLowerCase();
    const slug = sanitizeSkillSlug(fromDirName) || sanitizeSkillSlug(fallbackSlug) || `skill-${Date.now()}`;

    const installPath = path.join(SKILLS_LOCAL_DIR, slug);
    const backupBase = path.join(OPENCLAW_CONFIG_BACKUP_DIR, 'skills');
    await fs.mkdir(backupBase, { recursive: true });
    await fs.mkdir(SKILLS_LOCAL_DIR, { recursive: true });

    let backupPath = '';
    if (await pathExists(installPath)) {
      backupPath = path.join(backupBase, `${slug}-${stamp}`);
      await fs.rm(backupPath, { recursive: true, force: true });
      await fs.cp(installPath, backupPath, { recursive: true });
      await fs.rm(installPath, { recursive: true, force: true });
    }

    await fs.cp(root, installPath, { recursive: true });

    const skillMd = path.join(installPath, 'SKILL.md');
    if (!(await pathExists(skillMd))) {
      throw new HttpError(400, 'SKILL_ZIP_INVALID', 'installed folder missing SKILL.md');
    }

    const reloadOut = await this.runBinCapture(OPENCLAW_BIN, ['gateway', 'restart'], 180000);
    const reloadMessage = reloadOut.ok
      ? 'OpenClaw 网关已重启并加载新技能'
      : `技能已安装，但网关重启失败: ${reloadOut.stderr || reloadOut.message}`;

    await fs.rm(tmpRoot, { recursive: true, force: true });

    return {
      slug,
      installPath,
      backupPath,
      reloadMessage,
      text: `${slug} 安装完成`
    };
  }

  sanitizeSkillSlug(slug) {
    return sanitizeSkillSlug(slug);
  }
}

module.exports = {
  OpenClawService,
  sanitizeSkillSlug
};
