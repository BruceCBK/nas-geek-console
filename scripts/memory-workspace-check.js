#!/usr/bin/env node

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3900';
const PASSWORD = process.env.SMOKE_PASSWORD || 'openclaw';

async function request(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  let body = options.body;
  if (body !== undefined && body !== null && typeof body !== 'string') {
    body = JSON.stringify(body);
    headers['content-type'] = headers['content-type'] || 'application/json';
  } else if (typeof body === 'string' && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body
  });

  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return {
    status: res.status,
    body: payload
  };
}

function getData(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  return payload.data ?? payload;
}

function pickError(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const err = payload.error || payload;
  return [err.code, err.message].filter(Boolean).join(' ');
}

async function main() {
  const failures = [];
  const cleanupFailures = [];
  let token = '';

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const extractToken = `MEMCHK_${stamp.replace(/[^a-zA-Z0-9]/g, '')}`;
  const tempPath = `tmp/memory-workspace-check-${stamp}.md`;
  const renamedPath = `tmp/memory-workspace-check-${stamp}-renamed.md`;

  function authHeaders() {
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  async function check(name, fn) {
    try {
      await fn();
      console.log(`✅ ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name}: ${message}`);
      console.log(`❌ ${name}: ${message}`);
    }
  }

  async function cleanupPath(path) {
    if (!token) return;
    const res = await request(`/api/memory/file?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (res.status === 200 || res.status === 404) {
      return;
    }
    cleanupFailures.push(`${path}: expected 200/404, got ${res.status} ${pickError(res.body)}`);
  }

  try {
    await check('POST /api/auth/login', async () => {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: {
          password: PASSWORD
        }
      });
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status} ${pickError(res.body)}`);
      }
      const data = getData(res.body);
      token = data?.token || '';
      if (!token) {
        throw new Error('missing token');
      }
    });

    const writeContent = [
      '# Memory Workspace Check',
      `${extractToken} keyword line`,
      `${extractToken} keyword line`,
      '',
      '',
      'Plain duplicate line',
      'Plain duplicate line',
      '```js',
      'const x = 1;   ',
      'const x = 1;   ',
      '```',
      'Tail spaces should be trimmed    ',
      ''
    ].join('\n');

    await check('POST /api/memory/file create temp', async () => {
      const res = await request('/api/memory/file', {
        method: 'POST',
        headers: authHeaders(),
        body: {
          path: tempPath,
          content: '# temp'
        }
      });
      if (res.status !== 201) {
        throw new Error(`expected 201, got ${res.status} ${pickError(res.body)}`);
      }
      const data = getData(res.body);
      if (data?.path !== tempPath) {
        throw new Error(`unexpected path: ${data?.path}`);
      }
    });

    await check('GET /api/memory/file read temp', async () => {
      const res = await request(`/api/memory/file?path=${encodeURIComponent(tempPath)}`, {
        headers: authHeaders()
      });
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status} ${pickError(res.body)}`);
      }
      const data = getData(res.body);
      if (data?.path !== tempPath) {
        throw new Error(`unexpected path: ${data?.path}`);
      }
    });

    await check('PUT /api/memory/file write temp', async () => {
      const res = await request('/api/memory/file', {
        method: 'PUT',
        headers: authHeaders(),
        body: {
          path: tempPath,
          content: writeContent
        }
      });
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status} ${pickError(res.body)}`);
      }
    });

    let compressedPreview = null;
    await check('POST /api/memory/compress preview', async () => {
      const res = await request('/api/memory/compress', {
        method: 'POST',
        headers: authHeaders(),
        body: {
          path: tempPath,
          apply: false
        }
      });
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status} ${pickError(res.body)}`);
      }
      const data = getData(res.body);
      compressedPreview = data;
      if (data?.path !== tempPath) {
        throw new Error(`unexpected path: ${data?.path}`);
      }
      if (data?.applied !== false) {
        throw new Error('preview should return applied=false');
      }
      if (typeof data?.compressedContent !== 'string') {
        throw new Error('missing compressedContent');
      }
      if ((data?.compressedLength || 0) > (data?.originalLength || 0)) {
        throw new Error('compressedLength should not exceed originalLength in this test case');
      }
    });

    await check('POST /api/memory/compress apply', async () => {
      const res = await request('/api/memory/compress', {
        method: 'POST',
        headers: authHeaders(),
        body: {
          path: tempPath,
          apply: true
        }
      });
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status} ${pickError(res.body)}`);
      }
      const data = getData(res.body);
      if (data?.applied !== true) {
        throw new Error('apply should return applied=true');
      }
      if (compressedPreview && data.compressedContent !== compressedPreview.compressedContent) {
        throw new Error('apply compressedContent mismatch with preview');
      }

      const verify = await request(`/api/memory/file?path=${encodeURIComponent(tempPath)}`, {
        headers: authHeaders()
      });
      if (verify.status !== 200) {
        throw new Error(`read after apply failed: ${verify.status}`);
      }
      const verifyData = getData(verify.body);
      if (verifyData?.content !== data.compressedContent) {
        throw new Error('file content mismatch after apply');
      }
    });

    await check('GET /api/memory/extract', async () => {
      const res = await request(`/api/memory/extract?q=${encodeURIComponent(extractToken)}&limit=5`, {
        headers: authHeaders()
      });
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status} ${pickError(res.body)}`);
      }
      const data = getData(res.body);
      const rows = Array.isArray(data?.results) ? data.results : [];
      if (!rows.length) {
        throw new Error('expected non-empty extract results');
      }
      const hit = rows.find((row) => row && row.path === tempPath);
      if (!hit) {
        throw new Error('expected extract result from temp file');
      }
      if (!Number.isInteger(hit.lineStart) || !Number.isInteger(hit.lineEnd) || typeof hit.score !== 'number') {
        throw new Error('extract result shape invalid');
      }
      if (typeof hit.snippet !== 'string' || !hit.snippet.includes(extractToken)) {
        throw new Error('extract snippet missing expected token');
      }
    });

    await check('POST /api/memory/rename', async () => {
      const res = await request('/api/memory/rename', {
        method: 'POST',
        headers: authHeaders(),
        body: {
          fromPath: tempPath,
          toPath: renamedPath
        }
      });
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status} ${pickError(res.body)}`);
      }
      const data = getData(res.body);
      if (data?.fromPath !== tempPath || data?.toPath !== renamedPath) {
        throw new Error(`unexpected rename result: ${JSON.stringify(data)}`);
      }
    });

    await check('DELETE /api/memory/file', async () => {
      const res = await request(`/api/memory/file?path=${encodeURIComponent(renamedPath)}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status} ${pickError(res.body)}`);
      }

      const verify = await request(`/api/memory/file?path=${encodeURIComponent(renamedPath)}`, {
        headers: authHeaders()
      });
      if (verify.status === 200) {
        throw new Error('expected read deleted file to fail');
      }
    });
  } finally {
    if (token) {
      await cleanupPath(tempPath);
      await cleanupPath(renamedPath);

      await request('/api/auth/logout', {
        method: 'POST',
        headers: authHeaders()
      }).catch(() => {});
    }
  }

  if (cleanupFailures.length > 0) {
    for (const item of cleanupFailures) {
      failures.push(`cleanup: ${item}`);
    }
  }

  if (failures.length > 0) {
    console.error('\nMemory workspace check failed:');
    for (const item of failures) {
      console.error(`- ${item}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nMemory workspace check passed.');
}

main().catch((error) => {
  console.error('Fatal memory workspace check error:', error);
  process.exitCode = 1;
});
