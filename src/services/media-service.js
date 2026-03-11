const fs = require('fs/promises');
const {
  MEDIA_TRENDING_PATH,
  WECHAT_CACHE_PATH
} = require('../config/paths');
const { HttpError } = require('../utils/http-error');
const { asObject, toArray } = require('../utils/text');

const WECHAT_DEFAULT_QUERY = '实用软件 免费工具 效率工具 工具测评 公众号 推荐';
const WECHAT_MIN_LIMIT = 10;
const WECHAT_MAX_LIMIT = 30;
const WECHAT_CACHE_TTL_MS = 20 * 60 * 1000;

const SEARCH_ENGINE_DOMAINS = new Set([
  'baidu.com',
  'bing.com',
  'duckduckgo.com',
  'google.com',
  'search.yahoo.com',
  'sogou.com',
  'so.com',
  'yandex.com'
]);

const WECHAT_LOCAL_FALLBACK = [
  {
    title: 'Appinn 小众软件',
    summary: '持续分享实用软件、免费工具与效率工作流。',
    url: 'https://www.appinn.com/'
  },
  {
    title: '少数派：效率标签',
    summary: '效率工具、系统方法和实战测评。',
    url: 'https://sspai.com/tag/效率'
  },
  {
    title: '少数派：自动化标签',
    summary: '自动化工具与实操案例集合。',
    url: 'https://sspai.com/tag/自动化'
  },
  {
    title: '异次元软件世界',
    summary: '免费软件、生产力工具与资源整理。',
    url: 'https://www.iplaysoft.com/'
  },
  {
    title: '果核剥壳',
    summary: '免费实用软件推荐与工具分享。',
    url: 'https://www.ghxi.com/'
  },
  {
    title: 'RunningCheese',
    summary: '效率工具与浏览器生产力玩法。',
    url: 'https://www.runningcheese.com/'
  },
  {
    title: 'Awesome Selfhosted',
    summary: '开源自托管工具大全，适合构建个人效率栈。',
    url: 'https://github.com/awesome-selfhosted/awesome-selfhosted'
  },
  {
    title: 'GitHub Productivity Topic',
    summary: '生产力相关开源项目聚合页。',
    url: 'https://github.com/topics/productivity'
  },
  {
    title: 'AlternativeTo: Notion Alternatives',
    summary: '替代工具检索，适合找免费同类工具。',
    url: 'https://alternativeto.net/software/notion/'
  },
  {
    title: 'Product Hunt: Productivity',
    summary: '新品工具发现与用户评价。',
    url: 'https://www.producthunt.com/topics/productivity'
  },
  {
    title: 'Zapier: Best Free Productivity Apps',
    summary: '免费生产力应用推荐清单。',
    url: 'https://zapier.com/blog/best-free-productivity-apps/'
  },
  {
    title: 'MakeUseOf: Best Free Apps',
    summary: '免费工具合集与分类推荐。',
    url: 'https://www.makeuseof.com/tag/best-free-apps/'
  },
  {
    title: '吾爱破解原创发布区',
    summary: '实用工具与软件资源讨论区。',
    url: 'https://www.52pojie.cn/forum-16-1.html'
  }
];

function clampNumber(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(value, maxLen = 320) {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 3))}...`;
}

function pickFirstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function normalizeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeMetric(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  return null;
}

function emptyMetrics() {
  return {
    read: null,
    like: null,
    share: null,
    favorite: null,
    watching: null
  };
}

function sanitizeMetrics(input) {
  const metrics = input && typeof input === 'object' ? input : {};
  return {
    read: normalizeMetric(metrics.read),
    like: normalizeMetric(metrics.like),
    share: normalizeMetric(metrics.share),
    favorite: normalizeMetric(metrics.favorite),
    watching: normalizeMetric(metrics.watching)
  };
}

function normalizeHeatScore(value) {
  if (!Number.isFinite(value)) return 0;
  const n = Number(value);
  const scaled = n <= 1 ? n * 100 : n;
  return Number(Math.min(100, Math.max(0, scaled)).toFixed(2));
}

function calculateHeatScore(metrics, tavilyScore) {
  const vals = [metrics.read, metrics.like, metrics.share, metrics.favorite, metrics.watching]
    .filter((v) => Number.isFinite(v));

  const metricsPart = vals.length
    ? (vals.reduce((sum, v) => sum + Math.log10(v + 1), 0) / vals.length) * 18
    : 0;
  const scorePart = Number.isFinite(tavilyScore)
    ? Math.min(1, Math.max(0, Number(tavilyScore))) * 30
    : 0;
  return Number(Math.min(100, metricsPart + scorePart).toFixed(2));
}

function normalizeArticleUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return '';
  try {
    const url = new URL(input.trim());
    if (!/^https?:$/.test(url.protocol)) return '';
    const removeKeys = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'spm'
    ];
    for (const key of removeKeys) url.searchParams.delete(key);
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function domainFromUrl(input) {
  try {
    const host = new URL(input).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isSearchEngineUrl(input) {
  const domain = domainFromUrl(input);
  if (!domain) return true;
  for (const item of SEARCH_ENGINE_DOMAINS) {
    if (domain === item || domain.endsWith(`.${item}`)) return true;
  }
  return false;
}

function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseHumanNumber(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[,，\s+]/g, '').toLowerCase();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([万亿wkm]?)$/i);
  if (!match) return null;
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return null;
  const unit = (match[2] || '').toLowerCase();
  let multiplier = 1;
  if (unit === '万' || unit === 'w') multiplier = 1e4;
  if (unit === '亿') multiplier = 1e8;
  if (unit === 'k') multiplier = 1e3;
  if (unit === 'm') multiplier = 1e6;
  return Math.round(base * multiplier);
}

function extractMetricValue(text, keywords) {
  if (!text) return null;
  const tokenPattern = '(\\d[\\d,.]*(?:\\.\\d+)?\\s*[万亿wWkKmM]?)';
  for (const keyword of keywords) {
    const escaped = escapeRegex(keyword);
    const p1 = new RegExp(`${escaped}(?:量|数|人数)?\\s*[:：]?\\s*${tokenPattern}`, 'i');
    const p2 = new RegExp(`${tokenPattern}\\s*${escaped}(?:量|数|人数)?`, 'i');
    const m1 = text.match(p1);
    if (m1 && m1[1]) {
      const parsed = parseHumanNumber(m1[1]);
      if (Number.isFinite(parsed)) return parsed;
    }
    const m2 = text.match(p2);
    if (m2 && m2[1]) {
      const parsed = parseHumanNumber(m2[1]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function extractMetrics(text) {
  const payload = text || '';
  return {
    read: extractMetricValue(payload, ['阅读', '浏览']),
    like: extractMetricValue(payload, ['点赞', '喜欢']),
    share: extractMetricValue(payload, ['转发', '分享']),
    favorite: extractMetricValue(payload, ['收藏']),
    watching: extractMetricValue(payload, ['在看'])
  };
}

function buildCacheKey(query) {
  return String(query || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function sanitizeRecommendationItem(raw, fallbackFetchedAt) {
  if (!raw || typeof raw !== 'object') return null;
  const url = normalizeArticleUrl(pickFirstText(raw.url, raw.link, raw.href));
  if (!url || isSearchEngineUrl(url)) return null;

  const title = cleanText(pickFirstText(raw.title, raw.name, raw.text), 180) || '未命名文章';
  const source = cleanText(pickFirstText(raw.source), 80) || domainFromUrl(url) || '-';
  const publishedAt = normalizeDate(raw.publishedAt || raw.published_date || raw.date);
  const summary = cleanText(
    pickFirstText(raw.summary, raw.content, raw.snippet, raw.description, raw.idea),
    320
  );
  const metrics = sanitizeMetrics(raw.metrics);
  const heatScore = Number.isFinite(raw.heatScore)
    ? normalizeHeatScore(raw.heatScore)
    : calculateHeatScore(metrics, null);
  const fetchedAt = normalizeDate(raw.fetchedAt) || fallbackFetchedAt || new Date().toISOString();

  return {
    title,
    url,
    source,
    publishedAt,
    summary,
    metrics,
    heatScore,
    fetchedAt
  };
}

function dedupeRecommendations(items) {
  const map = new Map();
  for (const item of items) {
    const normalized = sanitizeRecommendationItem(item);
    if (!normalized) continue;
    if (!map.has(normalized.url)) {
      map.set(normalized.url, normalized);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.heatScore - a.heatScore);
}

async function readWechatCache() {
  try {
    const raw = await fs.readFile(WECHAT_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      updatedAt: normalizeDate(parsed?.updatedAt),
      queries: parsed?.queries && typeof parsed.queries === 'object' ? parsed.queries : {}
    };
  } catch {
    return { updatedAt: null, queries: {} };
  }
}

async function saveWechatCache(cache) {
  await fs.writeFile(WECHAT_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function flattenCacheItems(cache, excludeKey) {
  const out = [];
  const queries = cache?.queries && typeof cache.queries === 'object' ? cache.queries : {};
  for (const [key, entry] of Object.entries(queries)) {
    if (key === excludeKey) continue;
    out.push(...toArray(entry?.items));
  }
  return dedupeRecommendations(out);
}

async function loadLocalWechatFallback(fetchedAt) {
  const rows = [];
  try {
    const raw = await fs.readFile(MEDIA_TRENDING_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const wechatArticles = toArray(parsed?.wechat?.articles);
    for (const row of wechatArticles) {
      rows.push(
        sanitizeRecommendationItem(
          {
            title: row?.title,
            url: row?.url,
            summary: pickFirstText(row?.idea, row?.tag),
            source: row?.source,
            fetchedAt,
            metrics: emptyMetrics(),
            heatScore: 0
          },
          fetchedAt
        )
      );
    }
  } catch {
    // ignore
  }

  for (const item of WECHAT_LOCAL_FALLBACK) {
    rows.push(
      sanitizeRecommendationItem(
        {
          ...item,
          metrics: emptyMetrics(),
          fetchedAt,
          heatScore: 0
        },
        fetchedAt
      )
    );
  }

  return dedupeRecommendations(rows.filter(Boolean));
}

async function fetchWechatFromTavily(query, limit, fetchedAt, apiKey) {
  const payload = {
    api_key: apiKey,
    query,
    topic: 'general',
    search_depth: 'basic',
    max_results: Math.min(30, Math.max(WECHAT_MIN_LIMIT, limit) * 2),
    include_answer: false,
    include_images: false,
    include_raw_content: false
  };

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4500)
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const detail = cleanText(
      pickFirstText(data?.error, data?.message, data?.detail),
      220
    );
    throw new Error(detail || `Tavily request failed (${response.status})`);
  }

  const results = toArray(data?.results);
  const rows = [];

  for (const result of results) {
    const url = normalizeArticleUrl(result?.url);
    if (!url || isSearchEngineUrl(url)) continue;

    const summary = cleanText(
      pickFirstText(result?.content, result?.snippet, result?.description),
      320
    );

    const rawText = [
      pickFirstText(result?.title),
      summary,
      cleanText(pickFirstText(result?.raw_content), 800)
    ]
      .filter(Boolean)
      .join(' ');

    const metrics = extractMetrics(rawText);
    const heatScore = calculateHeatScore(metrics, result?.score);

    rows.push(
      sanitizeRecommendationItem(
        {
          title: pickFirstText(result?.title),
          url,
          source: domainFromUrl(url),
          publishedAt: normalizeDate(result?.published_date || result?.publishedAt),
          summary,
          metrics,
          heatScore,
          fetchedAt
        },
        fetchedAt
      )
    );
  }

  return dedupeRecommendations(rows.filter(Boolean));
}

class MediaService {
  async getTrending() {
    try {
      const raw = await fs.readFile(MEDIA_TRENDING_PATH, 'utf8');
      const data = JSON.parse(raw);
      return data;
    } catch (err) {
      throw new HttpError(500, 'TRENDING_READ_FAILED', err?.message || 'Failed to read trending data');
    }
  }

  async getWechatRecommendations(options = {}) {
    const q = typeof options.query === 'string' ? options.query.trim() : '';
    const limit = clampNumber(options.limit, WECHAT_MIN_LIMIT, WECHAT_MAX_LIMIT, WECHAT_MIN_LIMIT);
    const query = q || WECHAT_DEFAULT_QUERY;
    const queryKey = buildCacheKey(query);
    const nowIso = new Date().toISOString();
    const warnings = [];
    const tavilyKey = pickFirstText(process.env.TAVILY_API_KEY);

    if (!tavilyKey) {
      warnings.push('TAVILY_API_KEY 未配置，已使用缓存/本地兜底数据。');
    }

    const cache = await readWechatCache();
    const currentEntry = asObject(cache?.queries)?.[queryKey] || null;
    const cachedItems = dedupeRecommendations(toArray(currentEntry?.items));
    const cacheFetchedAt = normalizeDate(currentEntry?.fetchedAt);
    const cacheIsFresh =
      cacheFetchedAt && Date.now() - new Date(cacheFetchedAt).getTime() <= WECHAT_CACHE_TTL_MS;

    const cacheHasRichSignals = cachedItems.some((item) => {
      const metrics = asObject(item?.metrics);
      const hasMetric = Object.values(metrics).some((value) => Number.isFinite(value));
      return hasMetric || Number(item?.heatScore) > 0;
    });

    if (cacheIsFresh && cachedItems.length >= limit && cacheHasRichSignals) {
      return {
        query,
        limit,
        count: limit,
        items: cachedItems.slice(0, limit),
        fetchedAt: cacheFetchedAt,
        fromCache: true,
        warnings
      };
    }

    let tavilyItems = [];
    if (tavilyKey) {
      try {
        tavilyItems = await fetchWechatFromTavily(query, limit, nowIso, tavilyKey);
      } catch (err) {
        warnings.push(`Tavily 抓取失败: ${cleanText(String(err?.message || err), 180)}`);
      }
    }

    const cachedOthers = flattenCacheItems(cache, queryKey);
    const localFallback = await loadLocalWechatFallback(nowIso);

    const merged = dedupeRecommendations([
      ...tavilyItems,
      ...cachedItems,
      ...cachedOthers,
      ...localFallback
    ]);

    let items = merged.slice(0, Math.min(limit, merged.length));
    if (items.length < WECHAT_MIN_LIMIT && merged.length >= WECHAT_MIN_LIMIT) {
      items = merged.slice(0, WECHAT_MIN_LIMIT);
    }

    if (!items.length) {
      throw new HttpError(503, 'WECHAT_RECOMMENDATIONS_UNAVAILABLE', '无法获取公众号推荐数据。请稍后重试。');
    }

    const cachePayload = dedupeRecommendations([
      ...tavilyItems,
      ...cachedItems,
      ...localFallback
    ]).slice(0, WECHAT_MAX_LIMIT);

    if (cachePayload.length) {
      cache.updatedAt = nowIso;
      cache.queries = cache.queries || {};
      cache.queries[queryKey] = {
        query,
        fetchedAt: tavilyItems.length ? nowIso : cacheFetchedAt || nowIso,
        items: cachePayload
      };
      await saveWechatCache(cache);
    }

    const responseFetchedAt = tavilyItems.length ? nowIso : cacheFetchedAt || nowIso;
    return {
      query,
      limit,
      count: items.length,
      items,
      fetchedAt: responseFetchedAt,
      fromCache: !tavilyItems.length,
      warnings
    };
  }
}

module.exports = {
  MediaService,
  WECHAT_DEFAULT_QUERY,
  WECHAT_MIN_LIMIT,
  WECHAT_MAX_LIMIT
};
