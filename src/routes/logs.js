const express = require('express');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');

function createLogRouter({ logService }) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const logs = await logService.list(req.query.limit);
      return sendSuccess(res, { logs }, { legacy: { logs } });
    })
  );

  return router;
}

module.exports = {
  createLogRouter
};
