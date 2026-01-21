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

const loadImage = (src, timeoutMs = 2500) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`image timeout: ${src}`));
    }, timeoutMs);

    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`image load error: ${src}`));
    };
    img.src = src;
  });

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

  const hasPrimary = Boolean(String(primaryValue || '').trim());
  const tierNumber = tier?.tier ? Number(tier.tier) : null;
  const tierTemplateUrl =
    hasPrimary && Number.isFinite(tierNumber) && tierNumber >= 1 && tierNumber <= 9
      ? `/tier-images/${Math.trunc(tierNumber)}.png`
      : '';

  let memeImage = null;
  let memeIsTemplate = false;
  if (hasPrimary) {
    if (tierTemplateUrl) {
      memeImage = await loadImage(tierTemplateUrl).catch(() => null);
      memeIsTemplate = Boolean(memeImage);
    }
    if (!memeImage && tier?.memeImageUrl) {
      memeImage = await loadImage(tier.memeImageUrl).catch(() => null);
      memeIsTemplate = false;
    }
  }

  const bgA = tier?.palette?.bgA || theme.bgA;
  const bgB = tier?.palette?.bgB || theme.bgB;
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, bgA);
  bg.addColorStop(1, bgB);
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
  const innerBottomY = cardY + cardH - 56;
  const badgeY = innerY - 6;

  const hasMeme = Boolean(hasPrimary && memeImage);
  const memeW = hasMeme ? 360 : 0;
  const memeGap = hasMeme ? 34 : 0;
  const memeX = innerX + innerW - memeW;
  const memeY = badgeY;
  const memeH = hasMeme ? innerBottomY - memeY : 0;
  const textW = hasMeme ? memeX - memeGap - innerX : innerW;

  if (hasMeme) {
    const radius = 22;
    ctx.save();
    ctx.shadowColor = 'rgba(31,36,48,0.16)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    drawRoundedRect(ctx, memeX, memeY, memeW, memeH, radius);
    ctx.fill();
    ctx.restore();

    ctx.save();
    drawRoundedRect(ctx, memeX, memeY, memeW, memeH, radius);
    ctx.clip();
    const naturalW = memeImage.naturalWidth || memeImage.width || 1;
    const naturalH = memeImage.naturalHeight || memeImage.height || 1;
    const aspect = naturalW / naturalH;
    const cropWideTemplate = Boolean(memeIsTemplate && aspect >= 1.2);

    const srcX = cropWideTemplate ? Math.floor(naturalW * 0.42) : 0;
    const srcY = 0;
    const srcW = cropWideTemplate ? Math.max(1, naturalW - srcX) : naturalW;
    const srcH = naturalH;

    const scale = Math.max(memeW / srcW, memeH / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const drawX = memeX + (memeW - drawW) / 2;
    const drawY = memeY + (memeH - drawH) / 2;
    ctx.drawImage(memeImage, srcX, srcY, srcW, srcH, drawX, drawY, drawW, drawH);
    ctx.restore();

    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(223,227,236,0.95)';
    drawRoundedRect(ctx, memeX, memeY, memeW, memeH, radius);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  const paletteA = tier?.palette?.accentA || theme.accentA;
  const paletteB = tier?.palette?.accentB || theme.accentB;
  const accent = ctx.createLinearGradient(innerX, badgeY, innerX + Math.max(240, textW), badgeY);
  accent.addColorStop(0, paletteA);
  accent.addColorStop(1, paletteB);

  ctx.textBaseline = 'middle';
  ctx.font = '900 20px "Space Grotesk","Noto Sans KR",system-ui,sans-serif';
  const pillText = 'TAX UNIFIED';
  const pillW = Math.min(textW, Math.max(140, ctx.measureText(pillText).width + 34));
  const pillH = 34;
  drawRoundedRect(ctx, innerX, badgeY, pillW, pillH, 18);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = '#0d1c2b';
  ctx.fillText(pillText, innerX + 16, badgeY + pillH / 2);

  ctx.font = '700 22px "Space Grotesk","Noto Sans KR",system-ui,sans-serif';
  ctx.fillStyle = theme.muted;
  const gamificationText = 'Gamification';
  const gamificationW = ctx.measureText(gamificationText).width;
  ctx.fillText(gamificationText, innerX + pillW + 14, badgeY + pillH / 2);

  const dateText = formatDateKst(new Date());
  ctx.font = '700 18px "Space Grotesk","Noto Sans KR",system-ui,sans-serif';
  ctx.fillStyle = theme.muted;
  const dateWidth = ctx.measureText(dateText).width;
  const minDateX = innerX + pillW + 14 + gamificationW + 18;
  const dateX = innerX + textW - dateWidth;
  if (dateX >= minDateX) ctx.fillText(dateText, dateX, badgeY + pillH / 2);

  let cursorY = badgeY + pillH + 26;
  ctx.textBaseline = 'top';

  if (hasPrimary) {
    const tierNumber = tier?.tier ? String(tier.tier) : '';
    const tierTitle = tier?.title ? String(tier.title) : '';
    const accentLine = ctx.createLinearGradient(innerX, cursorY, innerX + Math.max(240, textW), cursorY);
    accentLine.addColorStop(0, paletteA);
    accentLine.addColorStop(1, paletteB);

    if (tierNumber) {
      let tierSize = 74;
      while (tierSize > 52) {
        ctx.font = `900 ${tierSize}px "Noto Sans KR","Space Grotesk",system-ui,sans-serif`;
        if (ctx.measureText(`${tierNumber}등급`).width <= textW) break;
        tierSize -= 2;
      }
      ctx.fillStyle = accentLine;
      ctx.textBaseline = 'top';
      ctx.fillText(`${tierNumber}등급`, innerX, cursorY);
      cursorY += tierSize + 12;

      if (tierTitle) {
        let titleSize = 38;
        while (titleSize > 28) {
          ctx.font = `900 ${titleSize}px "Noto Sans KR","Space Grotesk",system-ui,sans-serif`;
          if (ctx.measureText(tierTitle).width <= textW) break;
          titleSize -= 1;
        }
        ctx.fillStyle = theme.text;
        ctx.fillText(tierTitle, innerX, cursorY);
        cursorY += titleSize + 14;
      } else {
        cursorY += 8;
      }
    }

    const labelText = String(primaryLabel || '').trim();
    const valueText = String(primaryValue || '').trim();
    const outcomeText = labelText ? `${labelText} ${valueText}` : valueText;
    let valueSize = 74;
    while (valueSize > 48) {
      ctx.font = `900 ${valueSize}px "Noto Sans KR","Space Grotesk",system-ui,sans-serif`;
      if (ctx.measureText(outcomeText).width <= textW) break;
      valueSize -= 2;
    }

    if (labelText) {
      ctx.fillStyle = accentLine;
      ctx.fillText(labelText, innerX, cursorY);
      const labelWidth = ctx.measureText(`${labelText} `).width;
      ctx.fillStyle = theme.text;
      ctx.fillText(valueText, innerX + labelWidth, cursorY);
    } else {
      ctx.fillStyle = theme.text;
      ctx.fillText(valueText, innerX, cursorY);
    }
    cursorY += valueSize + 18;

    const sub = String(subtitle || tier?.tagline || '').trim();
    if (sub) {
      ctx.font = '700 24px "Noto Sans KR","Space Grotesk",system-ui,sans-serif';
      ctx.fillStyle = theme.muted;
      const subLines = wrapText(ctx, sub, textW, 2);
      for (const line of subLines) {
        ctx.fillText(line, innerX, cursorY);
        cursorY += 32;
      }
    }
  } else {
    const titleMaxWidth = textW;
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
      const subLines = wrapText(ctx, subtitle, textW, 2);
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
        const bulletLines = wrapText(ctx, bullet, textW, 2);
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
