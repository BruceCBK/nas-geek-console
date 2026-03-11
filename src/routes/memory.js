const express = require('express');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');

function createMemoryRouter({ memoryService, logService }) {
  const router = express.Router();

  router.get(
    '/files',
    asyncHandler(async (_req, res) => {
      const entries = await memoryService.listFiles();
      const files = entries.map((row) => row.path);
      return sendSuccess(
        res,
        {
          files,
          entries
        },
        {
          legacy: {
            files,
            entries
          }
        }
      );
    })
  );

  router.get(
    '/file',
    asyncHandler(async (req, res) => {
      const payload = await memoryService.readFile(req.query.path);
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.put(
    '/file',
    asyncHandler(async (req, res) => {
      const payload = await memoryService.writeFile(req.body?.path, req.body?.content);
      await logService.append({
        action: 'memory.save',
        type: 'memory',
        target: payload.path,
        status: 'success',
        message: `Saved ${payload.path}`
      });
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.post(
    '/file',
    asyncHandler(async (req, res) => {
      const payload = await memoryService.createFile(req.body?.path, req.body?.content ?? '');
      await logService.append({
        action: 'memory.create',
        type: 'memory',
        target: payload.path,
        status: 'success',
        message: `Created ${payload.path}`
      });
      return sendSuccess(res, payload, { status: 201, legacy: payload });
    })
  );

  router.delete(
    '/file',
    asyncHandler(async (req, res) => {
      const payload = await memoryService.deleteFile(req.query.path);
      await logService.append({
        action: 'memory.delete',
        type: 'memory',
        target: payload.path,
        status: 'success',
        message: `Deleted ${payload.path}`
      });
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.post(
    '/rename',
    asyncHandler(async (req, res) => {
      const payload = await memoryService.renameFile(req.body?.fromPath, req.body?.toPath);
      await logService.append({
        action: 'memory.rename',
        type: 'memory',
        target: `${payload.fromPath} -> ${payload.toPath}`,
        status: 'success',
        message: `Renamed ${payload.fromPath} to ${payload.toPath}`
      });
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.post(
    '/compress',
    asyncHandler(async (req, res) => {
      const payload = await memoryService.compressFile(req.body?.path, req.body?.content, req.body?.apply === true);
      await logService.append({
        action: 'memory.compress',
        type: 'memory',
        target: payload.path,
        status: 'success',
        message: payload.applied ? `Compressed and applied ${payload.path}` : `Compressed preview for ${payload.path}`,
        meta: {
          applied: payload.applied,
          originalLength: payload.originalLength,
          compressedLength: payload.compressedLength,
          ratio: payload.ratio
        }
      });
      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  router.get(
    '/search',
    asyncHandler(async (req, res) => {
      const results = await memoryService.search(req.query.q, req.query.limit);
      return sendSuccess(res, { results }, { legacy: { results } });
    })
  );

  router.get(
    '/extract',
    asyncHandler(async (req, res) => {
      const results = await memoryService.extract(req.query.q, req.query.limit);
      return sendSuccess(res, { results }, { legacy: { results } });
    })
  );

  router.get(
    '/recent',
    asyncHandler(async (req, res) => {
      const recent = await memoryService.recent(req.query.limit);
      return sendSuccess(res, { recent }, { legacy: { recent } });
    })
  );

  router.get(
    '/index',
    asyncHandler(async (_req, res) => {
      const index = await memoryService.getIndex();
      return sendSuccess(res, index, { legacy: index });
    })
  );

  router.post(
    '/template',
    asyncHandler(async (req, res) => {
      const payload = await memoryService.createFromTemplate(req.body?.templateType, req.body || {});
      await logService.append({
        action: 'memory.template',
        type: 'memory',
        target: payload.path,
        status: 'success',
        message: `Template created: ${payload.templateType}`
      });
      return sendSuccess(res, payload, { status: 201, legacy: payload });
    })
  );

  return router;
}

module.exports = {
  createMemoryRouter
};
