#!/usr/bin/env node

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3900';
const PASSWORD = process.env.SMOKE_PASSWORD || 'openclaw';

async function request(path, options = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {})
  };

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers
  });

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { status: res.status, body };
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

  await check('GET /api/health', async () => {
    const res = await request('/api/health');
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status} ${pickError(res.body)}`);
    }
    const data = getData(res.body);
    if (!data?.app || !data?.time) {
      throw new Error('missing app/time fields');
    }
  });

  await check('GET /api/dashboard/summary requires auth', async () => {
    const res = await request('/api/dashboard/summary');
    if (res.status !== 401) {
      throw new Error(`expected 401, got ${res.status}`);
    }
  });

  await check('POST /api/auth/login (bad password rejected)', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: '__invalid__' })
    });
    if (res.status !== 401) {
      throw new Error(`expected 401, got ${res.status}`);
    }
  });

  let token = '';
  await check('POST /api/auth/login (correct password)', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: PASSWORD })
    });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status} ${pickError(res.body)}`);
    }
    const data = getData(res.body);
    token = data?.token || res.body?.token || '';
    if (!token) {
      throw new Error('missing token in login response');
    }
  });

  const authHeaders = () => ({ authorization: `Bearer ${token}` });

  await check('GET /api/auth/me', async () => {
    const res = await request('/api/auth/me', { headers: authHeaders() });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status}`);
    }
    const data = getData(res.body);
    if (!data?.authenticated) {
      throw new Error('expected authenticated=true');
    }
  });

  await check('GET /api/dashboard/summary', async () => {
    const res = await request('/api/dashboard/summary', { headers: authHeaders() });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status}`);
    }
    const data = getData(res.body);
    if (!data?.health || !data?.skillSummary) {
      throw new Error('missing health/skillSummary');
    }
  });

  await check('GET /api/openclaw/service/status', async () => {
    const res = await request('/api/openclaw/service/status', { headers: authHeaders() });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status}`);
    }
    const data = getData(res.body);
    if (!data?.detail || typeof data.detail !== 'object') {
      throw new Error('missing detail object');
    }
  });

  await check('GET /api/skills/search-links?q=weather', async () => {
    const res = await request('/api/skills/search-links?q=weather', { headers: authHeaders() });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status}`);
    }
    const data = getData(res.body);
    if (!Array.isArray(data?.links) || data.links.length === 0) {
      throw new Error('expected non-empty links');
    }
  });

  await check('GET /api/media/wechat/recommendations?limit=10', async () => {
    const res = await request('/api/media/wechat/recommendations?limit=10', {
      headers: authHeaders()
    });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status}`);
    }
    const data = getData(res.body);
    if (!Array.isArray(data?.items) || data.items.length === 0) {
      throw new Error('expected recommendation items');
    }
  });

  await check('GET /api/content/state', async () => {
    const res = await request('/api/content/state', { headers: authHeaders() });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status}`);
    }
  });

  await check('GET /api/tasks?limit=5', async () => {
    const res = await request('/api/tasks?limit=5', { headers: authHeaders() });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status}`);
    }
  });

  await check('GET /api/squad/state', async () => {
    const res = await request('/api/squad/state', { headers: authHeaders() });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status}`);
    }
    const data = getData(res.body);
    if (!Array.isArray(data?.roles) || data.roles.length < 5) {
      throw new Error('expected seeded squad roles >= 5');
    }
  });

  await check('POST /api/squad/task auto-route(code) + review + reflection', async () => {
    const stateRes = await request('/api/squad/state', { headers: authHeaders() });
    const stateData = getData(stateRes.body);
    if (!Array.isArray(stateData?.roles) || stateData.roles.length === 0) {
      throw new Error('missing squad roles');
    }

    const createRes = await request('/api/squad/task', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        title: 'fix login bug in code path',
        description: 'dev refactor to fix regression',
        roleId: 'auto',
        weight: 1
      })
    });
    if (createRes.status !== 200) {
      throw new Error(`create task expected 200, got ${createRes.status}`);
    }

    const createdTask = getData(createRes.body)?.task;
    const taskId = createdTask?.id;
    if (!taskId) throw new Error('missing squad task id');
    if (createdTask?.roleId !== 'code-claw') {
      throw new Error(`expected auto-route to code-claw, got ${createdTask?.roleId || '-'}`);
    }
    if (!createdTask?.assignmentReason) {
      throw new Error('missing assignmentReason in squad task payload');
    }

    const reviewRes = await request(`/api/squad/task/${encodeURIComponent(taskId)}/review`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        completion: 88,
        quality: 90,
        ownerScore: 89,
        captainScore: 91,
        passed: true,
        reviewNote: 'smoke pass'
      })
    });
    if (reviewRes.status !== 200) {
      throw new Error(`review task expected 200, got ${reviewRes.status}`);
    }

    const reflectionRes = await request(
      `/api/squad/role/${encodeURIComponent(createdTask.roleId)}/reflection`,
      {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ reflection: 'smoke reflection' })
    }
    );
    if (reflectionRes.status !== 200) {
      throw new Error(`reflection expected 200, got ${reflectionRes.status}`);
    }
  });

  await check('POST /api/auth/logout', async () => {
    const res = await request('/api/auth/logout', {
      method: 'POST',
      headers: authHeaders()
    });
    if (res.status !== 200) {
      throw new Error(`expected 200, got ${res.status}`);
    }
  });

  if (failures.length > 0) {
    console.error('\nSmoke check failed:');
    for (const item of failures) console.error(`- ${item}`);
    process.exitCode = 1;
    return;
  }

  console.log('\nSmoke check passed.');
}

main().catch((error) => {
  console.error('Fatal smoke check error:', error);
  process.exitCode = 1;
});
