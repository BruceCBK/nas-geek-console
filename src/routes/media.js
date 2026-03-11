const express = require('express');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');

function createMediaRouter({ mediaService }) {
  const router = express.Router();

  router.get(
    '/trending',
    asyncHandler(async (_req, res) => {
      const data = await mediaService.getTrending();
      return sendSuccess(res, { data }, { legacy: { data } });
    })
  );

  router.get(
    '/wechat/recommendations',
    asyncHandler(async (req, res) => {
      const payload = await mediaService.getWechatRecommendations({
        query: req.query.q,
        limit: req.query.limit
      });

      return sendSuccess(res, payload, {
        legacy: payload
      });
    })
  );

  return router;
}

module.exports = {
  createMediaRouter
};
