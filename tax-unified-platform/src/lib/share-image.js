const WIDTH = 1200;
const HEIGHT = 630;

const DEFAULT_THEME = {
  bgA: '#f7f9ff',
  bgB: '#fff1f7',
  accentA: '#6fb4ff',
  accentB: '#f6a5c0',
  text: '#1f2430',
  muted: '#6f7285',
  card: '#ffffff',
  border: '#dfe3ec',
};

const waitForFonts = async (timeoutMs = 1200) => {
  try {
    if (!document?.fonts?.ready) return;
    await Promise.race([
      document.fonts.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('font timeout')), timeoutMs)),
    ]);
  } catch {
  }
};

const drawRoundedRect = (ctx, x, y, w, h, r) => {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

const wrapText = (ctx, text, maxWidth, maxLines) => {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let current = words[0];

  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    current = words[i];
    if (lines.length >= maxLines - 1) break;
  }

  lines.push(current);
  return lines.slice(0, maxLines);
};

const formatDateKst = (date = new Date()) => {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
};

export async function createShareImageDataUrl({
  title,
  subtitle = '',
  lines = [],
  theme = DEFAULT_THEME,
  badge = 'Tax Unified',
  tier = null,
  primaryLabel = '',
  primaryValue = '',
  footerTitle = '',
  footerText = '',
  footnote = '추정 결과 · 실제 신고/정산은 다를 수 있음',
}) {
  if (typeof document === 'undefined') {
    throw new Error('share image is only available in browser');
  }

  await waitForFonts();

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context not available');

  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, theme.bgA);
  bg.addColorStop(1, theme.bgB);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const cardX = 70;
  const cardY = 64;
  const cardW = WIDTH - cardX * 2;
  const cardH = HEIGHT - cardY * 2;

  ctx.save();
  ctx.shadowColor = 'rgba(31,36,48,0.18)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = theme.card;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.stroke();

  const innerX = cardX + 58;
  const innerY = cardY + 56;
  const innerW = cardW - 116;

  ctx.save();
  ctx.font = '700 22px "Space Grotesk","Noto Sans KR",system-ui,sans-serif';
  const badgeW = Math.max(120, ctx.measureText(badge).width + 26);
  const badgeH = 36;
  const badgeX = innerX;
  const badgeY = innerY - 6;
  const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY + badgeH);
  badgeGrad.addColorStop(0, theme.accentA);
  badgeGrad.addColorStop(1, theme.accentB);
  ctx.fillStyle = badgeGrad;
  drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 18);
  ctx.fill();
  ctx.fillStyle = '#0d1c2b';
  ctx.textBaseline = 'middle';
  ctx.fillText(badge, badgeX + 14, badgeY + badgeH / 2);

  const dateText = formatDateKst(new Date());
  ctx.font = '700 18px "Space Grotesk","Noto Sans KR",system-ui,sans-serif';
  ctx.fillStyle = theme.muted;
  const dateWidth = ctx.measureText(dateText).width;
  ctx.fillText(dateText, innerX + innerW - dateWidth, badgeY + badgeH / 2);

  if (tier?.tier && tier?.title) {
    const tierText = `${tier.tier}등급 · ${tier.title}`;
    ctx.font = '900 18px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
    const tierW = Math.min(innerW, Math.max(160, ctx.measureText(tierText).width + 26));
    const tierH = 34;
    const tierX = innerX + innerW - tierW;
    const tierY = badgeY + badgeH + 12;
    const a = tier?.palette?.accentA || theme.accentA;
    const b = tier?.palette?.accentB || theme.accentB;
    const tierGrad = ctx.createLinearGradient(tierX, tierY, tierX + tierW, tierY + tierH);
    tierGrad.addColorStop(0, a);
    tierGrad.addColorStop(1, b);
    ctx.fillStyle = tierGrad;
    drawRoundedRect(ctx, tierX, tierY, tierW, tierH, 18);
    ctx.fill();
    ctx.fillStyle = '#0d1c2b';
    ctx.textBaseline = 'middle';
    ctx.fillText(tierText, tierX + 14, tierY + tierH / 2);
  }

  const hasPrimary = Boolean(String(primaryValue || '').trim());
  let cursorY = badgeY + badgeH + 28;

  if (hasPrimary) {
    const tierNumber = tier?.tier ? String(tier.tier) : '';
    const tierTitle = tier?.title ? String(tier.title) : '';
    const paletteA = tier?.palette?.accentA || theme.accentA;
    const paletteB = tier?.palette?.accentB || theme.accentB;
    const accent = ctx.createLinearGradient(innerX, cursorY, innerX + innerW, cursorY);
    accent.addColorStop(0, paletteA);
    accent.addColorStop(1, paletteB);

    if (tierNumber) {
      ctx.font = '900 74px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
      ctx.fillStyle = accent;
      ctx.textBaseline = 'top';
      ctx.fillText(`${tierNumber}등급`, innerX, cursorY);
      cursorY += 86;

      if (tierTitle) {
        ctx.font = '900 34px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
        ctx.fillStyle = theme.text;
        ctx.fillText(tierTitle, innerX, cursorY);
        cursorY += 46;
      } else {
        cursorY += 8;
      }
    }

    const labelText = String(primaryLabel || '').trim();
    if (labelText) {
      ctx.font = '900 22px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
      const labelW = Math.max(120, ctx.measureText(labelText).width + 28);
      const labelH = 40;
      const labelX = innerX;
      const labelY = cursorY;
      ctx.fillStyle = accent;
      drawRoundedRect(ctx, labelX, labelY, labelW, labelH, 18);
      ctx.fill();
      ctx.fillStyle = '#0d1c2b';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, labelX + 14, labelY + labelH / 2);
      cursorY += labelH + 18;
    }

    const valueText = String(primaryValue || '').trim();
    ctx.font = '900 92px "Space Grotesk","Noto Sans KR",system-ui,sans-serif';
    ctx.fillStyle = theme.text;
    ctx.textBaseline = 'top';
    ctx.fillText(valueText, innerX, cursorY);
    cursorY += 104;

    const sub = String(subtitle || tier?.tagline || '').trim();
    if (sub) {
      ctx.font = '700 24px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
      ctx.fillStyle = theme.muted;
      const subLines = wrapText(ctx, sub, innerW, 2);
      for (const line of subLines) {
        ctx.fillText(line, innerX, cursorY);
        cursorY += 32;
      }
    }
  } else {
    const titleMaxWidth = innerW;
    const titleFontSize = title.length > 28 ? 52 : 64;
    ctx.font = `900 ${titleFontSize}px "Noto Sans KR","Space Grotesk",system-ui,sans-serif`;
    ctx.fillStyle = theme.text;
    ctx.textBaseline = 'top';
    const titleLines = wrapText(ctx, title, titleMaxWidth, 2);
    for (const line of titleLines) {
      ctx.fillText(line, innerX, cursorY);
      cursorY += titleFontSize + 12;
    }

    if (subtitle) {
      ctx.font = '700 26px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
      ctx.fillStyle = theme.muted;
      const subLines = wrapText(ctx, subtitle, innerW, 2);
      for (const line of subLines) {
        ctx.fillText(line, innerX, cursorY);
        cursorY += 34;
      }
      cursorY += 6;
    } else {
      cursorY += 10;
    }

    const list = Array.isArray(lines) ? lines.filter(Boolean).slice(0, 5) : [];
    if (list.length) {
      ctx.font = '700 22px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
      ctx.fillStyle = theme.text;
      for (const item of list) {
        const bullet = `• ${item}`;
        const bulletLines = wrapText(ctx, bullet, innerW, 2);
        for (const line of bulletLines) {
          ctx.fillText(line, innerX, cursorY);
          cursorY += 30;
        }
        cursorY += 4;
      }
    }
  }

  const footerY = cardY + cardH - 58;
  const footerTitleText = String(footerTitle || '').trim();
  const footerBodyText = String(footerText || '').trim();
  ctx.textBaseline = 'alphabetic';

  if (footerTitleText || footerBodyText) {
    if (footerTitleText) {
      ctx.font = '900 20px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
      ctx.fillStyle = theme.text;
      ctx.fillText(footerTitleText, innerX, footerY - 22);
    }
    if (footerBodyText) {
      ctx.font = '600 18px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
      ctx.fillStyle = theme.muted;
      ctx.fillText(footerBodyText, innerX, footerY);
    }
  } else {
    ctx.font = '600 18px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
    ctx.fillStyle = theme.muted;
    ctx.fillText(footnote, innerX, footerY);
  }
  ctx.restore();

  return canvas.toDataURL('image/png');
}
