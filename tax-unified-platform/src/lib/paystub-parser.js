// Paystub PDF parser (ported from tax-unified-platform/yearend/script.js)
// - Extracts annual salary / nontaxable / gross salary / withheld taxes / social insurance

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
    .filter((value) => Number.isFinite(value) && value >= 1000);
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
    if (hasLabel && !hasExclude) {
      matchIndexes.push(index);
    }
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
  return Math.max(2, Math.min(8, threshold));
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

const buildRowGroupsFromItems = (items, thresholdOverride = null) => {
  const groupedByPage = new Map();
  items.forEach((item) => {
    if (!groupedByPage.has(item.page)) groupedByPage.set(item.page, []);
    groupedByPage.get(item.page).push(item);
  });

  const rows = [];
  groupedByPage.forEach((pageItems) => {
    const threshold = Number.isFinite(thresholdOverride) ? thresholdOverride : computeRowThreshold(pageItems);
    pageItems.sort((a, b) => b.y - a.y || a.x - b.x);
    let current = [];
    let lastY = null;

    pageItems.forEach((item) => {
      if (lastY === null || Math.abs(item.y - lastY) <= threshold) {
        current.push(item);
      } else {
        rows.push(current.slice().sort((a, b) => a.x - b.x));
        current = [item];
      }
      lastY = item.y;
    });

    if (current.length) rows.push(current.slice().sort((a, b) => a.x - b.x));
  });

  return rows;
};

const getRowText = (rowItems) => rowItems.map((item) => item.text).join(' ');
const getRowNumbers = (rowItems) => rowItems.flatMap((item) => extractAmounts(item.text));
const getRowNumericCount = (rowItems) => getRowNumbers(rowItems).length;

const countMonthTokens = (rowItems) => {
  const text = getRowText(rowItems);
  const matches = text.match(/\d{1,2}\s*월/g) || [];
  const unique = new Set(matches.map((token) => token.replace(/\s+/g, '')));
  return unique.size;
};

const findTotalsRow = (rowGroups) => {
  let best = null;
  rowGroups.forEach((rowItems) => {
    const text = getRowText(rowItems).trim();
    if (!text.startsWith('계')) return;
    const count = getRowNumericCount(rowItems);
    if (!count) return;
    if (!best || count > best.count) best = { rowItems, count };
  });
  return best ? best.rowItems : null;
};

const findTotalsRowByNumbers = (rowGroups) => {
  let best = null;
  rowGroups.forEach((rowItems) => {
    const count = getRowNumericCount(rowItems);
    if (count < 10) return;
    if (countMonthTokens(rowItems) > 0) return;
    const text = getRowText(rowItems);
    if (text.includes('항목명') || text.includes('월급여')) return;
    if (!best || count > best.count) best = { rowItems, count };
  });
  return best ? best.rowItems : null;
};

const findRowWithMaxValue = (rowGroups) => {
  let best = null;
  rowGroups.forEach((rowItems) => {
    const numbers = getRowNumbers(rowItems);
    if (!numbers.length) return;
    const maxValue = Math.max(...numbers);
    if (!best || maxValue > best.maxValue) best = { rowItems, maxValue };
  });
  return best ? best.rowItems : null;
};

const findLabelItem = (items, labelVariants) => {
  const normalizedVariants = labelVariants.map(normalizeForMatch);
  const matches = items.filter((item) => {
    const norm = normalizeForMatch(item.text);
    return normalizedVariants.some((label) => norm.includes(label));
  });
  if (!matches.length) return null;
  matches.sort((a, b) => a.x - b.x);
  return matches[0];
};

const getNumberNearX = (rowItems, targetX, tolerance = 18) => {
  const numericItems = rowItems
    .map((item) => {
      const amounts = extractAmounts(item.text);
      if (!amounts.length) return null;
      return { x: item.x, value: amounts[amounts.length - 1] };
    })
    .filter(Boolean);

  if (!numericItems.length) return null;
  if (Number.isFinite(targetX)) {
    const within = numericItems
      .map((item) => ({ ...item, dist: Math.abs(item.x - targetX) }))
      .filter((item) => item.dist <= tolerance);
    if (within.length) {
      within.sort((a, b) => a.dist - b.dist);
      return within[0].value;
    }
  }
  numericItems.sort((a, b) => b.x - a.x);
  return numericItems[0].value;
};

const getNumbersNearX = (items, targetX, tolerance = 12) => {
  if (!Number.isFinite(targetX)) return [];
  return items.flatMap((item) => {
    if (Math.abs(item.x - targetX) > tolerance) return [];
    return extractAmounts(item.text);
  });
};

const getColumnMaxValue = (items, labelItem, tolerance = 12) => {
  if (!labelItem) return null;
  const values = getNumbersNearX(items, labelItem.x, tolerance);
  return values.length ? Math.max(...values) : null;
};

const mapLabelToTotal = (labelItem, totalsRow, totalXFallback = null) => {
  if (!labelItem || !totalsRow) return null;
  const value = getNumberNearX(totalsRow, labelItem.x, 24);
  if (value !== null) return value;
  return getNumberNearX(totalsRow, totalXFallback, 24);
};

const getRowNumericValuesSorted = (rowItems) =>
  rowItems
    .flatMap((item) => extractAmounts(item.text).map((value) => ({ x: item.x, value })))
    .sort((a, b) => a.x - b.x)
    .map((item) => item.value);

const findRightmostNumericColumnX = (items) => {
  const numericItems = items
    .map((item) => ({ x: item.x, values: extractAmounts(item.text) }))
    .filter((item) => item.values.length);
  if (!numericItems.length) return null;

  const tolerance = 10;
  const sorted = numericItems.slice().sort((a, b) => a.x - b.x);
  const clusters = [];

  sorted.forEach((item) => {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(item.x - last.center) > tolerance) {
      clusters.push({ center: item.x, count: 1 });
    } else {
      last.center = (last.center * last.count + item.x) / (last.count + 1);
      last.count += 1;
    }
  });

  clusters.sort((a, b) => b.center - a.center);
  const top = clusters.find((cluster) => cluster.count >= 5) || clusters[0];
  return top ? top.center : null;
};

const findTotalColumnX = (rowGroups) => {
  let best = null;
  rowGroups.forEach((rowItems) => {
    const monthCount = countMonthTokens(rowItems);
    if (monthCount < 6) return;
    const totalItem = rowItems.find((item) => item.text.includes('계')) || rowItems.find((item) => item.text.includes('합계'));
    const rightmostX = rowItems.reduce((max, item) => Math.max(max, item.x), -Infinity);
    const candidateX = totalItem ? totalItem.x : rightmostX;
    if (!best || monthCount > best.monthCount) best = { x: candidateX, monthCount };
  });
  return best ? best.x : null;
};

const buildRowData = (rowGroups) =>
  rowGroups.map((rowItems) => {
    const text = getRowText(rowItems);
    return { items: rowItems, text, normalized: normalizeForMatch(text) };
  });

const findAmountByLabelItems = (items, labels, preferKeywords = [], excludeLabels = [], options = {}) => {
  const normalizedLabels = labels.map(normalizeForMatch).filter(Boolean);
  const normalizedPrefer = preferKeywords.map(normalizeForMatch).filter(Boolean);
  const normalizedExclude = excludeLabels.map(normalizeForMatch).filter(Boolean);
  const tolerance = options.tolerance ?? 6;

  const labelItems = items.filter((item) => {
    const normalizedLine = normalizeForMatch(item.text);
    return normalizedLabels.some((label) => normalizedLine.includes(label));
  });
  if (!labelItems.length) return null;

  const rowCandidates = [];
  labelItems.forEach((labelItem) => {
    const rowItems = items.filter((item) => item.page === labelItem.page && Math.abs(item.y - labelItem.y) <= tolerance);
    const rowText = rowItems
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(' ');
    const rowNormalized = normalizeForMatch(rowText);
    if (normalizedExclude.some((label) => rowNormalized.includes(label))) return;
    const amounts = extractAmounts(rowText);
    if (!amounts.length) return;
    rowCandidates.push({ max: Math.max(...amounts), rowNormalized });
  });

  if (!rowCandidates.length) return null;

  const preferred = normalizedPrefer.length
    ? rowCandidates.filter((row) => normalizedPrefer.some((label) => row.rowNormalized.includes(label)))
    : [];
  const chosen = preferred.length ? preferred : rowCandidates;
  return Math.max(...chosen.map((row) => row.max));
};

const findAmountByLabelRows = (rows, labels, preferKeywords = [], excludeLabels = [], totalX = null) => {
  const normalizedLabels = labels.map(normalizeForMatch).filter(Boolean);
  const normalizedPrefer = preferKeywords.map(normalizeForMatch).filter(Boolean);
  const normalizedExclude = excludeLabels.map(normalizeForMatch).filter(Boolean);

  const matches = rows.filter((row) => {
    if (!row.normalized) return false;
    const hasLabel = normalizedLabels.some((label) => row.normalized.includes(label));
    const hasExclude = normalizedExclude.some((label) => row.normalized.includes(label));
    return hasLabel && !hasExclude;
  });

  if (!matches.length) return null;
  const preferred = normalizedPrefer.length
    ? matches.filter((row) => normalizedPrefer.some((label) => row.normalized.includes(label)))
    : [];
  const candidates = preferred.length ? preferred : matches;
  const values = candidates.map((row) => getNumberNearX(row.items, totalX)).filter((value) => value !== null);
  if (!values.length) return null;
  return Math.max(...values);
};

const parsePaystubLines = (lines) => {
  const hasText = lines.some((line) => line.trim().length > 0);
  let annualSalary =
    findAmountByLabel(lines, ['수당합계'], ['합계']) ||
    findAmountByLabel(lines, ['지급합계', '총지급액', '지급총액', '급여합계'], ['합계']);
  const nontaxableSalary = findAmountByLabel(lines, ['비과세합계', '비과세 합계'], ['합계']);
  const paymentTotal = findAmountByLabel(lines, ['지급액', '실지급액', '지급액합계'], ['계', '합계']);
  const deductionTotal = findAmountByLabel(lines, ['공제합계', '공제액'], ['계', '합계']);
  if (annualSalary === null && paymentTotal !== null && deductionTotal !== null) {
    annualSalary = paymentTotal + deductionTotal;
  }
  const withheldIncomeTax = findAmountByLabel(lines, ['소득세'], ['합계', '누계']);
  const withheldLocalTax = findAmountByLabel(lines, ['지방소득세', '지방세'], ['합계', '누계']);

  const pension = findAmountByLabel(lines, ['일반기여금', '국민연금', '공무원연금'], ['합계', '누계']);
  const healthInsurance = findAmountByLabel(lines, ['건강보험'], ['합계', '누계'], ['연말정산']);
  const healthAdjust = findAmountByLabel(
    lines,
    ['건강보험연말정산', '건강보험 연말정산', '건강보험연말정', '건강보험 연말정'],
    ['합계', '누계'],
  );
  const longTermCare = findAmountByLabel(
    lines,
    ['노인장기요양보험', '노인장기요양보', '장기요양보험', '장기요양보', '장기요양'],
    ['합계', '누계'],
    ['연말정산'],
  );
  const longTermAdjust = findAmountByLabel(
    lines,
    ['장기요양연말정산', '장기요양 연말정산', '장기요양연말정', '장기요양 연말정'],
    ['합계', '누계'],
  );
  const employment = findAmountByLabel(lines, ['고용보험'], ['합계', '누계']);

  const socialInsurance =
    (pension || 0) + (healthInsurance || 0) + (healthAdjust || 0) + (longTermCare || 0) + (longTermAdjust || 0) + (employment || 0);

  const grossSalary = annualSalary !== null && nontaxableSalary !== null ? Math.max(0, annualSalary - nontaxableSalary) : null;

  return {
    hasText,
    annualSalary,
    nontaxableSalary,
    grossSalary,
    withheldIncomeTax,
    withheldLocalTax,
    socialInsurance: socialInsurance > 0 ? socialInsurance : null,
  };
};

const parsePaystubRows = (rows, totalX = null) => {
  const hasText = rows.length > 0;
  let annualSalary =
    findAmountByLabelRows(rows, ['수당합계'], ['합계'], [], totalX) ||
    findAmountByLabelRows(rows, ['지급합계', '총지급액', '지급총액', '급여합계'], ['합계'], [], totalX);
  const nontaxableSalary = findAmountByLabelRows(rows, ['비과세합계', '비과세 합계'], ['합계'], [], totalX);
  const paymentTotal = findAmountByLabelRows(rows, ['지급액', '실지급액', '지급액합계'], ['계', '합계'], [], totalX);
  const deductionTotal = findAmountByLabelRows(rows, ['공제합계', '공제액'], ['계', '합계'], [], totalX);
  if (annualSalary === null && paymentTotal !== null && deductionTotal !== null) {
    annualSalary = paymentTotal + deductionTotal;
  }
  const withheldIncomeTax = findAmountByLabelRows(rows, ['소득세'], ['합계', '누계'], [], totalX);
  const withheldLocalTax = findAmountByLabelRows(rows, ['지방소득세', '지방세'], ['합계', '누계'], [], totalX);

  const pension = findAmountByLabelRows(rows, ['일반기여금', '국민연금', '공무원연금'], ['합계', '누계'], [], totalX);
  const healthInsurance = findAmountByLabelRows(rows, ['건강보험'], ['합계', '누계'], ['연말정산'], totalX);
  const healthAdjust = findAmountByLabelRows(
    rows,
    ['건강보험연말정산', '건강보험 연말정산', '건강보험연말정', '건강보험 연말정'],
    ['합계', '누계'],
    [],
    totalX,
  );
  const longTermCare = findAmountByLabelRows(
    rows,
    ['노인장기요양보험', '노인장기요양보', '장기요양보험', '장기요양보', '장기요양'],
    ['합계', '누계'],
    ['연말정산'],
    totalX,
  );
  const longTermAdjust = findAmountByLabelRows(
    rows,
    ['장기요양연말정산', '장기요양 연말정산', '장기요양연말정', '장기요양 연말정'],
    ['합계', '누계'],
    [],
    totalX,
  );
  const employment = findAmountByLabelRows(rows, ['고용보험'], ['합계', '누계'], [], totalX);

  const socialInsurance =
    (pension || 0) + (healthInsurance || 0) + (healthAdjust || 0) + (longTermCare || 0) + (longTermAdjust || 0) + (employment || 0);

  const grossSalary = annualSalary !== null && nontaxableSalary !== null ? Math.max(0, annualSalary - nontaxableSalary) : null;

  return {
    hasText,
    annualSalary,
    nontaxableSalary,
    grossSalary,
    withheldIncomeTax,
    withheldLocalTax,
    socialInsurance: socialInsurance > 0 ? socialInsurance : null,
  };
};

const parsePaystubItems = (items) => {
  const hasText = items.length > 0;
  let annualSalary =
    findAmountByLabelItems(items, ['수당합계'], ['합계']) ||
    findAmountByLabelItems(items, ['지급합계', '총지급액', '지급총액', '급여합계'], ['합계']);
  const nontaxableSalary = findAmountByLabelItems(items, ['비과세합계', '비과세 합계'], ['합계']);
  const paymentTotal = findAmountByLabelItems(items, ['지급액', '실지급액', '지급액합계'], ['계', '합계']);
  const deductionTotal = findAmountByLabelItems(items, ['공제합계', '공제액'], ['계', '합계']);
  if (annualSalary === null && paymentTotal !== null && deductionTotal !== null) {
    annualSalary = paymentTotal + deductionTotal;
  }
  const withheldIncomeTax = findAmountByLabelItems(items, ['소득세'], ['합계', '누계']);
  const withheldLocalTax = findAmountByLabelItems(items, ['지방소득세', '지방세'], ['합계', '누계']);

  const pension = findAmountByLabelItems(items, ['일반기여금', '국민연금', '공무원연금'], ['합계', '누계']);
  const healthInsurance = findAmountByLabelItems(items, ['건강보험'], ['합계', '누계'], ['연말정산']);
  const healthAdjust = findAmountByLabelItems(
    items,
    ['건강보험연말정산', '건강보험 연말정산', '건강보험연말정', '건강보험 연말정'],
    ['합계', '누계'],
  );
  const longTermCare = findAmountByLabelItems(
    items,
    ['노인장기요양보험', '노인장기요양보', '장기요양보험', '장기요양보', '장기요양'],
    ['합계', '누계'],
    ['연말정산'],
  );
  const longTermAdjust = findAmountByLabelItems(
    items,
    ['장기요양연말정산', '장기요양 연말정산', '장기요양연말정', '장기요양 연말정'],
    ['합계', '누계'],
  );
  const employment = findAmountByLabelItems(items, ['고용보험'], ['합계', '누계']);

  const socialInsurance =
    (pension || 0) + (healthInsurance || 0) + (healthAdjust || 0) + (longTermCare || 0) + (longTermAdjust || 0) + (employment || 0);

  const grossSalary = annualSalary !== null && nontaxableSalary !== null ? Math.max(0, annualSalary - nontaxableSalary) : null;

  return {
    hasText,
    annualSalary,
    nontaxableSalary,
    grossSalary,
    withheldIncomeTax,
    withheldLocalTax,
    socialInsurance: socialInsurance > 0 ? socialInsurance : null,
  };
};

const parsePaystubByColumnMap = (itemsByPage) => {
  const getItems = (page) => itemsByPage.get(page) || [];
  const pages = Array.from(itemsByPage.keys());
  const hasText = pages.some((page) => getItems(page).length > 0);
  const thresholds = [null, 8, 12];

  let annualSalary = null;
  let nontaxableSalary = null;
  let withheldIncomeTax = null;
  let withheldLocalTax = null;
  let pension = null;
  let healthInsurance = null;
  let healthAdjust = null;
  let longTermCare = null;
  let longTermAdjust = null;
  let employment = null;

  let taxTotalsRow = null;
  let taxTotalsItems = null;
  let taxTotalsCount = 0;

  pages.forEach((page) => {
    const pageItems = getItems(page);
    thresholds.forEach((threshold) => {
      const rowGroups = buildRowGroupsFromItems(pageItems, threshold);
      const totalsRow = findTotalsRow(rowGroups) || findTotalsRowByNumbers(rowGroups);
      if (!totalsRow) return;
      const count = getRowNumericCount(totalsRow);
      if (count > taxTotalsCount) {
        taxTotalsCount = count;
        taxTotalsRow = totalsRow;
        taxTotalsItems = pageItems;
      }
    });
  });

  if (taxTotalsRow && taxTotalsItems) {
    const totalX = taxTotalsRow[taxTotalsRow.length - 1].x;
    withheldIncomeTax = mapLabelToTotal(findLabelItem(taxTotalsItems, ['소득세']), taxTotalsRow, totalX);
    withheldLocalTax = mapLabelToTotal(findLabelItem(taxTotalsItems, ['지방소득세', '지방세']), taxTotalsRow, totalX);
    pension = mapLabelToTotal(findLabelItem(taxTotalsItems, ['일반기여금', '국민연금', '공무원연금']), taxTotalsRow, totalX);
    healthInsurance = mapLabelToTotal(findLabelItem(taxTotalsItems, ['건강보험']), taxTotalsRow, totalX);
    healthAdjust = mapLabelToTotal(findLabelItem(taxTotalsItems, ['건강보험연말정산', '건강보험연말정']), taxTotalsRow, totalX);
    longTermCare = mapLabelToTotal(findLabelItem(taxTotalsItems, ['노인장기요양보험', '노인장기요양보', '장기요양보험']), taxTotalsRow, totalX);
    longTermAdjust = mapLabelToTotal(findLabelItem(taxTotalsItems, ['장기요양연말정산', '장기요양연말정']), taxTotalsRow, totalX);
    employment = mapLabelToTotal(findLabelItem(taxTotalsItems, ['고용보험']), taxTotalsRow, totalX);

    const totals = getRowNumericValuesSorted(taxTotalsRow);
    if (totals.length >= 12) {
      if (withheldIncomeTax === null) withheldIncomeTax = totals[totals.length - 6];
      if (withheldLocalTax === null) withheldLocalTax = totals[totals.length - 5];
    }
    if (totals.length >= 16) {
      if (pension === null) pension = totals[12];
      if (healthInsurance === null) healthInsurance = totals[13];
      if (healthAdjust === null) healthAdjust = totals[14];
      if (longTermCare === null) longTermCare = totals[15];
    }
  }

  let salaryRow = null;
  let salaryRowItems = null;
  let salaryMaxValue = 0;

  pages.forEach((page) => {
    const pageItems = getItems(page);
    thresholds.forEach((threshold) => {
      const rowGroups = buildRowGroupsFromItems(pageItems, threshold);
      const candidate = findRowWithMaxValue(rowGroups);
      if (!candidate) return;
      const values = getRowNumbers(candidate);
      if (!values.length) return;
      const maxValue = Math.max(...values);
      if (maxValue > salaryMaxValue) {
        salaryMaxValue = maxValue;
        salaryRow = candidate;
        salaryRowItems = pageItems;
      }
    });
  });

  if (salaryRow && salaryRowItems) {
    const totalX = salaryRow[salaryRow.length - 1].x;
    const annualLabel = findLabelItem(salaryRowItems, ['수당합계']);
    const nontaxableLabel = findLabelItem(salaryRowItems, ['비과세합계', '비과세합']);
    const annualFromColumn = getColumnMaxValue(salaryRowItems, annualLabel);
    const nontaxableFromColumn = getColumnMaxValue(salaryRowItems, nontaxableLabel);

    annualSalary = annualFromColumn ?? mapLabelToTotal(annualLabel, salaryRow, totalX);
    nontaxableSalary = nontaxableFromColumn ?? mapLabelToTotal(nontaxableLabel, salaryRow, totalX);

    const totals = getRowNumericValuesSorted(salaryRow);
    if (totals.length >= 3) {
      if (annualSalary === null) annualSalary = totals[totals.length - 4] || totals[1];
      if (nontaxableSalary === null) nontaxableSalary = totals[totals.length - 3] || totals[2];
    }
  }

  const grossSalary = annualSalary !== null && nontaxableSalary !== null ? Math.max(0, annualSalary - nontaxableSalary) : null;
  const socialInsurance = (pension || 0) + (healthInsurance || 0) + (healthAdjust || 0) + (longTermCare || 0) + (longTermAdjust || 0) + (employment || 0);

  return {
    hasText,
    annualSalary,
    nontaxableSalary,
    grossSalary,
    withheldIncomeTax,
    withheldLocalTax,
    socialInsurance: socialInsurance > 0 ? socialInsurance : null,
  };
};

export const parsePaystubPdf = async (file, pdfjsLib, options = {}) => {
  if (!pdfjsLib?.getDocument) {
    throw new Error('PDF.js가 로드되지 않았습니다.');
  }
  const disableWorker = Boolean(options.disableWorker);
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data, disableWorker }).promise;
  let items = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const pageItems = await extractItemsFromPage(page, pageNum);
    items = items.concat(pageItems);
  }

  const numericTotalX = findRightmostNumericColumnX(items);
  const rowGroupCandidates = [
    buildRowGroupsFromItems(items),
    buildRowGroupsFromItems(items, 8),
    buildRowGroupsFromItems(items, 12),
  ];
  const rowResults = rowGroupCandidates.map((rowGroups) => {
    const rowData = buildRowData(rowGroups);
    const headerTotalX = findTotalColumnX(rowGroups);
    const totalX = Number.isFinite(headerTotalX)
      ? Number.isFinite(numericTotalX) && numericTotalX > headerTotalX + 8
        ? numericTotalX
        : headerTotalX
      : numericTotalX;
    return parsePaystubRows(rowData, totalX);
  });

  const lineRows = buildLinesFromItems(items);

  const itemsByPage = new Map();
  items.forEach((item) => {
    if (!itemsByPage.has(item.page)) itemsByPage.set(item.page, []);
    itemsByPage.get(item.page).push(item);
  });

  const columnMapResult = parsePaystubByColumnMap(itemsByPage);
  const itemsResult = parsePaystubItems(items);
  const linesResult = parsePaystubLines(lineRows);

  const score = (result) =>
    ['annualSalary', 'nontaxableSalary', 'grossSalary', 'withheldIncomeTax', 'withheldLocalTax', 'socialInsurance'].reduce(
      (sum, key) => sum + (result[key] !== null ? 1 : 0),
      0,
    );

  const ranked = [
    { result: columnMapResult, priority: 5 },
    ...rowResults.map((result, index) => ({ result, priority: 4 - index })),
    { result: linesResult, priority: 2 },
    { result: itemsResult, priority: 1 },
  ].sort((a, b) => {
    const scoreDiff = score(b.result) - score(a.result);
    if (scoreDiff !== 0) return scoreDiff;
    return b.priority - a.priority;
  });

  return ranked[0].result;
};

