import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const ssrDir = path.join(projectRoot, 'dist-ssr');

const stripTrailingSlash = (value) => value.replace(/\/+$/, '');

const normalizeBaseUrl = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return stripTrailingSlash(withProtocol);
};

const siteUrl =
  normalizeBaseUrl(process.env.SITE_URL) ||
  normalizeBaseUrl(process.env.CF_PAGES_URL) ||
  'https://tax3.pages.dev';

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeXml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const joinUrl = (base, pathname) => {
  if (!pathname.startsWith('/')) return `${base}/${pathname}`;
  return `${base}${pathname}`;
};

const pages = [
  {
    path: '/',
    title: '세금 계산기 | 연말정산 · 법인세 · 종합소득세 | Tax Unified',
    description: '연말정산·법인세·종합소득세를 카드형 단계로 입력해 빠르게 추정합니다. PDF 업로드(가능 범위)와 누진세율/건보료 리스크 안내를 제공합니다.',
  },
  {
    path: '/yearend-tax',
    title: '연말정산 계산기 | 환급/추납 추정 | Tax Unified',
    description: '급여·원천세·부양가족·공제 항목을 단계별 카드로 입력해 연말정산 환급/추납을 빠르게 추정합니다. PDF 업로드(가능 범위)를 지원합니다.',
    faq: [
      {
        q: 'PDF로 자동 입력이 가능한가요?',
        a: '급여명세서/지급명세서 PDF에서 일부 항목을 추출해 입력을 줄이는 방식입니다. 양식이 다르면 일부 값은 직접 확인이 필요합니다.',
      },
      {
        q: '계산 결과가 확정 세액과 다를 수 있나요?',
        a: '네. 본 서비스는 추정치이며, 공제 요건/한도/증빙 인정 여부에 따라 실제 정산 결과가 달라질 수 있습니다.',
      },
    ],
  },
  {
    path: '/corporate-tax',
    title: '법인세 계산기 | 세무조정·결손금·세액공제 | Tax Unified',
    description: '손익·세무조정·결손금·기납부·세액공제를 단계로 입력해 법인세를 시뮬레이션합니다. 재무제표/신고서 PDF 참고(가능 범위)를 지원합니다.',
    faq: [
      {
        q: '세무조정까지 자동으로 되는 건가요?',
        a: '자동 판단까지는 어렵고, 사용자가 금액(가산/차감)을 입력하면 계산에 반영되는 형태입니다.',
      },
      {
        q: '세액공제는 어떤 것들이 있나요?',
        a: 'R&D/투자 등 일부 항목을 입력받아 반영합니다. 실제 적용 가능 여부는 요건 충족/증빙에 따라 달라질 수 있습니다.',
      },
    ],
  },
  {
    path: '/income-tax',
    title: '종합소득세 계산기 | 종합과세 vs 분리과세 비교 | Tax Unified',
    description: '이자·배당 등 금융소득(2,000만 원 기준)과 다른 종합소득을 함께 놓고 종합과세/분리과세를 비교합니다. 누진세율 구간·건보료 리스크·기납부세액을 반영합니다.',
    faq: [
      {
        q: '종합과세/분리과세 비교가 중요한 이유는?',
        a: '2,000만 원까지는 분리과세(원천징수로 종결)로 끝나지만, 초과분은 다른 소득과 합산되어 누진세율을 적용받아 세 부담이 급증할 수 있습니다.',
      },
      {
        q: '건강보험료(소득월액/피부양자)까지 정확히 계산되나요?',
        a: '정밀한 산정은 자격/재산/부과기준 등 변수가 많아 단순화된 안내 수준으로 제공됩니다. 실제 부과는 공단 기준에 따릅니다.',
      },
      {
        q: '기납부세액(3.3%)이 환급/납부에 어떻게 반영되나요?',
        a: '이미 낸 세액을 입력하면 결정세액과 비교해 환급/추납을 추정합니다. 실제 환급/납부는 신고 내용과 원천징수 내역에 따라 달라질 수 있습니다.',
      },
    ],
  },
];

const removeExistingSeo = (html) => {
  return html
    .replace(/<meta\s+name="description"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '')
    .replace(/<meta\s+property="og:[^"]+"[^>]*>\s*/gi, '')
    .replace(/<meta\s+name="twitter:[^"]+"[^>]*>\s*/gi, '')
    .replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi, '');
};

const buildJsonLd = ({ canonicalUrl, title, description, faq }) => {
  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: `${siteUrl}/`,
      name: 'Tax Unified',
      inLanguage: 'ko-KR',
    },
    {
      '@type': 'WebPage',
      '@id': `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: title,
      description,
      isPartOf: { '@id': `${siteUrl}/#website` },
      inLanguage: 'ko-KR',
    },
  ];

  if (Array.isArray(faq) && faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonicalUrl}#faq`,
      isPartOf: { '@id': `${canonicalUrl}#webpage` },
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
};

const injectSeo = (html, { path: pathname, title, description, faq }) => {
  const canonicalUrl = joinUrl(siteUrl, pathname === '/' ? '/' : pathname);
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const jsonLd = buildJsonLd({ canonicalUrl, title, description, faq });
  const jsonLdText = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  const seoTags = [
    `<meta name="description" content="${safeDescription}">`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="ko_KR">`,
    `<meta property="og:title" content="${safeTitle}">`,
    `<meta property="og:description" content="${safeDescription}">`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${safeTitle}">`,
    `<meta name="twitter:description" content="${safeDescription}">`,
    `<script type="application/ld+json">${jsonLdText}</script>`,
  ].join('\n    ');

  let next = html.replace(/<title>.*?<\/title>/i, `<title>${safeTitle}</title>`);
  next = removeExistingSeo(next);
  next = next.replace('</head>', `    ${seoTags}\n  </head>`);
  return next;
};

const injectAppHtml = (html, appHtml) => {
  const marker = '<div id="root"></div>';
  if (html.includes(marker)) {
    return html.replace(marker, `<div id="root">${appHtml}</div>`);
  }

  return html.replace(/<div\s+id="root">[\s\S]*?<\/div>/i, `<div id="root">${appHtml}</div>`);
};

const resolveSsrEntry = async () => {
  const candidates = ['entry-server.js', 'entry-server.mjs', 'entry-server.cjs'].map((name) => path.join(ssrDir, name));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  const files = await fs.readdir(ssrDir);
  const jsFile = files.find((file) => file.includes('entry-server') && file.endsWith('.js'));
  if (jsFile) return path.join(ssrDir, jsFile);

  throw new Error(`SSR entry not found in ${ssrDir}`);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const writeFileEnsuringDir = async (filePath, content) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
};

const main = async () => {
  const templatePath = path.join(distDir, 'index.html');
  const template = await fs.readFile(templatePath, 'utf8');

  const ssrEntry = await resolveSsrEntry();
  const ssrModule = await import(pathToFileURL(ssrEntry).href);
  if (typeof ssrModule.render !== 'function') {
    throw new Error(`SSR module at ${ssrEntry} does not export render(url)`);
  }

  const nowIsoDate = new Date().toISOString().slice(0, 10);

  for (const page of pages) {
    const appHtml = ssrModule.render(page.path);
    let html = injectAppHtml(template, appHtml);
    html = injectSeo(html, page);

    const outPath =
      page.path === '/'
        ? path.join(distDir, 'index.html')
        : path.join(distDir, page.path.replace(/^\//, ''), 'index.html');

    await writeFileEnsuringDir(outPath, html);
  }

  const sitemapUrls = pages.map((p) => joinUrl(siteUrl, p.path === '/' ? '/' : p.path));
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    sitemapUrls
      .map((loc) => `  <url><loc>${escapeXml(loc)}</loc><lastmod>${nowIsoDate}</lastmod></url>`)
      .join('\n') +
    `\n</urlset>\n`;

  await writeFileEnsuringDir(path.join(distDir, 'sitemap.xml'), sitemapXml);
  await writeFileEnsuringDir(
    path.join(distDir, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${joinUrl(siteUrl, '/sitemap.xml')}\n`
  );

  const notFound = injectSeo(injectAppHtml(template, ssrModule.render('/')), {
    path: '/404',
    title: '페이지를 찾을 수 없습니다 | Tax Unified',
    description: '요청하신 페이지를 찾을 수 없습니다. 홈으로 이동해 다시 시도해 주세요.',
  });
  await writeFileEnsuringDir(path.join(distDir, '404.html'), notFound);

  // Keep a small trace for debugging builds.
  await writeFileEnsuringDir(
    path.join(distDir, 'prerender.json'),
    JSON.stringify({ ok: true, generatedAt: new Date().toISOString(), siteUrl, pages: pages.map((p) => p.path) }, null, 2)
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
