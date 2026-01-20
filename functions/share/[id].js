const SHARE_KV_BINDINGS = ['TAX3_SHARE_KV', 'SHARE_KV', 'COUPANG_ADS_KV'];
const SHARE_VERSION = 'v1';
const META_PREFIX = `tax3:share:${SHARE_VERSION}:meta:`;

const pickKv = (env) => {
  for (const name of SHARE_KV_BINDINGS) {
    const binding = env?.[name];
    if (binding) return { kv: binding, name };
  }
  return { kv: null, name: SHARE_KV_BINDINGS[0] };
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildDescription = (meta) => {
  const parts = [];
  if (meta?.tier) {
    const tierTitle = meta?.tierTitle ? String(meta.tierTitle) : '';
    parts.push(tierTitle ? `${meta.tier}등급 · ${tierTitle}` : `${meta.tier}등급`);
  }
  if (meta?.subtitle) parts.push(meta.subtitle);
  if (Array.isArray(meta?.lines) && meta.lines.length) {
    parts.push(...meta.lines.slice(0, 3));
  }
  parts.push('Tax Unified · 추정 결과(참고용)');
  return parts.join(' · ').slice(0, 300);
};

export const onRequestGet = async ({ request, env, params }) => {
  const { kv } = pickKv(env);
  if (!kv) return new Response('Missing KV binding', { status: 500 });

  const id = String(params?.id || '').trim();
  if (!id) return new Response('Not found', { status: 404 });

  const meta = await kv.get(`${META_PREFIX}${id}`, { type: 'json' }).catch(() => null);
  if (!meta?.ok) return new Response('Not found', { status: 404 });

  const url = new URL(request.url);
  const origin = url.origin;
  const canonical = `${origin}/share/${encodeURIComponent(id)}`;
  const imageUrl = `${origin}/og/${encodeURIComponent(id)}.png`;
  const title = meta?.title ? String(meta.title) : '세금 계산 결과';
  const description = buildDescription(meta);

  const targetPath = meta?.targetPath && String(meta.targetPath).startsWith('/') ? meta.targetPath : '/';
  const ctaUrl = `${origin}${targetPath}`;

  const bodyLines = Array.isArray(meta?.lines) ? meta.lines : [];
  const listHtml = bodyLines.length
    ? `<ul>${bodyLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
    : '';

  const tierHtml =
    meta?.tier && meta?.tierTitle
      ? `<p class="muted">${escapeHtml(`${meta.tier}등급 · ${meta.tierTitle}`)}</p>`
      : meta?.tier
        ? `<p class="muted">${escapeHtml(`${meta.tier}등급`)}</p>`
        : '';

  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${escapeHtml(title)}</title>
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:site_name" content="Tax Unified" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="세금 계산 결과 이미지" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <style>
      body{margin:0;font-family:system-ui,-apple-system,'Noto Sans KR',sans-serif;background:#f6f7fb;color:#1f2430}
      .wrap{max-width:900px;margin:0 auto;padding:24px}
      .card{background:#fff;border:1px solid #dfe3ec;border-radius:16px;padding:16px;box-shadow:0 8px 24px rgba(31,36,48,0.08)}
      .muted{color:#6f7285;line-height:1.6}
      img{max-width:100%;border-radius:14px;border:1px solid #dfe3ec}
      a.btn{display:inline-block;margin-top:12px;padding:10px 14px;border-radius:14px;text-decoration:none;font-weight:700;background:#eef3ff;border:1px solid #dfe3ec;color:#1f2430}
      h1{margin:0 0 12px;font-size:22px;letter-spacing:-0.01em}
      ul{margin:10px 0 0;padding-left:18px}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>${escapeHtml(title)}</h1>
        ${tierHtml}
        <p class="muted">${escapeHtml(meta?.subtitle || '')}</p>
        ${listHtml}
        <p class="muted">이 페이지는 공유용 미리보기입니다. 실제 신고/정산 결과는 달라질 수 있습니다.</p>
        <img src="${escapeHtml(imageUrl)}" alt="세금 계산 결과 이미지" loading="lazy" />
        <div><a class="btn" href="${escapeHtml(ctaUrl)}">계산기 열기</a></div>
      </div>
    </div>
  </body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
