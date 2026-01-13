import { coupangAuthHeader, validateKeys } from '../../_coupangAuth';

const API_HOST = 'https://api-gateway.coupang.com';

export async function onRequest({ params, env, request }) {
  const { id } = params;
  const { accessKey, secretKey } = validateKeys(env);
  if (!accessKey || !secretKey) {
    return new Response(
      JSON.stringify({ error: 'Missing Coupang credentials', required: ['COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY'] }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const url = new URL(request.url);
  const query = url.search || '';
  const path = `/v2/providers/affiliate_open_api/apis/openapi/v1/products/bestcategories/${id}${query}`;
  const headers = await coupangAuthHeader('GET', path, accessKey, secretKey);

  try {
    const res = await fetch(`${API_HOST}${path}`, { headers });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Coupang fetch failed', detail: String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
