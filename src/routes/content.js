const express = require('express');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');

function createContentRouter({ contentService, logService }) {
  const router = express.Router();

  router.get(
    '/state',
    asyncHandler(async (_req, res) => {
      const state = await contentService.getState();
      return sendSuccess(res, state, {
        legacy: {
          favorites: state.favorites,
          topics: state.topics
        }
      });
    })
  );

  router.post(
    '/favorite',
    asyncHandler(async (req, res) => {
      const saved = await contentService.favorite(req.body?.item, req.body?.note);
      await logService.append({
        action: 'content.favorite',
        type: 'content',
        target: saved.id,
        status: 'success',
        message: saved.title
      });
      return sendSuccess(res, { favorite: saved }, { legacy: { favorite: saved } });
    })
  );

  router.post(
    '/unfavorite',
    asyncHandler(async (req, res) => {
      const out = await contentService.unfavorite(req.body?.id);
      await logService.append({
        action: 'content.unfavorite',
        type: 'content',
        target: out.id,
        status: 'success',
        message: 'Unfavorited'
      });
      return sendSuccess(res, out, { legacy: out });
    })
  );

  router.post(
    '/note',
    asyncHandler(async (req, res) => {
      const saved = await contentService.addNote(req.body?.id, req.body?.note, req.body?.item);
      await logService.append({
        action: 'content.note',
        type: 'content',
        target: saved.id,
        status: 'success',
        message: 'Note saved'
      });
      return sendSuccess(res, { favorite: saved }, { legacy: { favorite: saved } });
    })
  );

  router.post(
    '/topic',
    asyncHandler(async (req, res) => {
      const topic = await contentService.convertToTopic(req.body || {});
      await logService.append({
        action: 'content.topic',
        type: 'content',
        target: topic.id,
        status: 'success',
        message: topic.title
      });
      return sendSuccess(res, { topic }, { legacy: { topic } });
    })
  );

  return router;
}

module.exports = {
  createContentRouter
};
