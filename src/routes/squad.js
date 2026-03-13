const express = require('express');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');
const { HttpError } = require('../utils/http-error');

function createSquadRouter({ squadService }) {
  const router = express.Router();

  router.get(
    '/state',
    asyncHandler(async (_req, res) => {
      const payload = await squadService.getState();
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.post(
    '/task',
    asyncHandler(async (req, res) => {
      const output = await squadService.createTask({
        title: req.body?.title,
        description: req.body?.description,
        roleId: req.body?.roleId,
        weight: req.body?.weight,
        source: req.body?.source
      });

      const payload = output && output.task ? output : { task: output, linkedTasks: [] };
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.post(
    '/task/:id/review',
    asyncHandler(async () => {
      throw new HttpError(
        410,
        'SQUAD_REVIEW_MANUAL_DEPRECATED',
        '手动任务评分已下线，系统改为自动评分与自动复盘。'
      );
    })
  );

  router.post(
    '/task/:id/final-report/retry',
    asyncHandler(async (req, res) => {
      const payload = await squadService.retryFinalReport(req.params.id, {
        source: req.body?.source
      });
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.post(
    '/task/:id/heartbeat',
    asyncHandler(async (req, res) => {
      const task = await squadService.heartbeatTask(req.params.id, {
        progressPercent: req.body?.progressPercent,
        progress: req.body?.progress,
        note: req.body?.note,
        message: req.body?.message
      });
      return sendSuccess(res, { task }, { legacy: { task } });
    })
  );

  router.post(
    '/command-bridge/sync',
    asyncHandler(async (req, res) => {
      const payload = await squadService.syncCommandBridgeNow({
        source: req.body?.source
      });
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.post(
    '/reporting/sync-memory',
    asyncHandler(async (req, res) => {
      const payload = await squadService.syncReportingMemory({
        source: req.body?.source,
        force: req.body?.force === true,
        dryRun: req.body?.dryRun === true,
        maxItems: req.body?.maxItems
      });
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.post(
    '/role/:id/reflection',
    asyncHandler(async () => {
      throw new HttpError(
        410,
        'SQUAD_REFLECTION_MANUAL_DEPRECATED',
        '低分自省手动提交已下线，系统会根据任务表现自动生成改进建议。'
      );
    })
  );


  return router;
}

module.exports = {
  createSquadRouter
};
