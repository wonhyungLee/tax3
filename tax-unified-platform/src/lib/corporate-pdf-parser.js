// Corporate PDF parsers (financial statements + corporate tax return summary)
// - Client-side only via PDF.js (no secrets)

const normalizeForMatch = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[^0-9A-Za-z\u1100-\u11FF\u3130-\u318F]/g, '')
    .toLowerCase();

const normalizeNumberText = (text) => String(text || '').replace(/\u00a0/g, ' ').replace(/\s*,\s*/g, ',');

const extractAmounts = (text) => {
  const normalized = normalizeNumberText(text)
    .replace(/\d{4}[./-]\d{2}[./-]\d{2}/g, ' ')
    .replace(/\d{1,2}:\d{2}/g, ' ');

  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const mergedTokens = [];
  for (let i = 0; i < rawTokens.length; i += 1) {
    let token = rawTokens[i].replace(/[^\d,]/g, '');
    if (!token) continue;
    if (/,\d{1,2}$/.test(token)) {
      const next = rawTokens[i + 1] ? rawTokens[i + 1].replace(/[^\d]/g, '') : '';
      if (/^\d{1,2}$/.test(next)) {
        token = `${token}${next}`;
        i += 1;
      }
    }
    mergedTokens.push(token);
  }

  const matches = mergedTokens.flatMap((token) => token.match(/\d{1,3}(?:,\d{3})+|\d{4,}/g) || []);
  return matches
    .map((token) => parseInt(token.replace(/,/g, ''), 10))
    .filter((value) => Number.isFinite(value) && value >= 0);
};

const findAmountByLabel = (lines, labels, preferKeywords = [], excludeLabels = []) => {
  const normalizedLabels = labels.map(normalizeForMatch).filter(Boolean);
  const normalizedPrefer = preferKeywords.map(normalizeForMatch).filter(Boolean);
  const normalizedExclude = excludeLabels.map(normalizeForMatch).filter(Boolean);

  const matchIndexes = [];
  lines.forEach((line, index) => {
    const normalizedLine = normalizeForMatch(line);
    if (!normalizedLine) return;
    const hasLabel = normalizedLabels.some((label) => normalizedLine.includes(label));
    const hasExclude = normalizedExclude.some((label) => normalizedLine.includes(label));
    if (hasLabel && !hasExclude) matchIndexes.push(index);
  });
  if (!matchIndexes.length) return null;

  const pickAmount = (indexes) => {
    const contexts = indexes.map((idx) => [lines[idx - 1], lines[idx], lines[idx + 1]].filter(Boolean).join(' '));
    const amounts = contexts.flatMap(extractAmounts);
    return amounts.length ? Math.max(...amounts) : null;
  };

  const preferred = normalizedPrefer.length
    ? matchIndexes.filter((idx) => {
        const normalizedLine = normalizeForMatch(lines[idx]);
        return normalizedPrefer.some((keyword) => normalizedLine.includes(keyword));
      })
    : [];

  return pickAmount(preferred.length ? preferred : matchIndexes);
};

const extractItemsFromPage = async (page, pageIndex) => {
  const content = await page.getTextContent();
  return content.items
    .map((item) => ({
      text: item.str ? item.str.trim() : '',
      x: item.transform[4],
      y: item.transform[5],
      page: pageIndex,
    }))
    .filter((item) => item.text);
};

const computeRowThreshold = (pageItems) => {
  if (pageItems.length < 2) return 4;
  const ys = Array.from(new Set(pageItems.map((item) => Math.round(item.y * 2) / 2))).sort((a, b) => b - a);
  const diffs = [];
  for (let i = 1; i < ys.length; i += 1) {
    const diff = Math.abs(ys[i - 1] - ys[i]);
    if (diff > 0.5) diffs.push(diff);
  }
  if (!diffs.length) return 4;
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  const threshold = median * 0.45;
  return Math.max(2, Math.min(10, threshold));
};

const buildLinesFromItems = (items) => {
  const groupedByPage = new Map();
  items.forEach((item) => {
    if (!groupedByPage.has(item.page)) groupedByPage.set(item.page, []);
    groupedByPage.get(item.page).push(item);
  });

  const lines = [];
  groupedByPage.forEach((pageItems) => {
    const threshold = computeRowThreshold(pageItems);
    pageItems.sort((a, b) => b.y - a.y || a.x - b.x);
    let current = [];
    let lastY = null;

    pageItems.forEach((item) => {
      if (lastY === null || Math.abs(item.y - lastY) <= threshold) {
        current.push(item);
      } else {
        lines.push(
          current
            .slice()
            .sort((a, b) => a.x - b.x)
            .map((entry) => entry.text)
            .join(' '),
        );
        current = [item];
      }
      lastY = item.y;
    });

    if (current.length) {
      lines.push(
        current
          .slice()
          .sort((a, b) => a.x - b.x)
          .map((entry) => entry.text)
          .join(' '),
      );
    }
  });

  return lines;
};

const loadPdfLines = async (file, pdfjsLib, options = {}) => {
  if (!pdfjsLib?.getDocument) throw new Error('PDF.js가 로드되지 않았습니다.');
  const disableWorker = Boolean(options.disableWorker);
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data, disableWorker }).promise;

  let items = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const pageItems = await extractItemsFromPage(page, pageNum);
    items = items.concat(pageItems);
  }
  const lines = buildLinesFromItems(items);
  return { items, lines, numPages: pdf.numPages };
};

export const parseCorporateFinancialStatementPdf = async (file, pdfjsLib, options = {}) => {
  const { items, lines } = await loadPdfLines(file, pdfjsLib, options);
  const hasText = Array.isArray(items) && items.length > 0;

  const sales = findAmountByLabel(lines, ['매출액']);
  const profitBeforeTax = findAmountByLabel(lines, ['법인세차감전이익']);
  const netIncome = findAmountByLabel(lines, ['당기순이익']);
  const corporateTaxExpense = findAmountByLabel(lines, ['법인세등']);

  return {
    hasText,
    sales,
    profitBeforeTax,
    netIncome,
    corporateTaxExpense,
  };
};

export const parseCorporateTaxReturnPdf = async (file, pdfjsLib, options = {}) => {
  const { items, lines } = await loadPdfLines(file, pdfjsLib, options);
  const hasText = Array.isArray(items) && items.length > 0;

  const revenue = findAmountByLabel(lines, ['수입금액']);
  const taxBase = findAmountByLabel(lines, ['과세표준']);
  const calculatedTax = findAmountByLabel(lines, ['산출세액']);
  const totalBurdenTax = findAmountByLabel(lines, ['총부담세액']);
  const prepaidTax = findAmountByLabel(lines, ['기납부세액']);
  const payableTax = findAmountByLabel(lines, ['차감납부할세액', '차감납부세액']);

  const creditTotal =
    typeof calculatedTax === 'number' && typeof totalBurdenTax === 'number'
      ? Math.max(0, calculatedTax - totalBurdenTax)
      : null;

  return {
    hasText,
    revenue,
    taxBase,
    calculatedTax,
    totalBurdenTax,
    creditTotal,
    prepaidTax,
    payableTax,
  };
};
