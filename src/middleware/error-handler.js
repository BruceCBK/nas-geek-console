const { sendError } = require('../utils/response');
const { ensureHttpError, HttpError } = require('../utils/http-error');

function notFoundHandler(req, _res, next) {
  next(new HttpError(404, 'NOT_FOUND', `Route not found: ${req.originalUrl}`));
}

function errorHandler(err, req, res, _next) {
  const wrapped = ensureHttpError(err, 'Internal server error');

  if (wrapped.status >= 500) {
    console.error('[api-error]', {
      method: req.method,
      url: req.originalUrl,
      status: wrapped.status,
      code: wrapped.code,
      message: wrapped.message
    });
  }

  return sendError(res, wrapped);
}

module.exports = {
  notFoundHandler,
  errorHandler
};
