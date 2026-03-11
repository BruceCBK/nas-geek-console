function sendSuccess(res, data, options = {}) {
  const payload = {
    ok: true,
    data: data === undefined ? {} : data
  };

  if (options.message) payload.message = options.message;
  if (options.meta) payload.meta = options.meta;
  if (options.legacy && typeof options.legacy === 'object') {
    Object.assign(payload, options.legacy);
  }

  const status = Number.isInteger(options.status) ? options.status : 200;
  return res.status(status).json(payload);
}

function sendError(res, err, fallback = {}) {
  const status = Number.isInteger(err?.status)
    ? err.status
    : Number.isInteger(fallback.status)
      ? fallback.status
      : 500;
  const code = err?.code || fallback.code || 'INTERNAL_ERROR';
  const message =
    (err && typeof err.message === 'string' && err.message.trim()) ||
    fallback.message ||
    'Internal server error';

  const payload = {
    ok: false,
    error: {
      code,
      message
    }
  };

  if (err?.details !== undefined) payload.error.details = err.details;
  if (fallback.meta) payload.meta = fallback.meta;
  if (fallback.legacy && typeof fallback.legacy === 'object') {
    Object.assign(payload, fallback.legacy);
  }

  return res.status(status).json(payload);
}

module.exports = {
  sendSuccess,
  sendError
};
