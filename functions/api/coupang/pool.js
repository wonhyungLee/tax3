import { COUPANG_KEYWORD_GROUPS } from './_keywords.js';

const COUPANG_HOST = 'https://api-gateway.coupang.com';
const API_PREFIX = '/v2/providers/affiliate_open_api/apis/openapi/v1';

const KV_BINDING_NAME = 'COUPANG_ADS_KV';
const POOL_VERSION = 'v1';
const DEFAULT_POOL_SIZE = 60;
const MAX_POOL_SIZE = 120;
const SEARCH_LIMIT = 10;
const MAX_SEARCH_REQUESTS = 18;
const DEEPLINK_BATCH_SIZE = 20;
const CACHE_TTL_SECONDS = 60 * 60 * 48; // keep 2 days for stale fallback

const json = (data, init = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
};

const formatSignedDate = (date = new Date()) => {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const MM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const HH = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yy}${MM}${dd}T${HH}${mm}${ss}Z`;
};

const hmacSha256Hex = async (secretKey, message) => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const buildAuthorization = async ({ accessKey, secretKey, method, path, query, signedDate }) => {
  const upperMethod = method.toUpperCase();
  const message = `${signedDate}${upperMethod}${path}${query || ''}`;
  const signature = await hmacSha256Hex(secretKey, message);
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;
};

const coupangFetch = async ({ accessKey, secretKey, method, path, query = '', body = null }) => {
  const signedDate = formatSignedDate(new Date());
  const authorization = await buildAuthorization({ accessKey, secretKey, method, path, query, signedDate });

  const headers = new Headers({
    Authorization: authorization,
    'X-Date': signedDate,
    Accept: 'application/json',
  });
  let requestBody = undefined;
  if (body !== null) {
    headers.set('content-type', 'application/json');
    requestBody = JSON.stringify(body);
  }

  const urlQueryString = query ? `?${query}` : '';
  const res = await fetch(`${COUPANG_HOST}${path}${urlQueryString}`, { method, headers, body: requestBody });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.message || data?.rMessage || `Coupang API error (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
};

const pickList = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.data?.productData)) return payload.data.productData;
  if (Array.isArray(payload.data?.data)) return payload.data.data;
  return [];
};

const isOkReturnCode = (payload) => payload?.rCode === 0 || payload?.rCode === '0' || payload?.rCode == null;

const clampInt = (value, fallback, min, max) => {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const normalizeKeyword = (raw) =>
  String(raw || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[·•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const kstDateKey = (now = new Date()) => {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const hashSeed = (input) => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const shuffleDeterministic = (items, seedString) => {
  const arr = items.slice();
  const rand = mulberry32(hashSeed(seedString));
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const mapLimit = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const run = async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
};

const isAffiliateUrl = (url) => {
  try {
    const u = new URL(url);
    if (u.hostname !== 'link.coupang.com') return false;
    return true;
  } catch {
    return false;
  }
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const searchProducts = async ({ accessKey, secretKey, keyword, subId, imageSize }) => {
  const query = new URLSearchParams();
  query.set('keyword', keyword);
  query.set('limit', String(SEARCH_LIMIT));
  query.set('page', '0');
  if (subId) query.set('subId', subId);
  if (imageSize) query.set('imageSize', imageSize);
  const queryString = query.toString();

  const path = `${API_PREFIX}/products/search`;
  return coupangFetch({ accessKey, secretKey, method: 'GET', path, query: queryString });
};

const convertDeeplinks = async ({ accessKey, secretKey, originalUrls }) => {
  if (!originalUrls.length) return new Map();
  const path = `${API_PREFIX}/deeplink`;
  const payload = await coupangFetch({
    accessKey,
    secretKey,
    method: 'POST',
    path,
    body: { originalUrls },
  });
  if (!isOkReturnCode(payload)) return new Map();
  const list = pickList(payload);
  const map = new Map();
  for (const item of list) {
    const original = item?.originalUrl || item?.originUrl || item?.url || null;
    const shorten = item?.shortenUrl || item?.shortUrl || item?.shortenURL || null;
    if (original && shorten) map.set(original, shorten);
  }
  return map;
};

const buildDailyPool = async ({ accessKey, secretKey, subId, dateKey, poolSize }) => {
  const rawKeywords = COUPANG_KEYWORD_GROUPS.flatMap((g) => g.keywords);
  const keywords = Array.from(new Set(rawKeywords.map(normalizeKeyword).filter(Boolean)));
  const shuffled = shuffleDeterministic(keywords, `${POOL_VERSION}:${dateKey}`);
  const selected = shuffled.slice(0, Math.min(MAX_SEARCH_REQUESTS, shuffled.length));

  const searchResults = await mapLimit(
    selected,
    4,
    async (keyword) => {
      try {
        const payload = await searchProducts({ accessKey, secretKey, keyword, subId, imageSize: '512x512' });
        if (!isOkReturnCode(payload)) return { keyword, products: [] };
        return { keyword, products: pickList(payload) };
      } catch {
        return { keyword, products: [] };
      }
    },
  );

  const dedup = new Set();
  const rawPool = [];
  for (const entry of searchResults) {
    const keyword = entry?.keyword || '';
    const list = Array.isArray(entry?.products) ? entry.products : [];
    for (const p of list) {
      const productId = p?.productId ?? p?.id ?? null;
      const productUrl = p?.productUrl ?? p?.url ?? '';
      const key = productUrl || productId;
      if (!key || dedup.has(key)) continue;
      dedup.add(key);
      rawPool.push({
        id: productId,
        name: p?.productName ?? p?.name ?? '',
        price: typeof p?.productPrice === 'number' ? p.productPrice : Number(p?.productPrice) || null,
        image: p?.productImage ?? p?.image ?? '',
        url: productUrl,
        keyword,
        categoryName: p?.categoryName ?? '',
        isRocket: Boolean(p?.isRocket),
        isFreeShipping: Boolean(p?.isFreeShipping),
        discountRate:
          typeof p?.productDiscountRate === 'number'
            ? p.productDiscountRate
            : Number(p?.productDiscountRate) || null,
        rating:
          typeof p?.productRating === 'number'
            ? p.productRating
            : Number(p?.productRating) || null,
        reviewCount:
          typeof p?.reviewCount === 'number'
            ? p.reviewCount
            : Number(p?.reviewCount) || null,
      });
      if (rawPool.length >= poolSize * 2) break;
    }
    if (rawPool.length >= poolSize * 2) break;
  }

  const pool = rawPool
    .filter((p) => p.url && p.image && p.name)
    .slice(0, Math.min(MAX_POOL_SIZE, Math.max(poolSize, DEFAULT_POOL_SIZE) * 2));

  const urlsToConvert = Array.from(
    new Set(
      pool
        .map((p) => p.url)
        .filter((u) => u && !isAffiliateUrl(u)),
    ),
  );

  const deeplinkMaps = [];
  for (const batch of chunk(urlsToConvert, DEEPLINK_BATCH_SIZE)) {
    try {
      deeplinkMaps.push(await convertDeeplinks({ accessKey, secretKey, originalUrls: batch }));
    } catch {
      deeplinkMaps.push(new Map());
    }
  }
  const deeplinkMap = new Map();
  for (const m of deeplinkMaps) for (const [k, v] of m.entries()) deeplinkMap.set(k, v);

  const finalPool = pool
    .map((p) => ({
      ...p,
      url: deeplinkMap.get(p.url) || p.url,
    }))
    .slice(0, poolSize);

  return {
    ok: true,
    version: POOL_VERSION,
    dateKey,
    generatedAt: new Date().toISOString(),
    keywordsUsed: selected.slice(0, Math.min(12, selected.length)),
    products: finalPool,
  };
};

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);

  const accessKey = env.COUPANG_ACCESS_KEY;
  const secretKey = env.COUPANG_SECRET_KEY;
  const subId = env.COUPANG_SUB_ID || '';
  if (!accessKey || !secretKey) {
    return json({ error: 'Missing Coupang credentials' }, { status: 500 });
  }

  const kv = env[KV_BINDING_NAME];
  if (!kv) {
    return json(
      {
        error: 'Missing KV binding',
        binding: KV_BINDING_NAME,
        hint: 'Cloudflare Pages 프로젝트에 KV Namespace 바인딩을 추가하세요.',
      },
      { status: 500 },
    );
  }

  const dateKey = kstDateKey(new Date());
  const poolSize = clampInt(url.searchParams.get('limit'), DEFAULT_POOL_SIZE, 4, MAX_POOL_SIZE);
  const cacheKey = `tax3:coupang:${POOL_VERSION}:pool:${dateKey}:${poolSize}`;

  const cached = await kv.get(cacheKey, { type: 'json' }).catch(() => null);
  if (cached?.ok && Array.isArray(cached?.products) && cached.products.length) {
    return json(
      { ...cached, source: 'kv' },
      {
        headers: {
          'cache-control': 'public, max-age=300',
        },
      },
    );
  }

  let fresh;
  try {
    fresh = await buildDailyPool({ accessKey, secretKey, subId, dateKey, poolSize });
  } catch (error) {
    return json(
      {
        error: 'Upstream error',
        message: error?.message || 'Coupang API request failed',
        details: error?.data || null,
      },
      { status: 502 },
    );
  }

  await kv.put(cacheKey, JSON.stringify(fresh), { expirationTtl: CACHE_TTL_SECONDS });
  return json(fresh, { headers: { 'cache-control': 'public, max-age=300' } });
};
