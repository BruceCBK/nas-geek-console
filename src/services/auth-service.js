const crypto = require('crypto');

class AuthService {
  constructor() {
    this.sessions = new Map();
    this.password = process.env.OPENCLAW_CONSOLE_PASSWORD || 'openclaw';
    this.ttlMs = 24 * 60 * 60 * 1000;
  }

  login(password, meta = {}) {
    if (typeof password !== 'string' || password !== this.password) {
      return null;
    }
    const token = crypto.randomBytes(24).toString('hex');
    const now = new Date().toISOString();
    const session = {
      token,
      createdAt: now,
      lastSeenAt: now,
      ip: meta.ip || '',
      userAgent: meta.userAgent || ''
    };
    this.sessions.set(token, session);
    return { ...session };
  }

  verify(token) {
    if (!token || typeof token !== 'string') return null;
    const current = this.sessions.get(token);
    if (!current) return null;

    const createdAt = Date.parse(current.createdAt || '');
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > this.ttlMs) {
      this.sessions.delete(token);
      return null;
    }

    current.lastSeenAt = new Date().toISOString();
    this.sessions.set(token, current);
    return { ...current };
  }

  logout(token) {
    if (!token) return false;
    return this.sessions.delete(token);
  }

  extractToken(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    const direct = req.headers['x-session-token'];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    return '';
  }
}

module.exports = {
  AuthService
};
