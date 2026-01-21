const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.trunc(value)));

const CALC_BASE_WON = {
  yearend: 300_000,
  corporate: 10_000_000,
  financial: 1_000_000,
};

const getBase = (calculatorId) => CALC_BASE_WON[calculatorId] ?? 300_000;

const buildBreakpoints = (base) => [-base * 30, -base * 10, -base * 3, -base, 0, base, base * 3, base * 10];

const pickTierAscending = (amountWon, breakpoints) => {
  if (!Number.isFinite(amountWon)) return 5;
  let idx = 0;
  for (const b of breakpoints) if (amountWon >= b) idx += 1;
  return clampInt(idx + 1, 1, 9);
};

const invertTier = (tier) => clampInt(10 - tier, 1, 9);

const pickTier = (amountWon, breakpoints) => invertTier(pickTierAscending(amountWon, breakpoints));

const TIER_COPY = [
  { title: '환급 레전드', tagline: '오늘은 세금이 당신 편. 결과 공유하고 뿌듯해하자.' },
  { title: '환급 MVP', tagline: '공제/경비 운영이 깔끔하다. 이제는 “증빙”이 핵심.' },
  { title: '환급 달인', tagline: '필수 체크를 잘 챙겼다. 남은 건 누락 방지!' },
  { title: '환급 예고', tagline: '커피값 정도는 돌아올지도. 작은 항목이 큰 차이를 만든다.' },
  { title: '균형의 수호자', tagline: '크게 흔들리지 않는 편. 최적화 여지는 아직 있다.' },
  { title: '아슬아슬', tagline: '거의 무승부. 놓친 공제/경비가 없는지 한 번만 더.' },
  { title: '납부 숙련', tagline: '방심 금지. 한 번만 더 점검하면 체감이 달라진다.' },
  { title: '지갑이 운다', tagline: '납부는 아프지만, 증빙은 배신하지 않는다.' },
  { title: '세금 보스', tagline: '오늘은 납부가 주인공… 다음엔 공제 아이템을 챙겨보자.' },
];

const TIER_PALETTES = [
  { bgA: '#e7fff3', bgB: '#e7f6ff', accentA: '#7be4c7', accentB: '#6fb4ff' },
  { bgA: '#e8fff6', bgB: '#e7f6ff', accentA: '#7be4c7', accentB: '#9dd4ff' },
  { bgA: '#eafcff', bgB: '#e7fff3', accentA: '#7be4c7', accentB: '#6fb4ff' },
  { bgA: '#eef7ff', bgB: '#eaf6ff', accentA: '#6fb4ff', accentB: '#9dd4ff' },
  { bgA: '#f7f9ff', bgB: '#fff1f7', accentA: '#6fb4ff', accentB: '#f6a5c0' },
  { bgA: '#f6fff2', bgB: '#e9fff5', accentA: '#7be4c7', accentB: '#6fb4ff' },
  { bgA: '#fffbe6', bgB: '#fff1c7', accentA: '#ffd66f', accentB: '#ffb4a2' },
  { bgA: '#fff7ed', bgB: '#ffe7d6', accentA: '#ffb86b', accentB: '#ff7aa2' },
  { bgA: '#fff1f3', bgB: '#ffe4e6', accentA: '#ff7aa2', accentB: '#ffb4a2' },
];

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const svgToDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const buildTierSvg = ({ tier, title, tagline, palette }) => {
  const safeTier = clampInt(tier, 1, 9);
  const label = `${safeTier}등급`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${escapeXml(
    `${label} ${title}`,
  )}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${escapeXml(palette.bgA)}"/>
      <stop offset="1" stop-color="${escapeXml(palette.bgB)}"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${escapeXml(palette.accentA)}"/>
      <stop offset="1" stop-color="${escapeXml(palette.accentB)}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="rgba(31,36,48,0.18)"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="640" height="360" rx="24" fill="url(#bg)"/>
  <circle cx="560" cy="60" r="88" fill="url(#acc)" opacity="0.25"/>
  <circle cx="78" cy="308" r="110" fill="url(#acc)" opacity="0.18"/>
  <g filter="url(#shadow)">
    <rect x="28" y="28" width="584" height="304" rx="22" fill="rgba(255,255,255,0.88)" stroke="rgba(223,227,236,0.85)" stroke-width="2"/>
  </g>
  <g font-family="'Noto Sans KR', system-ui, -apple-system, sans-serif" fill="#1f2430">
    <text x="52" y="72" font-size="16" font-weight="700" fill="rgba(111,114,133,0.95)">Tax Unified · Gamification</text>
    <text x="52" y="138" font-size="56" font-weight="900">${escapeXml(label)}</text>
    <text x="52" y="186" font-size="34" font-weight="900" fill="url(#acc)">${escapeXml(title)}</text>
    <text x="52" y="234" font-size="18" font-weight="700" fill="rgba(111,114,133,0.95)">${escapeXml(tagline)}</text>
  </g>
</svg>`;
  return svgToDataUrl(svg);
};

const buildTips = ({ calculatorId, tier, amountWon }) => {
  const tips = [];

  if (calculatorId === 'yearend') {
    tips.push('원천징수세액(소득세+지방세) 입력이 정확한지 먼저 확인하세요.');
    tips.push('연금저축/IRP, 보험·의료·교육·기부·월세 등 “세액공제” 항목 누락이 잦습니다.');
    if (amountWon < 0) tips.push('추납이면, 카드 공제/부양가족 요건·연말정산 간소화 누락 여부를 점검해 보세요.');
    else tips.push('환급이면, 회사 정산 일정/환급 계좌 안내를 확인해 두면 좋아요.');
  } else if (calculatorId === 'corporate') {
    tips.push('세무조정(가산/차감) 입력값이 과세표준을 크게 바꿉니다. 근거 자료를 함께 정리해두세요.');
    tips.push('결손금 공제·기납부세액이 누락되면 납부세액이 과대 계산될 수 있습니다.');
    tips.push('세액공제는 “적용 가능 여부”가 핵심입니다(요건/한도/증빙 확인).');
  } else if (calculatorId === 'financial') {
    tips.push('금융소득 2,000만 원 초과 여부에 따라 “비교과세(종합 vs 분리)” 결과가 달라집니다.');
    tips.push('Gross-up 대상 배당 여부/원천징수 세율/기납부세액 입력이 결과에 직접 반영됩니다.');
    tips.push('건강보험료(피부양자·소득월액) 영향은 별도 기준이 있어, 경고/안내를 참고하세요.');
  } else {
    tips.push('입력값(특히 기납부/원천징수)부터 다시 확인해 보세요.');
  }

  if (tier >= 8) tips.unshift('이번 결과는 “납부 구간”에 가깝습니다. 누락/입력 실수를 먼저 의심해 보세요.');
  if (tier <= 3) tips.unshift('좋은 결과입니다. 공유 이미지로 남겨두면 다음 해 비교가 쉬워요.');

  return tips.slice(0, 4);
};

export function getTaxGamification({ calculatorId, netBenefitWon }) {
  const id = String(calculatorId || '');
  const base = getBase(id);
  const breakpoints = buildBreakpoints(base);
  const tier = pickTier(Number(netBenefitWon), breakpoints);
  const copy = TIER_COPY[tier - 1] || TIER_COPY[4];
  const palette = TIER_PALETTES[tier - 1] || TIER_PALETTES[4];
  const memeImageUrl = buildTierSvg({ tier, title: copy.title, tagline: copy.tagline, palette });
  const tips = buildTips({ calculatorId: id, tier, amountWon: Number(netBenefitWon) || 0 });

  const nextBoundary = breakpoints[tier - 1] ?? null;
  const prevBoundary = tier <= 1 ? null : breakpoints[tier - 2] ?? null;

  return {
    calculatorId: id,
    tier,
    title: copy.title,
    tagline: copy.tagline,
    palette,
    memeImageUrl,
    tips,
    breakpoints,
    nextBoundary,
    prevBoundary,
  };
}
