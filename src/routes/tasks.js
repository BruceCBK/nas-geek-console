const express = require('express');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');

function createTaskRouter({ taskService }) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const tasks = await taskService.list({
        limit: req.query.limit,
        type: req.query.type,
        status: req.query.status,
        target: req.query.target
      });
      return sendSuccess(res, { tasks }, { legacy: { tasks } });
    })
  );

  return router;
}

module.exports = {
  createTaskRouter
};
