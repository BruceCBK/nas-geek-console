const express = require('express');
const { HttpError } = require('../utils/http-error');
const { sendSuccess } = require('../utils/response');
const { asyncHandler } = require('../utils/async-handler');

function createAuthRouter({ authService, logService }) {
  const router = express.Router();

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const password = req.body?.password;
      const session = authService.login(password, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] || ''
      });

      if (!session) {
        await logService.append({
          action: 'auth.login',
          type: 'auth',
          target: req.ip || '-',
          status: 'failed',
          message: 'Invalid password'
        });
        throw new HttpError(401, 'INVALID_PASSWORD', 'Invalid password');
      }

      await logService.append({
        action: 'auth.login',
        type: 'auth',
        target: req.ip || '-',
        status: 'success',
        message: 'Login success'
      });

      return sendSuccess(
        res,
        {
          token: session.token,
          createdAt: session.createdAt,
          expiresInSec: 24 * 60 * 60
        },
        {
          legacy: {
            token: session.token
          }
        }
      );
    })
  );

  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const token = authService.extractToken(req);
      const session = authService.verify(token);
      if (!session) {
        throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
      }
      return sendSuccess(res, {
        authenticated: true,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt
      });
    })
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const token = authService.extractToken(req);
      authService.logout(token);
      await logService.append({
        action: 'auth.logout',
        type: 'auth',
        target: req.ip || '-',
        status: 'success',
        message: 'Logout success'
      });
      return sendSuccess(res, { loggedOut: true });
    })
  );

  return router;
}

module.exports = {
  createAuthRouter
};
