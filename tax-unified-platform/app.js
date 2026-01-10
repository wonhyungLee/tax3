const fmt = new Intl.NumberFormat('ko-KR');
const formatKRW = (v) => `₩ ${fmt.format(Math.round(v || 0))}`;
const formatSigned = (v) => (v >= 0 ? `${formatKRW(v)} 납부` : `${formatKRW(Math.abs(v))} 환급`);
const num = (id) => {
  const el = document.getElementById(id);
  if (!el) return 0;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : 0;
};
const rateFromInput = (id, fallback = 0) => {
  const raw = num(id);
  if (!Number.isFinite(raw)) return fallback;
  return raw > 1 ? raw / 100 : raw;
};

// ---------------- Tabs ----------------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((panel) =>
      panel.classList.toggle('active', panel.id === `tab-${tab}`)
    );
  });
});

const setPulse = (id, valueText, noteText) => {
  const card = document.getElementById(id);
  if (!card) return;
  const valueEl = card.querySelector('[data-value]');
  const noteEl = card.querySelector('[data-note]');
  if (valueEl) valueEl.textContent = valueText;
  if (noteEl) noteEl.textContent = noteText;
};

const renderCards = (container, cards) => {
  const grid = container.querySelector('[data-cards]');
  const main = container.querySelector('[data-main]');
  const sub = container.querySelector('[data-sub]');
  if (cards.main) main.textContent = cards.main;
  if (cards.sub) sub.textContent = cards.sub;
  if (grid) {
    grid.innerHTML = '';
    cards.items.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'card';
      div.innerHTML = `<h4>${c.title}</h4><p>${c.body}</p>`;
      grid.appendChild(div);
    });
  }
};

// ---------------- 연말정산 계산 ----------------
const earnedIncomeDeduction = (gross) => {
  if (gross <= 5_000_000) return gross * 0.7;
  if (gross <= 15_000_000) return 3_500_000 + (gross - 5_000_000) * 0.4;
  if (gross <= 45_000_000) return 7_500_000 + (gross - 15_000_000) * 0.15;
  if (gross <= 100_000_000) return 12_000_000 + (gross - 45_000_000) * 0.05;
  const deduction = 14_750_000 + (gross - 100_000_000) * 0.02;
  return Math.min(deduction, 20_000_000);
};

const progressiveTaxYearEnd = (taxable) => {
  const brackets = [
    { limit: 14_000_000, rate: 0.06, deduction: 0 },
    { limit: 50_000_000, rate: 0.15, deduction: 840_000 },
    { limit: 88_000_000, rate: 0.24, deduction: 6_240_000 },
    { limit: 150_000_000, rate: 0.35, deduction: 15_360_000 },
    { limit: 300_000_000, rate: 0.38, deduction: 37_060_000 },
    { limit: 500_000_000, rate: 0.4, deduction: 94_060_000 },
    { limit: 1_000_000_000, rate: 0.42, deduction: 174_060_000 },
    { limit: Infinity, rate: 0.45, deduction: 384_060_000 },
  ];
  const bracket = brackets.find((item) => taxable <= item.limit) || brackets[brackets.length - 1];
  return taxable * bracket.rate - bracket.deduction;
};

const calcCardTargets = (gross) => {
  if (!Number.isFinite(gross) || gross <= 0) {
    return { threshold: 0, baseTarget: 0, baseTargetCredit: 0, maxTarget: 0 };
  }
  const threshold = gross * 0.25;
  const baseCap = gross <= 70_000_000 ? 3_000_000 : 2_500_000;
  const extraCap = gross <= 70_000_000 ? 3_000_000 : 2_000_000;
  const baseTarget = threshold + baseCap / 0.3;
  const baseTargetCredit = threshold + baseCap / 0.15;
  const maxTarget = threshold + (baseCap + extraCap) / 0.4;
  return { threshold, baseTarget, baseTargetCredit, maxTarget };
};

const calcCardDeduction = ({ gross, credit, debit, market, culture, sports, cultureEligible, previousSpend }) => {
  const cultureAmount = cultureEligible ? culture + sports : 0;
  const total = credit + debit + market + cultureAmount;
  const threshold = gross * 0.25;

  if (total <= threshold || total === 0) {
    return {
      deduction: 0,
      breakdown: { credit: 0, debit: 0, market: 0, culture: 0 },
      meta: { total, threshold, eligible: 0, thresholdDeduction: 0, possible: 0 },
    };
  }

  const creditDed = credit * 0.15;
  const debitDed = debit * 0.3;
  const cultureDed = cultureAmount * 0.3;
  const marketDed = market * 0.4;

  let thresholdDeduction = 0;
  const midTotal = credit + debit + cultureAmount;
  const allTotal = midTotal + market;

  if (threshold <= credit) thresholdDeduction = threshold * 0.15;
  else if (threshold <= midTotal) thresholdDeduction = credit * 0.15 + (threshold - credit) * 0.3;
  else if (threshold <= allTotal) {
    thresholdDeduction = credit * 0.15 + (debit + cultureAmount) * 0.3 + (threshold - midTotal) * 0.4;
  } else {
    return {
      deduction: 0,
      breakdown: { credit: 0, debit: 0, market: 0, culture: 0 },
      meta: { total, threshold, eligible: 0, thresholdDeduction: 0, possible: 0 },
    };
  }

  const possible = Math.max(0, creditDed + debitDed + cultureDed + marketDed - thresholdDeduction);
  const baseCap = gross <= 70_000_000 ? 3_000_000 : 2_500_000;
  const extraCap = gross <= 70_000_000 ? 3_000_000 : 2_000_000;
  const categorySum = gross <= 70_000_000 ? cultureDed + marketDed : marketDed;

  if (possible <= baseCap) {
    return {
      deduction: possible,
      breakdown: { credit: creditDed, debit: debitDed, market: marketDed, culture: cultureDed },
      meta: { total, threshold, eligible: total - threshold, thresholdDeduction, possible, baseCap },
    };
  }

  const extraAmount = possible - baseCap;
  const categoryAdd = Math.min(extraAmount, categorySum, extraCap);
  const remaining = Math.max(0, extraAmount - categoryAdd);

  let consumptionIncrease = 0;
  if (previousSpend > 0) {
    const increase = total - previousSpend * 1.05;
    if (increase > 0) consumptionIncrease = Math.min(increase * 0.1, 1_000_000);
  }

  const consumptionAdd = Math.min(remaining, consumptionIncrease);
  const deduction = baseCap + categoryAdd + consumptionAdd;

  return {
    deduction,
    breakdown: { credit: creditDed, debit: debitDed, market: marketDed, culture: cultureDed },
    meta: {
      total,
      threshold,
      eligible: total - threshold,
      thresholdDeduction,
      possible,
      baseCap,
      categoryAdd,
      consumptionAdd,
    },
  };
};

const yearEndSample = {
  salary: 62_000_000,
  withheld: 3_200_000,
  withheldLocal: 320_000,
  dependents: 2,
  disabled: 0,
  children: 2,
  social: 3_500_000,
  pension: 3_000_000,
  isa: 0,
  irp: true,
  credit: 14_000_000,
  debit: 4_000_000,
  market: 2_000_000,
  culture: 500_000,
  prevCard: 10_000_000,
  housing: 1_200_000,
  lease: 0,
  mortgage: 1_500_000,
  mortgageLimit: 1_800_000,
  other: 500_000,
};

const runYearEnd = () => {
  const gross = num('ye_salary');
  const withheld = num('ye_withheld');
  const withheldLocal = num('ye_withheld_local') || Math.round(withheld * 0.1);
  const dependents = num('ye_dependents');
  const disabled = num('ye_disabled');
  const children = num('ye_children');
  const social = num('ye_social');
  const pension = num('ye_pension');
  const isa = num('ye_isa');
  const irp = document.getElementById('ye_irp').value === 'true';
  const credit = num('ye_credit');
  const debit = num('ye_debit');
  const market = num('ye_market');
  const culture = num('ye_culture');
  const prevCard = num('ye_prev_card');
  const housing = num('ye_housing');
  const lease = num('ye_lease');
  const mortgage = num('ye_mortgage');
  const mortgageLimit = num('ye_mortgage_limit');
  const other = num('ye_other');

  const baseDeduction = 1_500_000 * (1 + dependents) + disabled * 2_000_000;
  const earnedDeduction = earnedIncomeDeduction(gross);
  const earnedIncome = Math.max(0, gross - earnedDeduction);
  const card = calcCardDeduction({
    gross,
    credit,
    debit,
    market,
    culture,
    sports: 0,
    cultureEligible: gross <= 70_000_000,
    previousSpend: prevCard,
  });
  const cardTargets = calcCardTargets(gross);
  const housingSavingsRaw = gross <= 70_000_000 ? Math.min(housing, 3_000_000) * 0.4 : 0;
  const leaseRaw = lease * 0.4;
  const housingCombined = Math.min(housingSavingsRaw + leaseRaw, 4_000_000);
  const housingSavingsDeduction = Math.min(housingSavingsRaw, housingCombined);
  const leaseDeduction = Math.min(leaseRaw, Math.max(0, housingCombined - housingSavingsDeduction));
  const mortgageDeduction = Math.min(mortgage, mortgageLimit || mortgage);
  const pensionCap = irp ? 9_000_000 : 6_000_000;
  const pensionEligible = Math.min(pension, pensionCap) + Math.min(isa * 0.1, 3_000_000);
  const pensionCredit = pensionEligible * (gross <= 55_000_000 ? 0.15 : 0.12);

  const incomeDeductionTotal =
    baseDeduction + social + card.deduction + housingSavingsDeduction + leaseDeduction + mortgageDeduction + other;
  const taxableIncome = Math.max(0, earnedIncome - incomeDeductionTotal);
  const calculatedTax = Math.max(0, progressiveTaxYearEnd(taxableIncome));

  let earnedIncomeTaxCredit = Math.min(calculatedTax * 0.55, 1_300_000);
  if (calculatedTax > 1_300_000) {
    earnedIncomeTaxCredit = Math.min(earnedIncomeTaxCredit, 715_000 + (calculatedTax - 1_300_000) * 0.3);
  }
  const earnedCreditCap =
    gross <= 33_000_000 ? 740_000 : gross <= 70_000_000 ? 660_000 : gross <= 120_000_000 ? 500_000 : 200_000;
  earnedIncomeTaxCredit = Math.min(earnedIncomeTaxCredit, earnedCreditCap);

  let childTaxCredit = 0;
  if (children === 1) childTaxCredit = 250_000;
  else if (children === 2) childTaxCredit = 550_000;
  else if (children >= 3) childTaxCredit = 550_000 + (children - 2) * 400_000;

  const nationalTax = Math.max(0, calculatedTax - earnedIncomeTaxCredit - childTaxCredit - pensionCredit);
  const localTax = Math.floor(nationalTax * 0.1);
  const totalTax = nationalTax + localTax;
  const withheldTotal = withheld + withheldLocal;
  const payable = totalTax - withheldTotal;

  const cards = [
    {
      title: payable >= 0 ? '추가 납부 예상' : '환급 예상',
      body: `${formatSigned(payable)} (국세 ${formatKRW(nationalTax)} · 지방세 ${formatKRW(localTax)})`,
    },
    {
      title: '근로소득공제 후 과세표준',
      body: `근로소득금액 ${formatKRW(earnedIncome)}, 공제합계 ${formatKRW(incomeDeductionTotal)}, 과세표준 ${formatKRW(taxableIncome)}`,
    },
    {
      title: '카드 공제',
      body: `공제액 ${formatKRW(card.deduction)} / 한도 ${formatKRW(gross <= 70_000_000 ? 6_000_000 : 4_500_000)} · 추가 소비 여지 ${formatKRW(Math.max(0, cardTargets.maxTarget - card.meta.total))}`,
    },
    {
      title: '연금·자녀 세액공제',
      body: `연금저축 공제 ${formatKRW(pensionCredit)}, 자녀세액공제 ${formatKRW(childTaxCredit)}, 근로소득세액공제 ${formatKRW(earnedIncomeTaxCredit)}`,
    },
  ];

  renderCards(document.getElementById('ye-output'), {
    main: payable >= 0 ? formatSigned(payable) : formatSigned(payable),
    sub: `원천징수 ${formatKRW(withheldTotal)} 반영`,
    items: cards,
  });
  setPulse('pulse-yearend', payable >= 0 ? `납부 ${formatKRW(payable)}` : `환급 ${formatKRW(Math.abs(payable))}`, '연말정산 간편 결과');
};

document.getElementById('ye-run').addEventListener('click', runYearEnd);
document.getElementById('ye-fill').addEventListener('click', () => {
  Object.entries(yearEndSample).forEach(([k, v]) => {
    const map = {
      salary: 'ye_salary',
      withheld: 'ye_withheld',
      withheldLocal: 'ye_withheld_local',
      dependents: 'ye_dependents',
      disabled: 'ye_disabled',
      children: 'ye_children',
      social: 'ye_social',
      pension: 'ye_pension',
      isa: 'ye_isa',
      irp: 'ye_irp',
      credit: 'ye_credit',
      debit: 'ye_debit',
      market: 'ye_market',
      culture: 'ye_culture',
      prevCard: 'ye_prev_card',
      housing: 'ye_housing',
      lease: 'ye_lease',
      mortgage: 'ye_mortgage',
      mortgageLimit: 'ye_mortgage_limit',
      other: 'ye_other',
    };
    const id = map[k];
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') el.value = String(v);
    else el.value = v;
  });
});

// ---------------- 법인세 계산 ----------------
const normalizeEntityType = (raw) => {
  const upper = (raw || '').toString().toUpperCase();
  if (upper !== 'SME' && upper !== 'GENERAL') throw new Error('기업 유형은 SME 또는 General이어야 합니다.');
  return upper === 'SME' ? 'SME' : 'GENERAL';
};

const calculateDeemedInterest = (overdraftRate, advances, interestPaid) => {
  const raw = (overdraftRate || 0) * (advances || 0) - (interestPaid || 0);
  return Math.max(0, Math.round(raw));
};

const progressiveRevenueLimit = (revenue) => {
  const brackets = [
    [10_000_000_000, 0.003],
    [50_000_000_000, 0.002],
    [null, 0.0003],
  ];
  let remaining = revenue;
  let prevCap = 0;
  let total = 0;
  for (const [cap, rate] of brackets) {
    const slice = cap === null ? remaining : Math.max(0, Math.min(remaining, cap - prevCap));
    total += slice * rate;
    remaining -= slice;
    prevCap = cap ?? prevCap;
    if (remaining <= 0) break;
  }
  return total;
};

const calculateBusinessPromotionLimit = (entityType, bpInput, revenue) => {
  const baseLimit = entityType === 'SME' ? 36_000_000 : 12_000_000;
  const revenueLimitGeneral = progressiveRevenueLimit(revenue.general);
  const revenueLimitRelated = 0.1 * progressiveRevenueLimit(revenue.relatedParty);
  const revenueLimit = Math.round(revenueLimitGeneral + revenueLimitRelated);
  const mainLimit = baseLimit + revenueLimit;
  const culturalBonus = Math.round(Math.min(bpInput.cultural, mainLimit * 0.2));
  const marketBonus = Math.round(Math.min(bpInput.market, mainLimit * 0.1));
  const deductibleCap = mainLimit + culturalBonus + marketBonus;
  const allowableBase = Math.max(0, bpInput.total - bpInput.noProof);
  const deductible = Math.round(Math.min(allowableBase, deductibleCap));
  const nonDeductible = bpInput.total - deductible;
  return { baseLimit, revenueLimit, culturalBonus, marketBonus, deductibleCap, deductible, nonDeductible };
};

const calculateVehicleDepreciation = (vehicles) => {
  const limit = (vehicles.count || 0) * 8_000_000;
  const allowed = Math.min(vehicles.depreciation || 0, limit);
  return { allowed, disallowed: (vehicles.depreciation || 0) - allowed, limit };
};

const calculateGeneralDepreciation = (dep) => {
  if (dep.statutoryLimit == null) return { allowed: dep.claimed || 0, disallowed: 0, limit: dep.claimed || 0 };
  const allowed = Math.min(dep.claimed || 0, dep.statutoryLimit);
  return { allowed, disallowed: (dep.claimed || 0) - allowed, limit: dep.statutoryLimit };
};

const calculateRevenueAdjustments = (financialData) => {
  const deemedInterest = calculateDeemedInterest(
    financialData.overdraftRate,
    financialData.advancesToRelated,
    financialData.interestPaid
  );
  const deemedRent = 0;
  const excessRetained = 0;
  const total = deemedInterest + deemedRent + excessRetained;
  return { deemedInterest, deemedRent, excessRetained, total };
};

const calculateExpenseAdjustments = (entityType, financialData) => {
  const bp = calculateBusinessPromotionLimit(entityType, financialData.expenses.businessPromotion, financialData.revenue);
  const vehicle = calculateVehicleDepreciation(financialData.expenses.vehicles);
  const generalDep = calculateGeneralDepreciation(financialData.expenses.generalDepreciation);
  const nonBusiness = financialData.expenses.nonBusiness || 0;
  const totalNonDeductible = bp.nonDeductible + vehicle.disallowed + generalDep.disallowed + nonBusiness;
  return { businessPromotion: bp, vehicle, generalDep, nonBusiness, totalNonDeductible };
};

const lossCapRate = (entityType) => (entityType === 'SME' ? 1.0 : 0.8);
const lossExpired = (loss, filingYear) => {
  const allowedYears = loss.originYear < 2020 ? 10 : 15;
  return filingYear - loss.originYear >= allowedYears;
};

const rateTableForYear = () => [
  [200_000_000, 0.09, 0],
  [20_000_000_000, 0.19, 20_000_000],
  [300_000_000_000, 0.21, 420_000_000],
  [null, 0.24, 9_420_000_000],
];

const applyLossCarryforward = (taxableBeforeLoss, loss, entityType, filingYear) => {
  if (taxableBeforeLoss <= 0) {
    return { applied: 0, remaining: loss.totalAvailable, expired: lossExpired(loss, filingYear), allowedRate: lossCapRate(entityType) };
  }
  const expired = lossExpired(loss, filingYear);
  if (expired) {
    return { applied: 0, remaining: loss.totalAvailable, expired: true, allowedRate: lossCapRate(entityType) };
  }
  const capRate = lossCapRate(entityType);
  const capAmount = taxableBeforeLoss * capRate;
  const applied = Math.round(Math.min(loss.totalAvailable, capAmount));
  const remaining = loss.totalAvailable - applied;
  return { applied, remaining, expired: false, allowedRate: capRate };
};

const calculateProgressiveTax = (taxBase, rateTable) => {
  for (const [cap, rate, deduction] of rateTable) {
    if (cap === null || taxBase <= cap) return Math.round(taxBase * rate - deduction);
  }
  return 0;
};

const calculateRDCredit = (rd, entityType) => {
  if (entityType === 'SME') {
    const baseCredit = rd.current * 0.25;
    const incremental = rd.increment * 0.5;
    return Math.max(baseCredit, incremental);
  }
  const baseRate = rd.baseRate == null ? 0.02 : Math.max(0, Math.min(rd.baseRate, 0.02));
  const baseCredit = rd.current * baseRate;
  const incremental = rd.increment * 0.25;
  return Math.max(baseCredit, incremental);
};

const calculateInvestmentCredit = (inv, entityType) => {
  const baseRate = entityType === 'SME' ? 0.1 : 0.01;
  const base = inv.current * baseRate;
  const increase = Math.max(0, inv.current - inv.avgThreeYear);
  const additional = increase * 0.03;
  return base + additional;
};

const calculateCredits = (calculatedTax, credits, entityType) => {
  let remaining = calculatedTax;
  const rdCreditRaw = calculateRDCredit(credits.rd, entityType);
  const rdCredit = Math.round(Math.min(rdCreditRaw, remaining));
  remaining -= rdCredit;
  const invCreditRaw = calculateInvestmentCredit(credits.investment, entityType);
  const investmentCredit = Math.round(Math.min(invCreditRaw, remaining));
  remaining -= investmentCredit;
  const otherCredit = Math.round(Math.min(credits.other || 0, remaining));
  remaining -= otherCredit;
  const foreignTaxCredit = Math.round(Math.min(credits.foreignTax || 0, remaining));
  remaining -= foreignTaxCredit;
  return {
    rdCredit,
    investmentCredit,
    otherCredit,
    foreignTaxCredit,
    total: rdCredit + investmentCredit + otherCredit + foreignTaxCredit,
    remainingAfterGeneralCredits: remaining,
  };
};

const minimumTaxRate = (entityType, taxBase) => {
  if (entityType === 'SME') return 0.07;
  if (taxBase <= 10_000_000_000) return 0.1;
  if (taxBase <= 100_000_000_000) return 0.12;
  return 0.17;
};

const calculateMinimumTax = (taxBase, entityType) => Math.round(taxBase * minimumTaxRate(entityType, taxBase));

const computeCorporateTax = (payload) => {
  const entityType = normalizeEntityType(payload.companyProfile.type);
  const revenueAdj = calculateRevenueAdjustments(payload.financialData);
  const expenseAdj = calculateExpenseAdjustments(entityType, payload.financialData);
  const brackets = rateTableForYear();

  const manualAdditions = 0;
  const manualDeductions = 0;

  const preDonationTaxable =
    payload.financialData.netIncome +
    revenueAdj.total +
    expenseAdj.totalNonDeductible +
    manualAdditions -
    manualDeductions;
  const taxableBeforeLoss = preDonationTaxable;

  const lossResult = applyLossCarryforward(
    taxableBeforeLoss,
    payload.adjustments.lossCarryforward,
    entityType,
    payload.filingYear
  );

  const taxBase = Math.max(0, taxableBeforeLoss - lossResult.applied);
  const calculatedTax = calculateProgressiveTax(taxBase, brackets);
  const creditResult = calculateCredits(calculatedTax, payload.credits, entityType);
  const taxAfterCredits = Math.max(0, calculatedTax - creditResult.total);
  const minimumTax = calculateMinimumTax(taxBase, entityType);
  const preExemptTax = Math.max(taxAfterCredits, minimumTax);
  const finalTax = preExemptTax;
  const prepaidTax = payload.adjustments.prepaidTax || 0;
  const payableTax = finalTax - prepaidTax;

  return {
    entityType,
    revenueAdj,
    expenseAdj,
    taxableBeforeLoss,
    lossResult,
    taxBase,
    calculatedTax,
    creditResult,
    taxAfterCredits,
    minimumTax,
    finalTax,
    prepaidTax,
    payableTax,
  };
};

const corpSample = {
  type: 'SME',
  net: 5_000_000_000,
  revGeneral: 15_000_000_000,
  revRelated: 2_000_000_000,
  bpTotal: 1_200_000_000,
  bpNoProof: 50_000_000,
  bpCulture: 200_000_000,
  bpMarket: 80_000_000,
  advances: 2_000_000_000,
  odRate: 0.045,
  interest: 40_000_000,
  vehicleCount: 3,
  vehicleDep: 30_000_000,
  depClaimed: 100_000_000,
  depLimit: 120_000_000,
  nonBusiness: 20_000_000,
  loss: 1_000_000_000,
  lossYear: 2022,
  rdCurrent: 300_000_000,
  rdIncrement: 100_000_000,
  rdBase: 0.015,
  invCurrent: 500_000_000,
  invAvg: 300_000_000,
  otherCredit: 0,
  foreignCredit: 0,
  prepaid: 0,
};

const runCorporate = () => {
  const payload = {
    filingYear: 2025,
    companyProfile: { type: document.getElementById('corp_type').value },
    financialData: {
      netIncome: num('corp_net'),
      revenue: { general: num('corp_rev_general'), relatedParty: num('corp_rev_related') },
      expenses: {
        businessPromotion: {
          total: num('corp_bp_total'),
          cultural: num('corp_bp_culture'),
          market: num('corp_bp_market'),
          noProof: num('corp_bp_no_proof'),
        },
        vehicles: { count: num('corp_vehicle_count'), depreciation: num('corp_vehicle_dep') },
        generalDepreciation: {
          claimed: num('corp_dep_claimed'),
          statutoryLimit: document.getElementById('corp_dep_limit').value === '' ? null : num('corp_dep_limit'),
        },
        nonBusiness: num('corp_non_business'),
      },
      advancesToRelated: num('corp_advances'),
      overdraftRate: rateFromInput('corp_od_rate'),
      interestPaid: num('corp_interest'),
    },
    adjustments: {
      lossCarryforward: { totalAvailable: num('corp_loss'), originYear: num('corp_loss_year') || 2020 },
      prepaidTax: num('corp_prepaid'),
    },
    credits: {
      rd: { current: num('corp_rd_current'), increment: num('corp_rd_increment'), baseRate: rateFromInput('corp_rd_base') },
      investment: { current: num('corp_inv_current'), avgThreeYear: num('corp_inv_avg') },
      other: num('corp_other_credit'),
      foreignTax: num('corp_foreign_credit'),
    },
  };

  const result = computeCorporateTax(payload);
  const bp = result.expenseAdj.businessPromotion;
  const bpHeadroom = Math.max(0, (bp.deductibleCap || 0) - (bp.deductible || 0));
  const cards = [
    {
      title: result.payableTax >= 0 ? '추가 납부 예상' : '환급 예상',
      body: `${formatSigned(result.payableTax)} (최종세액 ${formatKRW(result.finalTax)} · 기납부 ${formatKRW(result.prepaidTax)})`,
    },
    {
      title: '과세표준',
      body: `이월결손금 적용 전 ${formatKRW(result.taxableBeforeLoss)}, 적용액 ${formatKRW(result.lossResult.applied)}, 과표 ${formatKRW(result.taxBase)}`,
    },
    {
      title: '접대비 한도',
      body: `불산입 ${formatKRW(bp.nonDeductible)} · 한도 ${formatKRW(bp.deductibleCap)} (추가 여지 ${formatKRW(bpHeadroom)})`,
    },
    {
      title: '세액공제 & 최저한세',
      body: `세액공제 ${formatKRW(result.creditResult.total)}, 산출세액 ${formatKRW(result.calculatedTax)}, 최저한세 ${formatKRW(result.minimumTax)}`,
    },
  ];

  renderCards(document.getElementById('corp-output'), {
    main: formatSigned(result.payableTax),
    sub: `익금/손금 조정 ${formatKRW(result.revenueAdj.total + result.expenseAdj.totalNonDeductible)}`,
    items: cards,
  });
  setPulse('pulse-corp', formatSigned(result.payableTax), '접대비·최저한세 반영');
};

document.getElementById('corp-run').addEventListener('click', runCorporate);
document.getElementById('corp-fill').addEventListener('click', () => {
  const map = {
    type: 'corp_type',
    net: 'corp_net',
    revGeneral: 'corp_rev_general',
    revRelated: 'corp_rev_related',
    bpTotal: 'corp_bp_total',
    bpNoProof: 'corp_bp_no_proof',
    bpCulture: 'corp_bp_culture',
    bpMarket: 'corp_bp_market',
    advances: 'corp_advances',
    odRate: 'corp_od_rate',
    interest: 'corp_interest',
    vehicleCount: 'corp_vehicle_count',
    vehicleDep: 'corp_vehicle_dep',
    depClaimed: 'corp_dep_claimed',
    depLimit: 'corp_dep_limit',
    nonBusiness: 'corp_non_business',
    loss: 'corp_loss',
    lossYear: 'corp_loss_year',
    rdCurrent: 'corp_rd_current',
    rdIncrement: 'corp_rd_increment',
    rdBase: 'corp_rd_base',
    invCurrent: 'corp_inv_current',
    invAvg: 'corp_inv_avg',
    otherCredit: 'corp_other_credit',
    foreignCredit: 'corp_foreign_credit',
    prepaid: 'corp_prepaid',
  };
  Object.entries(corpSample).forEach(([k, v]) => {
    const id = map[k];
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') el.value = v;
    else el.value = v;
  });
});

// ---------------- 금융소득 종합과세 ----------------
const ensureNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const floorToUnit = (value, unit = 1) => (!unit || unit <= 1 ? Math.floor(value) : Math.floor(value / unit) * unit);
const normalizeRate = (value) => {
  const numVal = ensureNumber(value);
  if (numVal < 0) return 0;
  return numVal > 1 ? numVal / 100 : numVal;
};

const computeProgressiveTax = (base, brackets, roundingUnit = 1) => {
  const taxable = Math.max(ensureNumber(base), 0);
  let bracketUsed = brackets[brackets.length - 1];
  for (const b of brackets) {
    if (b.threshold === null || taxable <= b.threshold) {
      bracketUsed = b;
      break;
    }
  }
  const tax = taxable * bracketUsed.rate - bracketUsed.deduction;
  return { tax: floorToUnit(tax, roundingUnit), taxable, bracketUsed };
};

const computeOtherIncome = (otherIncome = {}, rules) => {
  const warnings = [];
  const items = Array.isArray(otherIncome.items) ? otherIncome.items : [];
  if (!items.length) {
    const gross = ensureNumber(otherIncome.gross);
    const deductions = ensureNumber(otherIncome.deductions);
    return {
      gross,
      deductions,
      taxable: Math.max(gross - deductions, 0),
      separateTax: 0,
      prepaid: 0,
      warnings,
      rentalSeparateUsed: 0,
      rentalSeparateExcess: 0,
    };
  }
  let grossSum = 0;
  let expenseSum = 0;
  let taxable = 0;
  let separateTax = 0;
  let prepaid = 0;
  let rentalSeparateUsed = 0;
  let rentalSeparateExcess = 0;
  const rentalThreshold = rules?.rentalSeparateThreshold ?? 20_000_000;
  const rentalSepRateDefault = normalizeRate(rules?.rentalSeparateRate ?? 0.14);
  const rentalStdExpenseRate = rules?.rentalStandardExpenseRate ?? 0.5;

  for (const item of items) {
    const gross = ensureNumber(item.amount);
    grossSum += gross;
    const mode = (item.expenseMode || 'standard').toLowerCase();
    const isRental = (item.type || '').toLowerCase() === 'rental';
    const rate = normalizeRate(item.expenseRate ?? (isRental ? rentalStdExpenseRate : 0));
    const actual = ensureNumber(item.expenseAmount);
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
        const toComp = taxableItem - sepAmount;
        if (toComp > 0) {
          rentalSeparateExcess += toComp;
          taxable += toComp;
          warnings.push('임대 분리과세 한도 초과분은 종합과세로 전환됩니다.');
        }
        rentalSeparateUsed += sepAmount;
      }
      separateTax += sepAmount * sepRate;
    } else taxable += taxableItem;
    prepaid += ensureNumber(item.prepaidTax);
  }

  return {
    gross: grossSum,
    deductions: expenseSum,
    taxable: taxable,
    separateTax,
    prepaid,
    rentalSeparateUsed,
    rentalSeparateExcess,
    warnings,
  };
};

const allocateFinancialThreshold = (financialIncomes = [], threshold) => {
  let remaining = threshold;
  const allocations = [];
  for (const item of financialIncomes) {
    const amount = ensureNumber(item.amount);
    const take = Math.max(Math.min(remaining, amount), 0);
    const excess = Math.max(amount - take, 0);
    remaining -= take;
    allocations.push({ ...item, amount, thresholdPortion: take, excessPortion: excess });
  }
  return allocations;
};

const calculateFinancial = (input = {}) => {
  const warnings = [];
  const rules = {
    financialThreshold: input.settings?.financialThreshold ?? 20_000_000,
    grossUpRate: input.settings?.grossUpRate ?? 0.1,
    localRate: 0.1,
    rentalSeparateThreshold: input.settings?.rentalSeparateThreshold ?? 20_000_000,
    rentalSeparateRate: input.settings?.rentalSeparateRate ?? 0.14,
    rentalStandardExpenseRate: input.settings?.rentalStandardExpenseRate ?? 0.5,
    progressiveRates:
      input.settings?.progressiveRates ??
      [
        { threshold: 14_000_000, rate: 0.06, deduction: 0 },
        { threshold: 50_000_000, rate: 0.15, deduction: 1_260_000 },
        { threshold: 88_000_000, rate: 0.24, deduction: 5_760_000 },
        { threshold: 150_000_000, rate: 0.35, deduction: 15_440_000 },
        { threshold: 300_000_000, rate: 0.38, deduction: 19_940_000 },
        { threshold: 500_000_000, rate: 0.4, deduction: 25_940_000 },
        { threshold: 1_000_000_000, rate: 0.42, deduction: 35_940_000 },
        { threshold: null, rate: 0.45, deduction: 65_940_000 },
      ],
    rounding: {
      tax: input.settings?.rounding?.tax ?? 1,
      payable: input.settings?.rounding?.payable ?? 10,
    },
  };

  const financialIncomes = Array.isArray(input.financialIncomes) ? input.financialIncomes : [];
  const otherIncomeResult = computeOtherIncome(input.otherIncome, rules);
  warnings.push(...otherIncomeResult.warnings);
  const otherTaxableBase = otherIncomeResult.taxable;

  const withAlloc = allocateFinancialThreshold(financialIncomes, rules.financialThreshold);
  const financialTotal = withAlloc.reduce((sum, f) => sum + f.amount, 0);
  const separateFinancialTax = withAlloc.reduce((sum, f) => sum + f.amount * normalizeRate(f.withholdingRate ?? 0.14), 0);
  const thresholdTax = withAlloc.reduce((sum, f) => sum + f.thresholdPortion * normalizeRate(f.withholdingRate ?? 0.14), 0);
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
      foreignTaxPaid += ensureNumber(f.prepaidTax);
      forceComprehensive = true;
    }
    prepaidWithholding += ensureNumber(f.prepaidTax ?? f.amount * rate);
  }

  const grossUpAmount = Math.floor(grossUpBase * rules.grossUpRate);
  const comprehensiveTaxableBase = Math.max(otherTaxableBase + excessFinancial + grossUpAmount, 0);
  const progComp = computeProgressiveTax(comprehensiveTaxableBase, rules.progressiveRates, rules.rounding.tax);
  const progOther = computeProgressiveTax(otherTaxableBase, rules.progressiveRates, rules.rounding.tax);

  const separateOtherTax = otherIncomeResult.separateTax;
  const methodATax = thresholdTax + progComp.tax + separateOtherTax;
  const methodBTax = separateFinancialTax + progOther.tax + separateOtherTax;

  let chosenMethod = 'separate';
  let chosenTaxBeforeCredits = methodBTax;
  let comparisonNote = '2천만원 이하 → 분리과세';
  if (financialTotal > rules.financialThreshold || forceComprehensive) {
    chosenMethod = methodATax >= methodBTax ? 'comprehensive' : 'separate';
    chosenTaxBeforeCredits = Math.max(methodATax, methodBTax);
    comparisonNote = `비교과세: 종합 ${Math.round(methodATax)} / 분리 ${Math.round(methodBTax)}`;
  }

  let dividendCredit = 0;
  if (grossUpAmount > 0 && (financialTotal > rules.financialThreshold || forceComprehensive)) {
    const financialWithholdingTax = separateFinancialTax;
    const creditLimit = Math.max(progComp.tax - (progOther.tax + financialWithholdingTax), 0);
    dividendCredit = Math.min(grossUpAmount, creditLimit);
  }

  let foreignTaxCredit = 0;
  if (foreignIncome > 0) {
    const totalIncomeForRatio = Math.max(otherIncomeResult.gross + excessFinancial, 1);
    const ratio = Math.min(foreignIncome / totalIncomeForRatio, 1);
    const creditLimit = chosenTaxBeforeCredits * ratio;
    foreignTaxCredit = Math.min(creditLimit, foreignTaxPaid);
  }

  const otherTaxCredit = ensureNumber(input.taxCredits?.other);
  const nationalTax = floorToUnit(
    Math.max(chosenTaxBeforeCredits - dividendCredit - foreignTaxCredit - otherTaxCredit, 0),
    rules.rounding.tax
  );
  const localIncomeTax = floorToUnit(nationalTax * rules.localRate, rules.rounding.tax);

  const prepaidNational = ensureNumber(input.prepaid?.national) + prepaidWithholding;
  const prepaidLocal = ensureNumber(input.prepaid?.local);
  const totalPayableRaw = nationalTax + localIncomeTax - prepaidNational - prepaidLocal - otherIncomeResult.prepaid;
  const totalPayable = floorToUnit(totalPayableRaw, rules.rounding.payable);

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
      progressiveComprehensive: progComp.tax,
      otherTaxableBase,
      progressiveOtherOnly: progOther.tax,
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

  return {
    chosenMethod,
    comparisonNote,
    financialTotal,
    thresholdUsed,
    excessFinancial,
    grossUpAmount,
    progressive: { comprehensive: progComp, otherOnly: progOther },
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
    prepaid: { prepaidNational, prepaidLocal, prepaidWithholding, prepaidOther: otherIncomeResult.prepaid },
    rental: {
      separateUsed: otherIncomeResult.rentalSeparateUsed,
      separateExcess: otherIncomeResult.rentalSeparateExcess,
      threshold: rules.rentalSeparateThreshold,
    },
    trace,
    warnings,
  };
};

const finTableBody = document.querySelector('#fin-table tbody');
const addFinancialRow = (data = {}) => {
  const tr = document.createElement('tr');
  tr.className = 'fin-row';
  tr.innerHTML = `
    <td>
      <select>
        <option value="interest">이자</option>
        <option value="dividend">배당</option>
      </select>
    </td>
    <td><input type="number" placeholder="금액"></td>
    <td><input type="number" placeholder="14 또는 0.14"></td>
    <td>
      <select>
        <option value="domestic">국내</option>
        <option value="foreign">해외</option>
      </select>
    </td>
    <td style="text-align:center;"><input type="checkbox"></td>
    <td><input type="number" placeholder="원천/외국납부세액"></td>
  `;
  const [typeSel, amt, rate, sourceSel, grossChk, prepaid] = tr.querySelectorAll('select,input');
  typeSel.value = data.type || 'interest';
  amt.value = data.amount || '';
  rate.value = data.withholdingRate ?? '';
  sourceSel.value = data.source || 'domestic';
  grossChk.checked = Boolean(data.grossUpEligible);
  prepaid.value = data.prepaidTax ?? '';
  finTableBody.appendChild(tr);
};

document.getElementById('fin-add').addEventListener('click', () => addFinancialRow());

const clearFinancialRows = () => {
  finTableBody.innerHTML = '';
};

const collectFinancialRows = () =>
  [...finTableBody.querySelectorAll('tr')].map((tr) => {
    const [typeSel, amt, rate, sourceSel, grossChk, prepaid] = tr.querySelectorAll('select,input');
    const amount = ensureNumber(amt.value);
    if (!amount) return null;
    const rateVal = ensureNumber(rate.value || 0.14);
    return {
      type: typeSel.value,
      amount,
      withholdingRate: rateVal > 1 ? rateVal / 100 : rateVal,
      source: sourceSel.value,
      grossUpEligible: grossChk.checked && typeSel.value === 'dividend',
      prepaidTax: ensureNumber(prepaid.value),
      foreignTaxPaid: sourceSel.value === 'foreign' ? ensureNumber(prepaid.value) : undefined,
    };
  }).filter(Boolean);

const runFinancial = () => {
  const payload = {
    financialIncomes: collectFinancialRows(),
    otherIncome: {
      gross: num('fin_other_gross'),
      deductions: num('fin_other_ded'),
      items: [],
    },
    taxCredits: {
      other: num('fin_other_credit'),
    },
    prepaid: {
      national: num('fin_prepaid_nat'),
      local: num('fin_prepaid_loc'),
    },
    settings: {
      financialThreshold: num('fin_threshold'),
      grossUpRate: rateFromInput('fin_grossup', 0.1),
      rounding: { tax: num('fin_round_tax') || 1, payable: num('fin_round_pay') || 10 },
    },
  };

  const result = calculateFinancial(payload);
  const cards = [
    {
      title: result.chosenMethod === 'comprehensive' ? '종합과세 선택' : '분리과세 선택',
      body: `${result.comparisonNote} · 금융소득 ${formatKRW(result.financialTotal)} / 한도 사용 ${formatKRW(result.thresholdUsed)}`,
    },
    {
      title: '산출세액',
      body: `국세 ${formatKRW(result.taxes.nationalTax)}, 지방세 ${formatKRW(result.taxes.localIncomeTax)}, 총 납부(환급) ${formatSigned(result.taxes.totalPayable)}`,
    },
    {
      title: '배당·외국납부 세액공제',
      body: `배당공제 ${formatKRW(result.taxes.dividendCredit)} · 외국납부 ${formatKRW(result.taxes.foreignTaxCredit)} · 기타 ${formatKRW(result.taxes.otherTaxCredit)}`,
    },
    {
      title: '임대 분리과세 한도',
      body: `사용 ${formatKRW(result.rental.separateUsed)} / 한도 ${formatKRW(result.rental.threshold)} · 초과 ${formatKRW(result.rental.separateExcess)}`,
    },
  ];

  renderCards(document.getElementById('fin-output'), {
    main: formatSigned(result.taxes.totalPayable),
    sub: result.warnings.length ? result.warnings.join(' · ') : '비교과세 결과',
    items: cards,
  });
  setPulse('pulse-fin', formatSigned(result.taxes.totalPayable), result.comparisonNote);
};

document.getElementById('fin-run').addEventListener('click', runFinancial);

const finSample = [
  { type: 'interest', amount: 12_000_000, withholdingRate: 0.14, source: 'domestic', grossUpEligible: false, prepaidTax: 1_680_000 },
  { type: 'dividend', amount: 18_000_000, withholdingRate: 0.14, source: 'domestic', grossUpEligible: true, prepaidTax: 2_520_000 },
  { type: 'dividend', amount: 6_000_000, withholdingRate: 0.25, source: 'foreign', grossUpEligible: false, prepaidTax: 1_500_000 },
];

document.getElementById('fin-fill').addEventListener('click', () => {
  clearFinancialRows();
  finSample.forEach((row) => addFinancialRow(row));
  document.getElementById('fin_other_gross').value = 40_000_000;
  document.getElementById('fin_other_ded').value = 10_000_000;
  document.getElementById('fin_other_credit').value = 200_000;
  document.getElementById('fin_prepaid_nat').value = 0;
  document.getElementById('fin_prepaid_loc').value = 0;
  document.getElementById('fin_threshold').value = 20_000_000;
  document.getElementById('fin_grossup').value = 0.1;
  document.getElementById('fin_round_tax').value = 1;
  document.getElementById('fin_round_pay').value = 10;
});

// 초기 테이블 행
addFinancialRow();
addFinancialRow();

// 초기 메시지
setPulse('pulse-yearend', '—', '총급여와 공제 입력 후 계산');
setPulse('pulse-corp', '—', '손익/조정 입력 후 계산');
setPulse('pulse-fin', '—', '금융소득 입력 후 계산');
