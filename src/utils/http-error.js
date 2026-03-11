class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || 'Request failed');
    this.name = 'HttpError';
    this.status = Number.isInteger(status) ? status : 500;
    this.code = code || 'INTERNAL_ERROR';
    if (details !== undefined) {
      this.details = details;
    }
  }
}

function ensureHttpError(err, fallbackMessage) {
  if (err instanceof HttpError) return err;
  const message =
    (err && typeof err.message === 'string' && err.message.trim()) ||
    fallbackMessage ||
    'Internal server error';
  const wrapped = new HttpError(500, 'INTERNAL_ERROR', message);
  if (err && typeof err === 'object' && err.stack) {
    wrapped.stack = err.stack;
  }
  return wrapped;
}

module.exports = {
  HttpError,
  ensureHttpError
};
