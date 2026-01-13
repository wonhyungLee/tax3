import { coupangAuthHeader, validateKeys } from './_coupangAuth';

const API_HOST = 'https://api-gateway.coupang.com';

export async function onRequestPost({ request, env }) {
  const { accessKey, secretKey, partnerId } = validateKeys(env);
  if (!accessKey || !secretKey) {
    return new Response(JSON.stringify({ error: 'Missing Coupang credentials', required: ['COUPANG_ACCESS_KEY', 'COUPANG_SECRET_KEY'] }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const body = await request.json().catch(() => ({}));
  const coupangUrl = body?.coupangUrl;
  if (!coupangUrl) {
    return new Response(JSON.stringify({ error: 'coupangUrl is required' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }

  const path = `/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink`;
  const headers = {
    ...(await coupangAuthHeader('POST', path, accessKey, secretKey)),
    'content-type': 'application/json',
  };

  try {
    const res = await fetch(`${API_HOST}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        coupangUrls: [coupangUrl],
        subId: partnerId,
      }),
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), { status: res.status, headers: { 'content-type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Coupang deeplink failed', detail: String(err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
