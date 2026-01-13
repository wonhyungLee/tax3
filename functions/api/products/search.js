import { coupangAuthHeader, validateKeys } from '../../_coupangAuth';

const API_HOST = 'https://api-gateway.coupang.com';

export async function onRequest({ env, request }) {
  if (!validateKeys(env)) {
    return new Response(JSON.stringify({ error: 'Missing Coupang credentials' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }

  const url = new URL(request.url);
  const query = url.search || '';
  const path = `/v2/providers/affiliate_open_api/apis/openapi/v1/products/search${query}`;
  const headers = await coupangAuthHeader('GET', path, env.COUPANG_ACCESS_KEY, env.COUPANG_SECRET_KEY);

  try {
    const res = await fetch(`${API_HOST}${path}`, { headers });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Coupang search failed', detail: String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
