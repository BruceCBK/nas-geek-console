const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

const HOME = '/home/openclaw';
const OPENCLAW_BIN = '/home/openclaw/.npm-global/bin/openclaw';
const CLAWHUB_BIN = '/home/openclaw/.npm-global/bin/clawhub';
const OPENCLAW_CONFIG = '/home/openclaw/.openclaw/openclaw.json';
const OPENCLAW_CONFIG_BACKUP_DIR = '/home/openclaw/.openclaw/backups';
const MEMORY_DIR = '/home/openclaw/memory';
const MEMORY_MD = '/home/openclaw/MEMORY.md';

const MEDIA_TRENDING_PATH = path.join(DATA_DIR, 'media-trending.json');
const WECHAT_CACHE_PATH = path.join(DATA_DIR, 'wechat-articles-cache.json');
const TASKS_PATH = path.join(DATA_DIR, 'tasks.json');
const FAVORITES_PATH = path.join(DATA_DIR, 'favorites.json');
const TOPICS_PATH = path.join(DATA_DIR, 'topics.json');
const OPERATION_LOG_PATH = path.join(DATA_DIR, 'operation-log.json');
const MEMORY_INDEX_PATH = path.join(DATA_DIR, 'memory-index.json');
const SQUAD_ROLES_PATH = path.join(DATA_DIR, 'squad-roles.json');
const SQUAD_TASKS_PATH = path.join(DATA_DIR, 'squad-tasks.json');

module.exports = {
  PROJECT_ROOT,
  DATA_DIR,
  PUBLIC_DIR,
  HOME,
  OPENCLAW_BIN,
  CLAWHUB_BIN,
  OPENCLAW_CONFIG,
  OPENCLAW_CONFIG_BACKUP_DIR,
  MEMORY_DIR,
  MEMORY_MD,
  MEDIA_TRENDING_PATH,
  WECHAT_CACHE_PATH,
  TASKS_PATH,
  FAVORITES_PATH,
  TOPICS_PATH,
  OPERATION_LOG_PATH,
  MEMORY_INDEX_PATH,
  SQUAD_ROLES_PATH,
  SQUAD_TASKS_PATH
};
