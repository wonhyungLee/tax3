const SHARE_KV_BINDINGS = ['TAX3_SHARE_KV', 'SHARE_KV', 'COUPANG_ADS_KV'];
const SHARE_VERSION = 'v1';
const IMG_PREFIX = `tax3:share:${SHARE_VERSION}:img:`;

const pickKv = (env) => {
  for (const name of SHARE_KV_BINDINGS) {
    const binding = env?.[name];
    if (binding) return { kv: binding, name };
  }
  return { kv: null, name: SHARE_KV_BINDINGS[0] };
};

export const onRequestGet = async ({ env, params }) => {
  const { kv } = pickKv(env);
  if (!kv) return new Response('Missing KV binding', { status: 500 });

  const id = String(params?.id || '').trim();
  if (!id) return new Response('Not found', { status: 404 });

  const img = await kv.get(`${IMG_PREFIX}${id}`, { type: 'arrayBuffer' }).catch(() => null);
  if (!img) return new Response('Not found', { status: 404 });

  return new Response(img, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};

