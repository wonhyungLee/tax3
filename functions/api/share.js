const SHARE_KV_BINDINGS = ['TAX3_SHARE_KV', 'SHARE_KV', 'COUPANG_ADS_KV'];
const SHARE_VERSION = 'v1';
const META_PREFIX = `tax3:share:${SHARE_VERSION}:meta:`;
const IMG_PREFIX = `tax3:share:${SHARE_VERSION}:img:`;
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_TITLE_LEN = 120;
const MAX_SUBTITLE_LEN = 180;
const MAX_LINE_LEN = 140;
const MAX_LINES = 6;

const json = (data, init = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
};

const pickKv = (env) => {
  for (const name of SHARE_KV_BINDINGS) {
    const binding = env?.[name];
    if (binding) return { kv: binding, name };
  }
  return { kv: null, name: SHARE_KV_BINDINGS[0] };
};

const sanitizeText = (value, maxLen) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/\s+/g, ' ').slice(0, maxLen);
  return cleaned;
};

const sanitizeLines = (value) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const cleaned = sanitizeText(item, MAX_LINE_LEN);
    if (!cleaned) continue;
    out.push(cleaned);
    if (out.length >= MAX_LINES) break;
  }
  return out;
};

const decodePngDataUrl = (dataUrl) => {
  const raw = String(dataUrl ?? '').trim();
  if (!raw) return null;
  const match = /^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/.exec(raw);
  if (!match) return null;
  const b64 = match[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const createId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export const onRequestPost = async ({ request, env }) => {
  const { kv, name: bindingName } = pickKv(env);
  if (!kv) {
    return json(
      {
        ok: false,
        error: 'Missing KV binding',
        binding: bindingName,
        hint: `Cloudflare Pages 프로젝트에 KV Namespace 바인딩(${SHARE_KV_BINDINGS.join(' 또는 ')})을 추가하세요.`,
      },
      { status: 500 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const calculatorId = sanitizeText(body?.calculatorId, 32);
  const title = sanitizeText(body?.title, MAX_TITLE_LEN);
  const subtitle = sanitizeText(body?.subtitle, MAX_SUBTITLE_LEN);
  const lines = sanitizeLines(body?.lines);
  const targetPath = sanitizeText(body?.targetPath, 64);
  const imageBytes = decodePngDataUrl(body?.imageDataUrl);

  if (!title || !imageBytes) {
    return json(
      {
        ok: false,
        error: 'Missing required fields',
        required: ['title', 'imageDataUrl(data:image/png;base64,...)'],
      },
      { status: 400 },
    );
  }

  if (imageBytes.byteLength > 1_500_000) {
    return json({ ok: false, error: 'Image too large' }, { status: 413 });
  }

  const id = createId();
  const now = new Date().toISOString();

  const meta = {
    ok: true,
    v: SHARE_VERSION,
    id,
    createdAt: now,
    calculatorId,
    title,
    subtitle,
    lines,
    targetPath,
  };

  const metaKey = `${META_PREFIX}${id}`;
  const imgKey = `${IMG_PREFIX}${id}`;

  await Promise.all([
    kv.put(metaKey, JSON.stringify(meta), { expirationTtl: TTL_SECONDS }),
    kv.put(imgKey, imageBytes, { expirationTtl: TTL_SECONDS }),
  ]);

  const origin = new URL(request.url).origin;
  return json({
    ok: true,
    id,
    url: `${origin}/share/${id}`,
  });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
};

