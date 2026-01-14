const COUPANG_HOST = 'https://api-gateway.coupang.com';
const API_PREFIX = '/v2/providers/affiliate_open_api/apis/openapi/v1';

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

export const onRequestGet = async ({ request, env, params }) => {
  const url = new URL(request.url);
  const categoryId = String(params?.categoryId || '').trim();
  if (!/^\d+$/.test(categoryId)) {
    return json({ error: 'Invalid categoryId' }, { status: 400 });
  }

  const accessKey = env.COUPANG_ACCESS_KEY;
  const secretKey = env.COUPANG_SECRET_KEY;
  if (!accessKey || !secretKey) {
    return json({ error: 'Missing Coupang credentials' }, { status: 500 });
  }

  const limitRaw = url.searchParams.get('limit');
  const outputLimit = limitRaw ? Math.max(1, Math.min(50, parseInt(limitRaw, 10) || 4)) : 4;
  const fetchLimit = Math.min(100, Math.max(10, outputLimit * 5));
  const imageSize = url.searchParams.get('imageSize') || '512x512';
  const subId = url.searchParams.get('subId') || env.COUPANG_SUB_ID || '';
  const minPriceRaw = url.searchParams.get('minPrice');
  const minPrice = minPriceRaw == null ? 0 : Math.max(0, parseInt(minPriceRaw, 10) || 0);

  const query = new URLSearchParams();
  query.set('limit', String(fetchLimit));
  if (subId) query.set('subId', subId);
  if (imageSize) query.set('imageSize', imageSize);
  const queryString = query.toString();

  const bestPath = `${API_PREFIX}/products/bestcategories/${categoryId}`;
  let best;
  try {
    best = await coupangFetch({ accessKey, secretKey, method: 'GET', path: bestPath, query: queryString });
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

  if (!isOkReturnCode(best)) {
    return json(
      {
        error: 'Upstream error',
        message: best?.rMessage || best?.message || 'Coupang API returned an error',
        details: best || null,
      },
      { status: 502 },
    );
  }

  const list = pickList(best);
  const rawProducts = list.slice(0, fetchLimit);
  const filtered = rawProducts
    .map((p) => ({
      id: p?.productId ?? p?.id ?? null,
      name: p?.productName ?? p?.name ?? '',
      price: typeof p?.productPrice === 'number' ? p.productPrice : Number(p?.productPrice) || null,
      image: p?.productImage ?? p?.image ?? '',
      url: p?.productUrl ?? p?.url ?? '',
      categoryName: p?.categoryName ?? '',
      isRocket: Boolean(p?.isRocket),
      isFreeShipping: Boolean(p?.isFreeShipping),
    }))
    .filter((p) => p.url && p.image && p.name)
    .filter((p) => typeof p.price === 'number' && p.price >= minPrice);

  const products = filtered.slice(0, outputLimit);

  // bestcategories 응답의 productUrl은 link.coupang.com 형태(이미 제휴 링크)로 내려오는 경우가 많아 그대로 사용합니다.
  return json(
    {
      ok: true,
      categoryId: Number(categoryId),
      minPrice,
      fetchedAt: new Date().toISOString(),
      products,
    },
    { headers: { 'cache-control': 'public, max-age=86400' } },
  );
};
