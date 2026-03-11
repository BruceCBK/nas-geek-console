const express = require('express');
const path = require('path');
const { PUBLIC_DIR, OPERATION_LOG_PATH, TASKS_PATH, FAVORITES_PATH, TOPICS_PATH, MEMORY_INDEX_PATH, SQUAD_ROLES_PATH, SQUAD_TASKS_PATH } = require('./config/paths');
const { JsonStore } = require('./utils/json-store');
const { AuthService } = require('./services/auth-service');
const { LogService } = require('./services/log-service');
const { TaskService } = require('./services/task-service');
const { SquadService } = require('./services/squad-service');
const { OpenClawService } = require('./services/openclaw-service');
const { MemoryService } = require('./services/memory-service');
const { ContentService } = require('./services/content-service');
const { MediaService } = require('./services/media-service');
const { createAuthMiddleware } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { createHealthRouter } = require('./routes/health');
const { createAuthRouter } = require('./routes/auth');
const { createOpenClawRouter } = require('./routes/openclaw');
const { createSkillsRouter } = require('./routes/skills');
const { createMemoryRouter } = require('./routes/memory');
const { createMediaRouter } = require('./routes/media');
const { createContentRouter } = require('./routes/content');
const { createTaskRouter } = require('./routes/tasks');
const { createLogRouter } = require('./routes/logs');
const { createSquadRouter } = require('./routes/squad');
const { createDashboardRouter } = require('./routes/dashboard');

async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));
  app.use(express.static(PUBLIC_DIR));

  const services = createServices();
  await initializeServices(services);

  app.use('/api/health', createHealthRouter());
  app.use('/api/auth', createAuthRouter(services));

  const requireAuth = createAuthMiddleware(services.authService);
  app.use('/api', requireAuth);

  app.use('/api/openclaw', createOpenClawRouter(services));
  app.use('/api/skills', createSkillsRouter(services));
  app.use('/api/memory', createMemoryRouter(services));
  app.use('/api/media', createMediaRouter(services));
  app.use('/api/content', createContentRouter(services));
  app.use('/api/tasks', createTaskRouter(services));
  app.use('/api/logs', createLogRouter(services));
  app.use('/api/squad', createSquadRouter(services));
  app.use('/api/dashboard', createDashboardRouter(services));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  // SPA fallback for direct browser navigation.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  return { app, services };
}

function createServices() {
  const operationLogStore = new JsonStore(OPERATION_LOG_PATH, () => []);
  const taskStore = new JsonStore(TASKS_PATH, () => []);
  const favoritesStore = new JsonStore(FAVORITES_PATH, () => []);
  const topicsStore = new JsonStore(TOPICS_PATH, () => []);
  const memoryIndexStore = new JsonStore(MEMORY_INDEX_PATH, () => ({
    updatedAt: '',
    files: []
  }));
  const squadRoleStore = new JsonStore(SQUAD_ROLES_PATH, () => []);
  const squadTaskStore = new JsonStore(SQUAD_TASKS_PATH, () => []);

  const authService = new AuthService();
  const logService = new LogService(operationLogStore);
  const taskService = new TaskService(taskStore, logService);
  const openclawService = new OpenClawService();
  const memoryService = new MemoryService(memoryIndexStore);
  const contentService = new ContentService(favoritesStore, topicsStore);
  const mediaService = new MediaService();
  const squadService = new SquadService(squadRoleStore, squadTaskStore, logService);

  return {
    authService,
    logService,
    taskService,
    openclawService,
    memoryService,
    contentService,
    mediaService,
    squadService
  };
}

async function initializeServices(services) {
  await Promise.all([
    services.logService.init(),
    services.taskService.init(),
    services.memoryService.init(),
    services.contentService.init(),
    services.squadService.init()
  ]);
}

module.exports = {
  createApp
};
