const express = require('express');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');

function createHealthRouter() {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const payload = {
        app: 'nas-geek-console',
        time: new Date().toISOString(),
        uptimeSec: process.uptime(),
        pid: process.pid
      };

      return sendSuccess(res, payload, { legacy: payload });
    })
  );

  return router;
}

module.exports = {
  createHealthRouter
};
