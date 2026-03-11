const { HttpError } = require('../utils/http-error');

function createAuthMiddleware(authService) {
  return function requireAuth(req, _res, next) {
    const token = authService.extractToken(req);
    const session = authService.verify(token);
    if (!session) {
      return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication required'));
    }
    req.auth = session;
    return next();
  };
}

module.exports = {
  createAuthMiddleware
};
