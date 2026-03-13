const express = require('express');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');
const { pickText } = require('../utils/text');

function toBool(input, fallback = true) {
  if (typeof input === 'boolean') return input;
  const text = String(input || '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'ok', 'pass', 'passed'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'fail', 'failed'].includes(text)) return false;
  return fallback;
}

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
        weight: req.body?.weight
      });

      const payload = output && output.task ? output : { task: output, linkedTasks: [] };
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.post(
    '/task/:id/review',
    asyncHandler(async (req, res) => {
      const output = await squadService.reviewTask(req.params.id, {
        completion: req.body?.completion,
        quality: req.body?.quality,
        ownerScore: req.body?.ownerScore,
        captainScore: req.body?.captainScore,
        passed: toBool(req.body?.passed, true),
        reviewNote: req.body?.reviewNote
      });

      return sendSuccess(res, output, { legacy: output });
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
    asyncHandler(async (req, res) => {
      const role = await squadService.submitReflection(
        req.params.id,
        pickText(req.body?.reflection, req.body?.text)
      );
      return sendSuccess(res, { role }, { legacy: { role } });
    })
  );

  return router;
}

module.exports = {
  createSquadRouter
};
