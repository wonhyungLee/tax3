// 금융소득 종합과세 계산 엔진 (2024년 귀속, README 요약 반영)
// 주요 처리:
// - 금융소득 2천만원 분리/종합 비교과세
// - Gross-up 대상 배당 가산 및 배당세액공제(단순화된 한도)
// - 해외 금융소득 존재 시 강제 종합과세 및 외국납부세액공제 한도 계산(단순화)
// - 결정세액의 10%로 지방소득세 산출, 납부/환급 세액 계산

const fs = require('fs');
const path = require('path');

const DEFAULT_RULES = {
  taxYear: 2024,
  financialThreshold: 20_000_000,
  grossUpRate: 0.1, // 배당가산율 (연도별 룰 파일에서 교체 가능)
  progressiveRates: [
    { threshold: 14_000_000, rate: 0.06, deduction: 0 },
    { threshold: 50_000_000, rate: 0.15, deduction: 1_260_000 },
    { threshold: 88_000_000, rate: 0.24, deduction: 5_760_000 },
    { threshold: 150_000_000, rate: 0.35, deduction: 15_440_000 },
    { threshold: 300_000_000, rate: 0.38, deduction: 19_940_000 },
    { threshold: 500_000_000, rate: 0.40, deduction: 25_940_000 },
    { threshold: 1_000_000_000, rate: 0.42, deduction: 35_940_000 },
    { threshold: null, rate: 0.45, deduction: 65_940_000 },
  ],
  localRate: 0.1,
  rentalSeparateThreshold: 20_000_000,
  rentalSeparateRate: 0.14,
  rentalStandardExpenseRate: 0.5,
  imputedDepositThreshold: 300_000_000,
  imputedInterestRate: 0.025,
  imputedDeductionRatio: 0.6,
  imputedMinHouseCount: 2,
  rounding: { tax: 1, payable: 10 },
};

function ensureNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function toKRW(value) {
  return Math.floor(ensureNumber(value));
}

function floorToUnit(value, unit = 1) {
  if (!unit || unit <= 1) return Math.floor(value);
  return Math.floor(value / unit) * unit;
}

function normalizeRate(value) {
  const num = ensureNumber(value);
  if (num < 0) return 0;
  if (num > 1) return num / 100; // 퍼센트로 입력된 경우
  return num;
}

function clampRatio(value, label, warnings) {
  if (value == null || !Number.isFinite(Number(value))) {
    warnings?.push(`${label}는 숫자여야 합니다. 0으로 처리합니다.`);
    return 0;
  }
  const num = Number(value);
  if (num < 0) {
    warnings?.push(`${label}는 음수일 수 없습니다. 0으로 조정합니다.`);
    return 0;
  }
  if (num > 1) return num / 100;
  return num;
}

function computeOtherIncome(otherIncome = {}, rules) {
  const warnings = [];
  const items = Array.isArray(otherIncome.items) ? otherIncome.items : [];
  if (!items.length) {
    const gross = toKRW(otherIncome.gross);
    const deductions = toKRW(otherIncome.deductions);
    return {
      gross,
      deductions,
      taxable: Math.max(gross - deductions, 0),
      separateTax: 0,
      prepaid: 0,
      warnings,
    };
  }

  let grossSum = 0;
  let expenseSum = 0;
  let taxable = 0;
  let separateTax = 0;
  let prepaid = 0;
  let rentalSeparateUsed = 0;
  let rentalSeparateExcess = 0;
  const rentalThreshold = rules?.rentalSeparateThreshold ?? DEFAULT_RULES.rentalSeparateThreshold;
  const rentalSepRateDefault = normalizeRate(rules?.rentalSeparateRate ?? DEFAULT_RULES.rentalSeparateRate);
  const rentalStdExpenseRate = rules?.rentalStandardExpenseRate ?? DEFAULT_RULES.rentalStandardExpenseRate ?? 0.5;
  const imputedThreshold = rules?.imputedDepositThreshold ?? DEFAULT_RULES.imputedDepositThreshold;
  const imputedInterest = rules?.imputedInterestRate ?? DEFAULT_RULES.imputedInterestRate;
  const imputedRatio = rules?.imputedDeductionRatio ?? DEFAULT_RULES.imputedDeductionRatio ?? 0.6;
  const imputedMinHouseCount = rules?.imputedMinHouseCount ?? DEFAULT_RULES.imputedMinHouseCount ?? 2;
  let imputedRentalIncome = 0;

  for (const item of items) {
    const gross = toKRW(item.amount);
    grossSum += gross;
    const mode = (item.expenseMode || 'standard').toLowerCase();
    const isRental = (item.type || '').toLowerCase() === 'rental';
    const rate = clampRatio(
      item.expenseRate ?? (isRental ? rentalStdExpenseRate : 0),
      'expenseRate',
      warnings,
    );
    const actual = toKRW(item.expenseAmount);
    const expense = mode === 'actual' ? Math.min(actual, gross) : Math.min(Math.floor(gross * rate), gross);
    expenseSum += expense;
    const taxableItem = Math.max(gross - expense, 0);

    let sepRate = item.separate ? normalizeRate(item.separateRate ?? item.withholdingRate ?? 0) : 0;
    if (isRental && sepRate === 0 && item.separate) sepRate = rentalSepRateDefault;

    if (sepRate > 0) {
        let sepAmount = taxableItem;
        if (isRental && rentalThreshold > 0) {
          const remaining = Math.max(rentalThreshold - rentalSeparateUsed, 0);
          sepAmount = Math.min(remaining, taxableItem);
          const toComprehensive = taxableItem - sepAmount;
        if (toComprehensive > 0) {
          rentalSeparateExcess += toComprehensive;
          taxable += toComprehensive;
          warnings.push('임대 분리과세 한도(20,000,000) 초과분은 종합과세로 전환됩니다.');
        }
        rentalSeparateUsed += sepAmount;
      }
      separateTax += sepAmount * sepRate;
    } else {
      taxable += taxableItem;
    }
    prepaid += toKRW(item.prepaidTax);

    if (isRental && item.deposit > 0 && (item.houseCount ?? imputedMinHouseCount) >= imputedMinHouseCount) {
      const deposit = toKRW(item.deposit);
      if (deposit > imputedThreshold) {
        const months = Number.isFinite(item.months) && item.months > 0 ? item.months : 12;
        const imputedBase = deposit - imputedThreshold;
        const imputed = imputedBase * imputedInterest * (months / 12) * imputedRatio;
        imputedRentalIncome += imputed;
      }
    }
  }

  return {
    gross: grossSum,
    deductions: expenseSum,
    taxable: taxable + imputedRentalIncome,
    separateTax,
    prepaid,
    rentalSeparateUsed,
    rentalSeparateExcess,
    imputedRentalIncome,
    warnings,
  };
}

function loadRuleFile(taxYear) {
  try {
    const filePath = path.join(__dirname, '..', 'data', 'rules', `${taxYear}.json`);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed;
    }
  } catch (e) {
    // ignore, fallback to defaults
  }
  return null;
}

function resolveRules(settings = {}) {
  const year = settings.taxYear ?? DEFAULT_RULES.taxYear;
  const fileRules = loadRuleFile(year);
  const merged = {
    ...DEFAULT_RULES,
    ...(fileRules || {}),
    ...(settings.rules || {}),
  };
  merged.taxYear = year;
  if (settings.progressiveRates) merged.progressiveRates = settings.progressiveRates;
  if (settings.financialThreshold != null) merged.financialThreshold = settings.financialThreshold;
  if (settings.grossUpRate != null) merged.grossUpRate = settings.grossUpRate;
  if (settings.localRate != null) merged.localRate = settings.localRate;
  merged.rounding = {
    tax: settings.rounding?.tax ?? merged.rounding?.tax ?? 1,
    payable: settings.rounding?.payable ?? merged.rounding?.payable ?? 10,
  };
  return merged;
}

function computeProgressiveTax(base, brackets, roundingUnit = 1) {
  const taxable = Math.max(ensureNumber(base), 0);
  let bracketUsed = brackets[brackets.length - 1];
  for (const b of brackets) {
    if (b.threshold === null || taxable <= b.threshold) {
      bracketUsed = b;
      break;
    }
  }
  const tax = taxable * bracketUsed.rate - bracketUsed.deduction;
  return {
    tax: floorToUnit(tax, roundingUnit),
    taxable,
    bracketUsed,
  };
}

function allocateFinancialThreshold(financialIncomes = [], threshold) {
  let remaining = threshold;
  const allocations = [];
  for (const item of financialIncomes) {
    const amount = toKRW(item.amount);
    const take = Math.max(Math.min(remaining, amount), 0);
    const excess = Math.max(amount - take, 0);
    remaining -= take;
    allocations.push({ ...item, amount, thresholdPortion: take, excessPortion: excess });
  }
  return allocations;
}

function calculateTax(input = {}) {
  const warnings = [];
  const rules = resolveRules(input.settings || {});
  const progressiveRates = rules.progressiveRates;
  const roundingTax = rules.rounding.tax;
  const roundingPayable = rules.rounding.payable;
  const grossUpRate = rules.grossUpRate;
  const threshold = rules.financialThreshold;

  const financialIncomes = Array.isArray(input.financialIncomes) ? input.financialIncomes : [];
  const otherIncomeResult = computeOtherIncome(input.otherIncome, rules);
  warnings.push(...otherIncomeResult.warnings);
  const otherTaxableBase = otherIncomeResult.taxable;

  const withAlloc = allocateFinancialThreshold(financialIncomes, threshold);
  const financialTotal = withAlloc.reduce((sum, f) => sum + f.amount, 0);
  const separateFinancialTax = withAlloc.reduce(
    (sum, f) => sum + f.amount * normalizeRate(f.withholdingRate ?? 0.14),
    0,
  );
  const thresholdTax = withAlloc.reduce(
    (sum, f) => sum + f.thresholdPortion * normalizeRate(f.withholdingRate ?? 0.14),
    0,
  );
  const thresholdUsed = withAlloc.reduce((sum, f) => sum + f.thresholdPortion, 0);

  let excessFinancial = 0;
  let grossUpBase = 0;
  let foreignIncome = 0;
  let foreignTaxPaid = 0;
  let prepaidWithholding = 0;
  let forceComprehensive = false;

  for (const f of withAlloc) {
    const rate = normalizeRate(f.withholdingRate ?? 0.14);
    excessFinancial += f.excessPortion;
    if (f.grossUpEligible) grossUpBase += f.excessPortion;
    const source = (f.source || 'domestic').toLowerCase();
    if (source === 'foreign') {
      foreignIncome += f.amount;
      foreignTaxPaid += toKRW(f.foreignTaxPaid ?? f.prepaidTax);
      forceComprehensive = true; // 해외소득 있는 경우 종합과세 강제
    }
    prepaidWithholding += toKRW(f.prepaidTax ?? f.amount * rate);
  }

  const grossUpAmount = toKRW(grossUpBase * grossUpRate);
  const comprehensiveTaxableBase = Math.max(otherTaxableBase + excessFinancial + grossUpAmount, 0);
  const progressiveComprehensive = computeProgressiveTax(comprehensiveTaxableBase, progressiveRates, roundingTax);
  const progressiveOtherOnly = computeProgressiveTax(otherTaxableBase, progressiveRates, roundingTax);

  const separateOtherTax = otherIncomeResult.separateTax;

  const methodATax = thresholdTax + progressiveComprehensive.tax + separateOtherTax;
  const methodBTax = separateFinancialTax + progressiveOtherOnly.tax + separateOtherTax;

  let comparisonNote = '';
  let chosenMethod = 'separate';
  let chosenTaxBeforeCredits = methodBTax;
  if (financialTotal > threshold || forceComprehensive) {
    chosenMethod = methodATax >= methodBTax ? 'comprehensive' : 'separate';
    chosenTaxBeforeCredits = Math.max(methodATax, methodBTax);
    comparisonNote = `비교과세 적용: 종합 ${Math.round(methodATax)} / 분리 ${Math.round(methodBTax)}`;
  } else {
    comparisonNote = '2천만원 이하 → 분리과세 선택';
  }

  // 배당세액공제 (단순화): Gross-up 금액 vs (종합 산출세액 - (다른소득 산출세액 + 금융소득 원천징수세액))
  let dividendCredit = 0;
  if (grossUpAmount > 0 && (financialTotal > threshold || forceComprehensive)) {
    const financialWithholdingTax = separateFinancialTax;
    const creditLimit = Math.max(progressiveComprehensive.tax - (progressiveOtherOnly.tax + financialWithholdingTax), 0);
    dividendCredit = Math.min(grossUpAmount, creditLimit);
  }

  // 외국납부세액공제 (단순화)
  let foreignTaxCredit = 0;
  if (foreignIncome > 0) {
    const totalIncomeForRatio = Math.max(otherIncomeResult.gross + excessFinancial, 1);
    const ratio = Math.min(foreignIncome / totalIncomeForRatio, 1);
    const creditLimit = chosenTaxBeforeCredits * ratio;
    foreignTaxCredit = Math.min(creditLimit, foreignTaxPaid);
  }

  const otherTaxCredit = toKRW(input.taxCredits?.other);

  const nationalTax = floorToUnit(
    Math.max(chosenTaxBeforeCredits - dividendCredit - foreignTaxCredit - otherTaxCredit, 0),
    roundingTax,
  );
  const localIncomeTax = floorToUnit(nationalTax * rules.localRate, roundingTax);

  const prepaidNational = toKRW(input.prepaid?.national) + prepaidWithholding;
  const prepaidLocal = toKRW(input.prepaid?.local);
  const totalPayableRaw =
    nationalTax + localIncomeTax - prepaidNational - prepaidLocal - otherIncomeResult.prepaid;
  const totalPayable = floorToUnit(totalPayableRaw, roundingPayable);

  const trace = [
    {
      step: 'Financial split',
      financialTotal,
      thresholdUsed,
      excessFinancial,
      grossUpBase,
      grossUpAmount,
      thresholdTax,
      separateFinancialTax,
      separateOtherTax,
    },
    {
      step: 'Progressive',
      comprehensiveTaxableBase,
      progressiveComprehensive: progressiveComprehensive.tax,
      otherTaxableBase,
      progressiveOtherOnly: progressiveOtherOnly.tax,
    },
    {
      step: 'Comparison',
      methodATax,
      methodBTax,
      chosenMethod,
      chosenTaxBeforeCredits,
      dividendCredit,
      foreignTaxCredit,
      otherTaxCredit,
      nationalTax,
      localIncomeTax,
      prepaidNational,
      prepaidLocal,
      totalPayable,
    },
  ];

  const result = {
    taxYear: rules.taxYear,
    chosenMethod,
    comparisonNote,
    financialTotal,
    thresholdUsed,
    excessFinancial,
    grossUpAmount,
    progressive: {
      comprehensive: progressiveComprehensive,
      otherOnly: progressiveOtherOnly,
    },
    taxes: {
      methodATax,
      methodBTax,
      chosenTaxBeforeCredits,
      dividendCredit,
      foreignTaxCredit,
      otherTaxCredit,
      nationalTax,
      localIncomeTax,
      separateOtherTax,
      totalPayable,
    },
    prepaid: {
      prepaidNational,
      prepaidLocal,
      prepaidWithholding,
      prepaidOther: otherIncomeResult.prepaid,
    },
    rental: {
      separateUsed: otherIncomeResult.rentalSeparateUsed,
      separateExcess: otherIncomeResult.rentalSeparateExcess,
      threshold: rules.rentalSeparateThreshold,
    },
    trace,
    warnings,
  };

  return result;
}

module.exports = {
  calculateTax,
  computeProgressiveTax,
  ensureNumber,
  DEFAULT_RULES,
};
