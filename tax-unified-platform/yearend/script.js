const fmt = new Intl.NumberFormat('ko-KR');

const form = document.getElementById('calc-form');
const dependentsList = document.getElementById('dependents-list');
const addDependentButton = document.getElementById('add-dependent');
const estimateRangeCard = document.getElementById('estimate-range-card');
const paystubFileInput = document.getElementById('paystub_file');
const paystubParseButton = document.getElementById('paystub_parse');
const paystubStatus = document.getElementById('paystub_status');
const shareButton = document.getElementById('share-result');
const shareOutput = document.getElementById('share-output');
const shareLink = document.getElementById('share-link');
const shareCopy = document.getElementById('share-copy');
const affiliateBanner = document.getElementById('affiliate-banner');
const affiliateSubtitle = document.querySelector('#affiliate .section-head p');
const defaultAffiliateSubtitle =
  (affiliateSubtitle && affiliateSubtitle.textContent) ||
  '입력 항목과 관심 로그를 반영해 필요한 상품을 추천합니다.';

let latestResults = null;

const pdfjsLib = window.pdfjsLib || window['pdfjsLib'];
const pdfWorkerSrc = 'assets/vendor/pdf.worker.min.js';
if (pdfjsLib?.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
}

const numberValue = (id) => {
  const el = document.getElementById(id);
  if (!el) return 0;
  const num = parseFloat(el.value);
  return Number.isFinite(num) ? num : 0;
};

const isChecked = (id) => {
  const el = document.getElementById(id);
  return el ? el.checked : false;
};

const getSelectValue = (id) => {
  const el = document.getElementById(id);
  return el ? el.value : '';
};

const formatWon = (value) => `${fmt.format(Math.round(value))}원`;
const formatSignedWon = (value) => {
  const sign = value < 0 ? '-' : '';
  return `${sign}${formatWon(Math.abs(value))}`;
};

const floor10 = (value) => Math.floor(value / 10) * 10;
const rate100Over110 = 100 / 110;

const calcCardTargets = (gross) => {
  if (!Number.isFinite(gross) || gross <= 0) {
    return {
      threshold: 0,
      baseTarget: 0,
      baseTargetCredit: 0,
      maxTarget: 0,
    };
  }

  const threshold = gross * 0.25;
  const baseCap = gross <= 70_000_000 ? 3_000_000 : 2_500_000;
  const extraCap = gross <= 70_000_000 ? 3_000_000 : 2_000_000;

  const baseTarget = threshold + baseCap / 0.3;
  const baseTargetCredit = threshold + baseCap / 0.15;
  const maxTarget = threshold + (baseCap + extraCap) / 0.4;

  return {
    threshold,
    baseTarget,
    baseTargetCredit,
    maxTarget,
  };
};

const earnedIncomeDeduction = (gross) => {
  if (gross <= 5_000_000) return gross * 0.7;
  if (gross <= 15_000_000) return 3_500_000 + (gross - 5_000_000) * 0.4;
  if (gross <= 45_000_000) return 7_500_000 + (gross - 15_000_000) * 0.15;
  if (gross <= 100_000_000) return 12_000_000 + (gross - 45_000_000) * 0.05;
  const deduction = 14_750_000 + (gross - 100_000_000) * 0.02;
  return Math.min(deduction, 20_000_000);
};

const progressiveTax = (taxable) => {
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

const isActiveDependent = (dependent) =>
  dependent.age !== null || dependent.income !== null || dependent.disabled;

const isEligibleDependent = (dependent) => {
  const income = dependent.income ?? 0;
  const incomeOk = income <= 1_000_000;
  if (!incomeOk) return false;

  if (dependent.disabled) return true;

  if (dependent.relation === 'spouse') return true;
  if (dependent.relation === 'parent' || dependent.relation === 'grandparent') {
    return dependent.age !== null && dependent.age >= 60;
  }
  if (dependent.relation === 'child' || dependent.relation === 'grandchild') {
    return dependent.age !== null && dependent.age <= 20;
  }
  if (dependent.relation === 'sibling') {
    return dependent.age !== null && (dependent.age <= 20 || dependent.age >= 60);
  }
  return true;
};

const isChildForTaxCredit = (dependent) => {
  const income = dependent.income ?? 0;
  const isChildRelation = dependent.relation === 'child' || dependent.relation === 'grandchild';
  return (
    isChildRelation &&
    dependent.age !== null &&
    dependent.age >= 8 &&
    dependent.age <= 20 &&
    income <= 1_000_000
  );
};

const getDependents = () =>
  Array.from(document.querySelectorAll('.dependent-row')).map((row) => {
    const ageValue = row.querySelector('[data-field="age"]').value.trim();
    const incomeValue = row.querySelector('[data-field="income"]').value.trim();
    return {
      relation: row.querySelector('[data-field="relation"]').value,
      age: ageValue === '' ? null : parseInt(ageValue, 10),
      income: incomeValue === '' ? null : parseInt(incomeValue, 10),
      disabled: row.querySelector('[data-field="disabled"]').checked,
    };
  });

const calcCardDeduction = ({
  gross,
  credit,
  debit,
  market,
  culture,
  sports,
  cultureEligible,
  previousSpend,
}) => {
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

  if (threshold <= credit) {
    thresholdDeduction = threshold * 0.15;
  } else if (threshold <= midTotal) {
    thresholdDeduction = credit * 0.15 + (threshold - credit) * 0.3;
  } else if (threshold <= allTotal) {
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
    if (increase > 0) {
      consumptionIncrease = Math.min(increase * 0.1, 1_000_000);
    }
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

const estimateFieldKeys = [
  'credit_card_spend',
  'debit_card_spend',
  'market_transport_spend',
  'culture_expenses',
  'sports_facility_fee_eligible',
  'insurance_premiums',
  'medical_expenses',
  'medical_special_expenses',
  'medical_infertility',
  'medical_premature',
  'postnatal_care',
  'medical_reimbursements',
  'education_k12',
  'education_university',
  'education_self',
  'donations_general',
  'donations_religious',
  'donations_special',
  'donations_employee_stock',
  'donations_political',
  'donations_hometown',
  'pension_contribution',
  'isa_transfer',
  'rent_paid',
  'housing_savings',
  'lease_loan_repayment',
  'mortgage_interest',
  'other_income_deduction',
  'other_tax_credit',
];

const updateOutput = (name, value, isText = false) => {
  const el = document.querySelector(`[data-output="${name}"]`);
  if (!el) return;
  el.textContent = isText ? value : formatWon(value);
};

const updateWarnings = (warnings) => {
  const el = document.getElementById('calc-warnings');
  if (!el) return;
  if (!warnings.length) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = `<strong>안내 사항</strong><ul class="list">${warnings
    .map((item) => `<li>${item}</li>`)
    .join('')}</ul>`;
};

const clearShareOutput = () => {
  if (!shareOutput || !shareLink) return;
  shareOutput.classList.remove('active');
  shareLink.value = '';
};

const setShareOutput = (url) => {
  if (!shareOutput || !shareLink) return;
  shareLink.value = url;
  shareOutput.classList.add('active');
};

const formatShareLabel = (amount, isRefund) =>
  `${isRefund ? '예상 환급액' : '추가 납부액'} ${formatWon(amount)}`;

const pickInterestCategory = (data) => {
  const scores = [
    {
      key: 'card',
      score:
        data.credit_card_spend +
        data.debit_card_spend +
        data.market_transport_spend +
        data.culture_expenses +
        data.sports_facility_fee_eligible,
    },
    { key: 'insurance', score: data.insurance_premiums },
    {
      key: 'health',
      score:
        data.medical_expenses +
        data.medical_special_expenses +
        data.medical_infertility +
        data.medical_premature +
        data.postnatal_care,
    },
    {
      key: 'education',
      score: data.education_k12 + data.education_university + data.education_self,
    },
    {
      key: 'housing',
      score:
        data.housing_savings +
        data.lease_loan_repayment +
        data.mortgage_interest +
        data.rent_paid,
    },
    { key: 'pension', score: data.pension_contribution + data.isa_transfer },
    {
      key: 'donation',
      score:
        data.donations_general +
        data.donations_religious +
        data.donations_special +
        data.donations_employee_stock +
        data.donations_political +
        data.donations_hometown,
    },
  ];
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  if (!top || top.score <= 0) return 'finance';
  return top.key;
};

const recordInterest = async (category) => {
  if (!category) return;
  const storageKey = 'interest_sent';
  let sent = [];
  try {
    sent = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
  } catch (error) {
    sent = [];
  }
  if (sent.includes(category)) return;

  try {
    await fetch('/api/ad-interest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category }),
    });
    sent.push(category);
    sessionStorage.setItem(storageKey, JSON.stringify(sent));
  } catch (error) {
    // Ignore interest logging failures.
  }
};

const updateAffiliateSubtitle = (meta) => {
  if (!affiliateSubtitle) return;
  const tagline = meta?.tagline || (meta?.title ? `이번주 테마 · ${meta.title}` : '');
  affiliateSubtitle.textContent = tagline || defaultAffiliateSubtitle;
};

const renderAffiliateBanner = (items, meta = {}) => {
  if (!affiliateBanner) return;
  affiliateBanner.innerHTML = '';
  updateAffiliateSubtitle(meta);
  if (!items || !items.length) {
    affiliateBanner.innerHTML = '<div class="mini">추천 상품을 불러오지 못했습니다.</div>';
    return;
  }
  items.forEach((item) => {
    const card = document.createElement('a');
    card.className = 'ad-card';
    card.href = item.link;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';

    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.title;
    card.appendChild(img);

    const info = document.createElement('div');
    info.className = 'ad-info';

    const tags = document.createElement('div');
    tags.className = 'ad-tags';
    const badgeLabel = item.badge || meta.title;
    if (badgeLabel) {
      const badge = document.createElement('span');
      badge.className = 'ad-badge';
      badge.textContent = badgeLabel;
      tags.appendChild(badge);
    }
    if (item.discountRate) {
      const discount = document.createElement('span');
      discount.className = 'ad-pill';
      discount.textContent = `${item.discountRate}%↓`;
      tags.appendChild(discount);
    }
    if (item.shippingTag) {
      const ship = document.createElement('span');
      ship.className = 'ad-pill soft';
      ship.textContent = item.shippingTag;
      tags.appendChild(ship);
    }
    if (tags.children.length) {
      info.appendChild(tags);
    }

    const title = document.createElement('div');
    title.className = 'ad-title';
    title.textContent = item.title;
    info.appendChild(title);

    if (item.price) {
      const price = document.createElement('div');
      price.className = 'ad-price';
      price.textContent = item.price;
      info.appendChild(price);
    }

    if (item.meta) {
      const metaEl = document.createElement('div');
      metaEl.className = 'ad-meta';
      metaEl.textContent = item.meta;
      info.appendChild(metaEl);
    }

    const cta = document.createElement('div');
    cta.className = 'ad-cta';
    cta.textContent = item.cta || meta.cta || '바로 보기';
    info.appendChild(cta);

    card.appendChild(info);
    affiliateBanner.appendChild(card);
  });
};

const loadAffiliateBanner = async () => {
  if (!affiliateBanner) return;
  try {
    const response = await fetch('/api/coupang-banner');
    if (!response.ok) throw new Error('invalid response');
    const payload = await response.json();
    renderAffiliateBanner(payload.items || [], payload.theme || {});
  } catch (error) {
    renderAffiliateBanner([], {});
  }
};

const handleShare = async () => {
  if (!latestResults) return;
  const amount = Math.round(Math.abs(latestResults.refundAmount || 0));
  const isRefund = (latestResults.refundAmount || 0) >= 0;
  const label = formatShareLabel(amount, isRefund);

  try {
    if (shareButton) shareButton.disabled = true;
    const response = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        direction: isRefund ? 'refund' : 'payment',
        label,
      }),
    });
    if (!response.ok) {
      throw new Error('공유 링크 생성에 실패했습니다.');
    }
    const data = await response.json();
    if (!data?.url) throw new Error('공유 링크가 반환되지 않았습니다.');
    setShareOutput(data.url);
  } catch (error) {
    const message = error.message || '공유 링크 생성 실패';
    if (shareLink) shareLink.value = message;
    if (shareOutput) shareOutput.classList.add('active');
  } finally {
    if (shareButton) shareButton.disabled = false;
  }
};

const handleShareCopy = async () => {
  if (!shareLink || !shareLink.value) return;
  try {
    await navigator.clipboard.writeText(shareLink.value);
  } catch (error) {
    shareLink.select();
    document.execCommand('copy');
  }
};

const updateInputSummary = (data, estimateConfig) => {
  const el = document.getElementById('input-summary');
  if (!el) return;

  const sections = [];
  const addSection = (title, items) => {
    if (!items.length) return;
    sections.push(
      `<div><strong>${title}</strong><ul class="list">${items
        .map((item) => `<li>${item}</li>`)
        .join('')}</ul></div>`
    );
  };

  const addAmount = (items, label, value, includeZero = false) => {
    if (!Number.isFinite(value)) return;
    if (!includeZero && value <= 0) return;
    items.push(`${label}: ${formatWon(value)}`);
  };

  const addCount = (items, label, value) => {
    if (!Number.isFinite(value) || value <= 0) return;
    items.push(`${label}: ${value}명`);
  };

  if (estimateConfig?.enabled) {
    const estimateItems = ['추정 모드: 켜짐'];
    if (estimateConfig.ytd) {
      const month = estimateConfig.month;
      estimateItems.push(
        month >= 1 && month <= 12 ? `누적액 환산: ${month}월 기준` : '누적액 환산: 기준월 없음'
      );
    }
    if (estimateConfig.prev_year) {
      estimateItems.push(`전년도 증감율: ${estimateConfig.prev_rate || 0}%`);
    }
    if (estimateConfig.range) {
      estimateItems.push(`환급 범위: ±${estimateConfig.range_percent || 0}%`);
    }
    addSection('추정 모드', estimateItems);
  }

  const baseItems = [];
  const useAnnual = data.use_annual_salary && data.annual_salary > 0;
  const grossUsed = useAnnual
    ? Math.max(0, data.annual_salary - data.nontaxable_salary)
    : data.gross_salary;
  baseItems.push(`총급여 계산: ${useAnnual ? '연봉 기준' : '직접 입력'}`);
  if (useAnnual) {
    addAmount(baseItems, '연봉', data.annual_salary, true);
    addAmount(baseItems, '비과세', data.nontaxable_salary, true);
  }
  addAmount(baseItems, '총급여', grossUsed, true);
  if (!useAnnual && (data.annual_salary > 0 || data.nontaxable_salary > 0)) {
    addAmount(baseItems, '연봉(미적용)', data.annual_salary, true);
    addAmount(baseItems, '비과세(미적용)', data.nontaxable_salary, true);
  }
  addAmount(baseItems, '기납부 소득세', data.withheld_income_tax, true);
  const withheldLocal = data.withheld_local_provided
    ? data.withheld_local_tax
    : data.withheld_income_tax * 0.1;
  const localLabel = data.withheld_local_provided
    ? '기납부 지방소득세'
    : '기납부 지방소득세(추정 10%)';
  addAmount(baseItems, localLabel, withheldLocal, true);
  addAmount(baseItems, '4대 보험 근로자 부담분', data.social_insurance, true);
  addSection('기본 입력', baseItems);

  const dependents = Array.isArray(data.dependents) ? data.dependents : [];
  const activeDependents = dependents.filter(isActiveDependent);
  const eligibleDependents = activeDependents.filter(isEligibleDependent);
  const dependentItems = [
    `입력 ${activeDependents.length}명 / 기본공제 대상 ${eligibleDependents.length}명`,
  ];
  const relationLabels = {
    spouse: '배우자',
    child: '자녀',
    grandchild: '손자녀',
    parent: '부모',
    grandparent: '조부모',
    sibling: '형제자매',
    other: '기타',
  };
  activeDependents.forEach((dep) => {
    const relationLabel = relationLabels[dep.relation] || '부양가족';
    const parts = [];
    if (dep.age !== null) parts.push(`${dep.age}세`);
    if (dep.income !== null) parts.push(`소득 ${formatWon(dep.income)}`);
    if (dep.disabled) parts.push('장애인');
    const detail = parts.length ? parts.join(', ') : '조건 미입력';
    const eligible = isEligibleDependent(dep) ? '기본공제' : '비대상';
    dependentItems.push(`${relationLabel}: ${detail} (${eligible})`);
  });
  addSection('부양가족', dependentItems);

  const optionalItems = [];
  const optionalFields = [
    { key: 'credit_card_spend', label: '신용카드 사용액' },
    { key: 'debit_card_spend', label: '체크카드·현금영수증' },
    { key: 'market_transport_spend', label: '전통시장·대중교통' },
    { key: 'culture_expenses', label: '문화비 지출액' },
    { key: 'sports_facility_fee_eligible', label: '체육시설 공제 인정액' },
    { key: 'previous_card_spend', label: '전년도 카드 사용액' },
    { key: 'housing_savings', label: '주택청약저축 납입액' },
    { key: 'lease_loan_repayment', label: '주택임차차입금 상환액' },
    { key: 'mortgage_interest', label: '주택담보대출 이자' },
    { key: 'other_income_deduction', label: '기타 소득공제' },
    { key: 'pension_contribution', label: '연금저축·IRP 납입액' },
    { key: 'isa_transfer', label: 'ISA 전환액' },
    { key: 'insurance_premiums', label: '보장성 보험료' },
    { key: 'medical_expenses', label: '의료비(일반)' },
    { key: 'medical_special_expenses', label: '의료비(특례)' },
    { key: 'medical_infertility', label: '난임시술비' },
    { key: 'medical_premature', label: '미숙아·선천성 이상아 의료비' },
    { key: 'postnatal_care', label: '산후조리원비' },
    { key: 'medical_reimbursements', label: '실손보험금 수령액' },
    { key: 'education_k12', label: '교육비(유치원·초중고)' },
    { key: 'education_university', label: '교육비(대학생)' },
    { key: 'education_self', label: '교육비(본인 대학원)' },
    { key: 'donations_general', label: '기부금(일반)' },
    { key: 'donations_religious', label: '기부금(종교)' },
    { key: 'donations_special', label: '기부금(특례)' },
    { key: 'donations_employee_stock', label: '기부금(우리사주)' },
    { key: 'donations_political', label: '정치자금 기부금' },
    { key: 'donations_hometown', label: '고향사랑기부금' },
    { key: 'rent_paid', label: '월세 납입액' },
    { key: 'other_tax_credit', label: '기타 세액공제' },
  ];
  optionalFields.forEach(({ key, label }) => addAmount(optionalItems, label, data[key]));
  addCount(optionalItems, '출산·입양(첫째)', data.birth_first);
  addCount(optionalItems, '출산·입양(둘째)', data.birth_second);
  addCount(optionalItems, '출산·입양(셋째 이상)', data.birth_third);
  if (optionalItems.length) {
    addSection('추가 입력 (0 제외)', optionalItems);
  }

  const flagItems = [];
  const addFlag = (label, value, shouldShow = value) => {
    if (!shouldShow) return;
    flagItems.push(`${label}: ${value ? '예' : '아니오'}`);
  };
  if (data.self_disabled) flagItems.push('본인 장애인');
  if (data.single_parent) flagItems.push('한부모');
  if (data.female_head) flagItems.push('부녀자');
  if (data.marriage_credit) flagItems.push('결혼세액공제 적용');
  if (data.use_standard_credit) flagItems.push('표준세액공제 적용');
  addFlag(
    '문화비·체육시설 공제 대상',
    data.culture_eligible,
    data.culture_eligible ||
      data.culture_expenses > 0 ||
      data.sports_facility_fee_eligible > 0
  );
  addFlag(
    '주택청약저축 공제 요건',
    data.housing_savings_eligible,
    data.housing_savings_eligible || data.housing_savings > 0
  );
  addFlag(
    '주택임차차입금 공제 요건',
    data.lease_loan_eligible,
    data.lease_loan_eligible || data.lease_loan_repayment > 0
  );
  addFlag(
    '주택대출 공제 요건',
    data.mortgage_eligible,
    data.mortgage_eligible || data.mortgage_interest > 0
  );
  if (data.mortgage_interest > 0 || data.mortgage_eligible) {
    addAmount(flagItems, '주택대출 공제 한도', data.mortgage_limit, true);
  }
  addFlag(
    'IRP 포함(연 900만 한도)',
    data.pension_with_irp,
    data.pension_contribution > 0 || data.isa_transfer > 0
  );
  addFlag(
    '장애인전용 보험료',
    data.insurance_disabled,
    data.insurance_disabled || data.insurance_premiums > 0
  );
  addFlag(
    '고향사랑기부금(특별재난)',
    data.donations_hometown_disaster,
    data.donations_hometown_disaster || data.donations_hometown > 0
  );
  addFlag('월세 공제 요건', data.rent_eligible, data.rent_eligible || data.rent_paid > 0);
  if (flagItems.length) {
    addSection('적용 체크', flagItems);
  }

  if (!sections.length) {
    el.textContent = '입력된 값이 없습니다.';
    return;
  }
  el.innerHTML = sections.join('');
};

const setInputValue = (id, value) => {
  const el = document.getElementById(id);
  if (!el || value === null || value === undefined || Number.isNaN(value)) return;
  el.value = Math.round(value);
};

const collectFormData = () => {
  const withheldLocalInput = document.getElementById('withheld_local_tax');
  return {
    annual_salary: numberValue('annual_salary'),
    nontaxable_salary: numberValue('nontaxable_salary'),
    gross_salary: numberValue('gross_salary'),
    use_annual_salary: isChecked('use_annual_salary'),
    withheld_income_tax: numberValue('withheld_income_tax'),
    withheld_local_tax: numberValue('withheld_local_tax'),
    withheld_local_provided: withheldLocalInput ? withheldLocalInput.value !== '' : false,
    dependents: getDependents(),
    self_disabled: isChecked('self_disabled'),
    female_head: isChecked('female_head'),
    single_parent: isChecked('single_parent'),
    marriage_credit: isChecked('marriage_credit'),
    birth_first: numberValue('birth_first'),
    birth_second: numberValue('birth_second'),
    birth_third: numberValue('birth_third'),
    social_insurance: numberValue('social_insurance'),
    credit_card_spend: numberValue('credit_card_spend'),
    debit_card_spend: numberValue('debit_card_spend'),
    market_transport_spend: numberValue('market_transport_spend'),
    culture_expenses: numberValue('culture_expenses'),
    sports_facility_fee_eligible: numberValue('sports_facility_fee_eligible'),
    culture_eligible: isChecked('culture_eligible'),
    previous_card_spend: numberValue('previous_card_spend'),
    housing_savings: numberValue('housing_savings'),
    housing_savings_eligible: isChecked('housing_savings_eligible'),
    lease_loan_repayment: numberValue('lease_loan_repayment'),
    lease_loan_eligible: isChecked('lease_loan_eligible'),
    mortgage_interest: numberValue('mortgage_interest'),
    mortgage_limit: parseInt(getSelectValue('mortgage_limit'), 10) || 0,
    mortgage_eligible: isChecked('mortgage_eligible'),
    other_income_deduction: numberValue('other_income_deduction'),
    pension_contribution: numberValue('pension_contribution'),
    isa_transfer: numberValue('isa_transfer'),
    pension_with_irp: isChecked('pension_with_irp'),
    insurance_premiums: numberValue('insurance_premiums'),
    insurance_disabled: isChecked('insurance_disabled'),
    medical_expenses: numberValue('medical_expenses'),
    medical_special_expenses: numberValue('medical_special_expenses'),
    medical_infertility: numberValue('medical_infertility'),
    medical_premature: numberValue('medical_premature'),
    postnatal_care: numberValue('postnatal_care'),
    medical_reimbursements: numberValue('medical_reimbursements'),
    education_k12: numberValue('education_k12'),
    education_university: numberValue('education_university'),
    education_self: numberValue('education_self'),
    donations_general: numberValue('donations_general'),
    donations_religious: numberValue('donations_religious'),
    donations_special: numberValue('donations_special'),
    donations_employee_stock: numberValue('donations_employee_stock'),
    donations_political: numberValue('donations_political'),
    donations_hometown: numberValue('donations_hometown'),
    donations_hometown_disaster: isChecked('donations_hometown_disaster'),
    rent_paid: numberValue('rent_paid'),
    rent_eligible: isChecked('rent_eligible'),
    use_standard_credit: isChecked('use_standard_credit'),
    other_tax_credit: numberValue('other_tax_credit'),
  };
};

const collectEstimateConfig = () => ({
  enabled: isChecked('estimate_mode'),
  ytd: isChecked('estimate_ytd'),
  month: numberValue('estimate_month'),
  prev_year: isChecked('estimate_prev_year'),
  prev_rate: numberValue('estimate_prev_rate'),
  range: isChecked('estimate_range'),
  range_percent: numberValue('estimate_range_percent'),
});

const cloneData = (data) => ({
  ...data,
  dependents: Array.isArray(data.dependents) ? data.dependents.map((d) => ({ ...d })) : [],
});

const applyFactorToFields = (data, factor, keys) => {
  keys.forEach((key) => {
    if (!Number.isFinite(data[key])) return;
    data[key] = Math.max(0, data[key] * factor);
  });
};

const buildAdjustedData = (baseData, estimateConfig, rangeFactor = 1) => {
  if (!estimateConfig.enabled) {
    return cloneData(baseData);
  }
  const data = cloneData(baseData);
  let factor = 1;

  if (estimateConfig.ytd) {
    const month = estimateConfig.month;
    if (month >= 1 && month <= 12) {
      factor *= 12 / month;
    }
  }

  if (estimateConfig.prev_year) {
    factor *= 1 + estimateConfig.prev_rate / 100;
  }

  factor *= rangeFactor;
  applyFactorToFields(data, factor, estimateFieldKeys);
  return data;
};

const buildEstimateWarnings = (estimateConfig) => {
  if (!estimateConfig.enabled) return [];
  const warnings = [
    '추정 모드: 카드·보험·의료·교육·기부·연금·월세 등 지출 항목만 환산/증감 적용됩니다.',
  ];

  if (estimateConfig.ytd) {
    const month = estimateConfig.month;
    if (month >= 1 && month <= 12) {
      warnings.push(`누적액 환산: 기준월 ${month}월 기준으로 연간 환산했습니다.`);
    } else {
      warnings.push('누적액 환산을 선택했지만 기준월이 없어 환산이 적용되지 않았습니다.');
    }
  }

  if (estimateConfig.prev_year) {
    warnings.push(`전년도 추정: 증감율 ${estimateConfig.prev_rate || 0}%를 적용했습니다.`);
  }

  if (estimateConfig.range) {
    warnings.push(`환급 범위는 입력값 ±${estimateConfig.range_percent || 0}% 변동을 가정합니다.`);
  }

  return warnings;
};

const computeResults = (data) => {
  const annualSalary = data.annual_salary;
  const nontaxableSalary = data.nontaxable_salary;
  const useAnnualSalary = data.use_annual_salary;
  let gross = data.gross_salary;
  if (useAnnualSalary && annualSalary > 0) {
    gross = Math.max(0, annualSalary - nontaxableSalary);
  }
  const withheldIncome = data.withheld_income_tax;
  const withheldLocalProvided = data.withheld_local_provided;
  const withheldLocal = withheldLocalProvided ? data.withheld_local_tax : withheldIncome * 0.1;

  const dependents = data.dependents || [];
  const activeDependents = dependents.filter(isActiveDependent);
  const eligibleDependents = activeDependents.filter(isEligibleDependent);
  const eligibleCount = eligibleDependents.length;
  const childCount = activeDependents.filter(isChildForTaxCredit).length;
  const eligibleChildDependents = eligibleDependents.filter(
    (d) => d.relation === 'child' || d.relation === 'grandchild'
  ).length;

  const baseDeduction = 1_500_000 * (1 + eligibleCount);
  const elderlyDeduction = eligibleDependents.filter((d) => d.age >= 70).length * 1_000_000;
  const disabledCount =
    (data.self_disabled ? 1 : 0) + eligibleDependents.filter((d) => d.disabled).length;
  const disabledDeduction = disabledCount * 2_000_000;
  const singleParentDeduction = data.single_parent && eligibleChildDependents > 0 ? 1_000_000 : 0;
  const femaleHeadDeduction =
    !data.single_parent && data.female_head && eligibleCount > 0 ? 500_000 : 0;
  const additionalDeduction =
    elderlyDeduction + disabledDeduction + femaleHeadDeduction + singleParentDeduction;

  const earnedDeduction = earnedIncomeDeduction(gross);
  const earnedIncome = Math.max(0, gross - earnedDeduction);

  const socialInsurance = data.social_insurance;
  const creditSpend = data.credit_card_spend;
  const debitSpend = data.debit_card_spend;
  const marketSpend = data.market_transport_spend;
  const cultureSpend = data.culture_expenses;
  const sportsEligible = data.sports_facility_fee_eligible;
  const previousCardSpend = data.previous_card_spend;
  const cultureEligible = data.culture_eligible && gross <= 70_000_000;

  const card = calcCardDeduction({
    gross,
    credit: creditSpend,
    debit: debitSpend,
    market: marketSpend,
    culture: cultureSpend,
    sports: sportsEligible,
    cultureEligible,
    previousSpend: previousCardSpend,
  });

  const cardTargets = calcCardTargets(gross);
  const currentCardTotal = creditSpend + debitSpend + marketSpend + cultureSpend + sportsEligible;
  const additionalNeeded = Math.max(0, cardTargets.maxTarget - currentCardTotal);

  const housingSavings = data.housing_savings;
  const housingSavingsEligible = data.housing_savings_eligible && gross <= 70_000_000;
  const housingSavingsRaw = housingSavingsEligible
    ? Math.min(housingSavings, 3_000_000) * 0.4
    : 0;
  const leaseLoanRepayment = data.lease_loan_repayment;
  const leaseLoanEligible = data.lease_loan_eligible;
  const leaseLoanRaw = leaseLoanEligible ? leaseLoanRepayment * 0.4 : 0;
  const housingCombinedLimit = 4_000_000;
  const housingCombinedDeduction = Math.min(housingSavingsRaw + leaseLoanRaw, housingCombinedLimit);
  const housingSavingsDeduction = Math.min(housingSavingsRaw, housingCombinedDeduction);
  const leaseLoanDeduction = Math.min(
    leaseLoanRaw,
    Math.max(0, housingCombinedDeduction - housingSavingsDeduction)
  );

  const mortgageInterest = data.mortgage_interest;
  const mortgageEligible = data.mortgage_eligible;
  const mortgageLimit = data.mortgage_limit;
  const mortgageDeduction = mortgageEligible ? Math.min(mortgageInterest, mortgageLimit) : 0;

  const otherIncomeDeduction = data.other_income_deduction;

  const incomeDeductionTotal =
    baseDeduction +
    additionalDeduction +
    socialInsurance +
    card.deduction +
    housingSavingsDeduction +
    leaseLoanDeduction +
    mortgageDeduction +
    otherIncomeDeduction;

  const taxableIncome = Math.max(0, earnedIncome - incomeDeductionTotal);
  const calculatedTax = Math.max(0, progressiveTax(taxableIncome));

  let earnedIncomeTaxCredit = Math.min(calculatedTax * 0.55, 1_300_000);
  if (calculatedTax > 1_300_000) {
    earnedIncomeTaxCredit = Math.min(
      earnedIncomeTaxCredit,
      715_000 + (calculatedTax - 1_300_000) * 0.3
    );
  }

  const earnedCreditCap =
    gross <= 33_000_000 ? 740_000 : gross <= 70_000_000 ? 660_000 : gross <= 120_000_000 ? 500_000 : 200_000;
  earnedIncomeTaxCredit = Math.min(earnedIncomeTaxCredit, earnedCreditCap);

  let childTaxCredit = 0;
  if (childCount === 1) childTaxCredit = 250_000;
  else if (childCount === 2) childTaxCredit = 550_000;
  else if (childCount >= 3) childTaxCredit = 550_000 + (childCount - 2) * 400_000;

  const birthCredit =
    data.birth_first * 300_000 +
    data.birth_second * 500_000 +
    data.birth_third * 700_000;

  const marriageTaxCredit = data.marriage_credit ? 500_000 : 0;

  const pensionContribution = data.pension_contribution;
  const isaTransfer = data.isa_transfer;
  const pensionLimit = data.pension_with_irp ? 9_000_000 : 6_000_000;
  const pensionEligible = Math.min(pensionContribution, pensionLimit) + Math.min(isaTransfer * 0.1, 3_000_000);
  const pensionRate = gross <= 55_000_000 ? 0.15 : 0.12;
  const pensionTaxCredit = pensionEligible * pensionRate;

  const insurancePremium = data.insurance_premiums;
  const insuranceRate = data.insurance_disabled ? 0.15 : 0.12;
  const insuranceTaxCredit = Math.min(insurancePremium, 1_000_000) * insuranceRate;

  const medicalGeneral = data.medical_expenses;
  const medicalSpecial = data.medical_special_expenses;
  const medicalInfertility = data.medical_infertility;
  const medicalPremature = data.medical_premature;
  const postnatalCare = Math.min(data.postnatal_care, 2_000_000);
  const medicalReimbursements = data.medical_reimbursements;

  let generalTotal = medicalGeneral + postnatalCare;
  let specialTotal = medicalSpecial;
  let infertilityTotal = medicalInfertility;
  let prematureTotal = medicalPremature;

  const medicalTotal = generalTotal + specialTotal + infertilityTotal + prematureTotal;
  if (medicalReimbursements > 0 && medicalTotal > 0) {
    const ratio = Math.min(1, medicalReimbursements / medicalTotal);
    generalTotal -= generalTotal * ratio;
    specialTotal -= specialTotal * ratio;
    infertilityTotal -= infertilityTotal * ratio;
    prematureTotal -= prematureTotal * ratio;
  }

  generalTotal = Math.max(0, generalTotal);
  specialTotal = Math.max(0, specialTotal);
  infertilityTotal = Math.max(0, infertilityTotal);
  prematureTotal = Math.max(0, prematureTotal);

  const medicalThreshold = gross * 0.03;
  let remainingThreshold = medicalThreshold;
  const generalUsed = Math.min(remainingThreshold, generalTotal);
  remainingThreshold -= generalUsed;
  const specialUsed = Math.min(remainingThreshold, specialTotal);
  remainingThreshold -= specialUsed;
  const prematureUsed = Math.min(remainingThreshold, prematureTotal);
  remainingThreshold -= prematureUsed;
  const infertilityUsed = Math.min(remainingThreshold, infertilityTotal);

  const generalEligible = Math.min(Math.max(0, generalTotal - generalUsed), 7_000_000);
  const specialEligible = Math.max(0, specialTotal - specialUsed);
  const prematureEligible = Math.max(0, prematureTotal - prematureUsed);
  const infertilityEligible = Math.max(0, infertilityTotal - infertilityUsed);

  const medicalTaxCredit =
    (generalEligible + specialEligible) * 0.15 +
    prematureEligible * 0.2 +
    infertilityEligible * 0.3;

  const educationK12 = Math.min(data.education_k12, 3_000_000);
  const educationUniversity = Math.min(data.education_university, 9_000_000);
  const educationSelf = data.education_self;
  const educationTaxCredit = (educationK12 + educationUniversity + educationSelf) * 0.15;

  const donationsGeneral = data.donations_general;
  const donationsReligious = data.donations_religious;
  const donationsSpecial = data.donations_special;
  const donationsEmployeeStock = data.donations_employee_stock;

  const donationsPolitical = data.donations_political;
  const politicalEligible = Math.min(donationsPolitical, earnedIncome);
  const politicalFirst = Math.min(politicalEligible, 100_000) * rate100Over110;
  const politicalRemaining = Math.max(0, politicalEligible - 100_000);
  const politicalSecond = Math.min(politicalRemaining, 30_000_000) * 0.15;
  const politicalThird = Math.max(0, politicalRemaining - 30_000_000) * 0.25;
  const donationsPoliticalCredit = politicalFirst + politicalSecond + politicalThird;

  const donationsHometown = data.donations_hometown;
  const remainingAfterPolitical = Math.max(0, earnedIncome - politicalEligible);
  const hometownLimit = Math.min(20_000_000, remainingAfterPolitical);
  const hometownEligible = Math.min(donationsHometown, hometownLimit);
  const hometownFirst = Math.min(hometownEligible, 100_000) * rate100Over110;
  const hometownRemaining = Math.max(0, hometownEligible - 100_000);
  const hometownRate = data.donations_hometown_disaster ? 0.3 : 0.15;
  const donationsHometownCredit = hometownFirst + hometownRemaining * hometownRate;

  const remainingAfterHometown = Math.max(0, remainingAfterPolitical - hometownEligible);
  const donationSpecialEligible = Math.min(donationsSpecial, remainingAfterHometown);
  const remainingAfterSpecial = Math.max(0, remainingAfterHometown - donationSpecialEligible);
  const employeeLimit = remainingAfterSpecial * 0.3;
  const donationEmployeeEligible = Math.min(donationsEmployeeStock, employeeLimit);
  const remainingAfterEmployee = Math.max(0, remainingAfterSpecial - donationEmployeeEligible);

  let generalLimit = 0;
  let religiousLimit = 0;
  if (donationsReligious > 0) {
    religiousLimit = remainingAfterEmployee * 0.1;
    generalLimit = remainingAfterEmployee * 0.2;
  } else {
    generalLimit = remainingAfterEmployee * 0.3;
  }

  const donationGeneralEligible = Math.min(donationsGeneral, generalLimit);
  const donationReligiousEligible = Math.min(donationsReligious, religiousLimit);
  const donationsOtherEligible =
    donationSpecialEligible +
    donationEmployeeEligible +
    donationGeneralEligible +
    donationReligiousEligible;
  const donationsOtherCredit =
    Math.min(donationsOtherEligible, 10_000_000) * 0.15 +
    Math.max(0, donationsOtherEligible - 10_000_000) * 0.3;
  const donationsEmployeeCredit =
    Math.min(donationEmployeeEligible, 10_000_000) * 0.15 +
    Math.max(0, donationEmployeeEligible - 10_000_000) * 0.3;

  const rentPaid = Math.min(data.rent_paid, 10_000_000);
  const rentEligible = data.rent_eligible && gross <= 80_000_000;
  const rentRate = gross <= 55_000_000 ? 0.17 : 0.15;
  const rentTaxCredit = rentEligible ? rentPaid * rentRate : 0;

  const standardTaxCredit = data.use_standard_credit ? 130_000 : 0;

  const otherTaxCredit = data.other_tax_credit;

  const specialCreditsAllowed = !data.use_standard_credit;
  const appliedInsuranceCredit = specialCreditsAllowed ? insuranceTaxCredit : 0;
  const appliedMedicalCredit = specialCreditsAllowed ? medicalTaxCredit : 0;
  const appliedEducationCredit = specialCreditsAllowed ? educationTaxCredit : 0;
  const appliedGeneralDonationCredit = specialCreditsAllowed
    ? donationsOtherCredit
    : donationsEmployeeCredit;
  const appliedRentCredit = specialCreditsAllowed ? rentTaxCredit : 0;

  const totalTaxCredits =
    earnedIncomeTaxCredit +
    childTaxCredit +
    birthCredit +
    marriageTaxCredit +
    pensionTaxCredit +
    appliedInsuranceCredit +
    appliedMedicalCredit +
    appliedEducationCredit +
    appliedGeneralDonationCredit +
    donationsPoliticalCredit +
    donationsHometownCredit +
    appliedRentCredit +
    standardTaxCredit +
    otherTaxCredit;

  const determinedIncomeTaxRaw = Math.max(0, calculatedTax - totalTaxCredits);
  const determinedIncomeTax = floor10(determinedIncomeTaxRaw);
  const localTax = floor10(determinedIncomeTaxRaw * 0.1);
  const totalDeterminedTax = determinedIncomeTax + localTax;

  const withheldTotal = withheldIncome + withheldLocal;
  const refundAmount = withheldTotal - totalDeterminedTax;

  const outputs = {
    taxableIncome,
    calculatedTax,
    totalTaxCredits,
    determinedIncomeTax,
    localTax,
    totalDeterminedTax,
    refundAmount,
    earnedIncomeDeduction: earnedDeduction,
    basicDeduction: baseDeduction,
    additionalDeduction: additionalDeduction,
    socialInsuranceDeduction: socialInsurance,
    cardDeduction: card.deduction,
    cardThreshold: cardTargets.threshold,
    cardBaseTarget: cardTargets.baseTarget,
    cardBaseTargetCredit: cardTargets.baseTargetCredit,
    cardMaxTarget: cardTargets.maxTarget,
    cardAdditionalNeeded: additionalNeeded,
    housingSavingsDeduction: housingSavingsDeduction,
    leaseLoanDeduction: leaseLoanDeduction,
    mortgageDeduction: mortgageDeduction,
    otherIncomeDeduction: otherIncomeDeduction,
    incomeDeductionTotal,
    earnedIncomeTaxCredit,
    childTaxCredit,
    birthTaxCredit: birthCredit,
    marriageTaxCredit,
    pensionTaxCredit,
    insuranceTaxCredit: appliedInsuranceCredit,
    medicalTaxCredit: appliedMedicalCredit,
    educationTaxCredit: appliedEducationCredit,
    donationsGeneralCredit: appliedGeneralDonationCredit,
    donationsPoliticalCredit,
    donationsHometownCredit,
    rentTaxCredit: appliedRentCredit,
    standardTaxCredit,
    otherTaxCredit,
    withheldIncomeTax: withheldIncome,
    withheldLocalTax: withheldLocal,
    withheldTotalTax: withheldTotal,
  };

  const warnings = [];
  if (gross > 70_000_000) {
    warnings.push('총급여 7,000만 초과 시 카드 공제 한도/문화비 공제 적용이 달라질 수 있습니다.');
  }
  if (!cultureEligible && (cultureSpend > 0 || sportsEligible > 0)) {
    warnings.push('문화비·체육시설 공제는 총급여 7,000만 이하에서만 적용되므로 해당 금액은 일반 사용액에 포함하세요.');
  }
  if (card.meta && card.meta.total > 0 && card.meta.total <= card.meta.threshold) {
    warnings.push('카드 사용액이 총급여의 25% 미만이면 신용카드 소득공제가 적용되지 않습니다.');
  }
  if (data.single_parent && data.female_head) {
    warnings.push('한부모 공제와 부녀자 공제는 중복 적용되지 않아 한부모 공제로 계산됩니다.');
  }
  if (donationsPolitical > politicalEligible) {
    warnings.push('정치자금기부금은 근로소득금액 한도까지만 공제됩니다.');
  }
  if (donationsHometown > hometownLimit) {
    warnings.push('고향사랑기부금 세액공제는 근로소득금액 범위 내 2,000만 원 한도까지만 적용됩니다.');
  }
  if (donationsSpecial > donationSpecialEligible) {
    warnings.push('특례기부금은 정치·고향 차감 후 근로소득금액 한도까지만 공제됩니다.');
  }
  if (donationsEmployeeStock > employeeLimit) {
    warnings.push('우리사주조합 기부금은 근로소득금액의 30% 한도까지만 공제됩니다.');
  }
  if (donationsGeneral > generalLimit || donationsReligious > religiousLimit) {
    warnings.push('일반·종교 기부금은 한도(종교 10% + 일반 20% 또는 30%)까지만 공제됩니다.');
  }
  if (housingSavingsRaw + leaseLoanRaw > housingCombinedLimit) {
    warnings.push('주택청약저축과 주택임차차입금 공제는 합산 400만 한도 적용됩니다.');
  }
  if (useAnnualSalary && annualSalary > 0) {
    warnings.push('총급여는 연봉(비과세 포함)에서 비과세소득을 차감해 자동 계산되었습니다.');
  }
  if (data.use_standard_credit) {
    warnings.push('표준세액공제를 선택하면 보험료·의료비·교육비·월세·특례/일반/종교 기부금은 제외되며 정치자금·우리사주·고향사랑 기부금만 반영됩니다. 일부 지정기부금의 중복 가능 여부는 별도 확인이 필요합니다.');
  }

  return {
    outputs,
    warnings,
    meta: {
      gross,
      withheldLocalProvided,
      withheldLocal,
      withheldIncome,
    },
  };
};

const calculate = () => {
  const baseData = collectFormData();
  const estimateConfig = collectEstimateConfig();
  const adjustedData = buildAdjustedData(baseData, estimateConfig);
  const estimateWarnings = buildEstimateWarnings(estimateConfig);
  const { outputs, warnings, meta } = computeResults(adjustedData);

  if (baseData.use_annual_salary && baseData.annual_salary > 0) {
    const estimatedGross = Math.max(0, baseData.annual_salary - baseData.nontaxable_salary);
    const grossInput = document.getElementById('gross_salary');
    if (grossInput && Number(grossInput.value) !== Math.round(estimatedGross)) {
      grossInput.value = Math.round(estimatedGross);
    }
  }

  updateOutput('taxableIncome', outputs.taxableIncome);
  updateOutput('calculatedTax', outputs.calculatedTax);
  updateOutput('totalTaxCredits', outputs.totalTaxCredits);
  updateOutput('determinedIncomeTax', outputs.determinedIncomeTax);
  updateOutput('localTax', outputs.localTax);
  updateOutput('totalDeterminedTax', outputs.totalDeterminedTax);
  updateOutput('refundAmount', Math.abs(outputs.refundAmount));
  updateOutput('earnedIncomeDeduction', outputs.earnedIncomeDeduction);
  updateOutput('basicDeduction', outputs.basicDeduction);
  updateOutput('additionalDeduction', outputs.additionalDeduction);
  updateOutput('socialInsuranceDeduction', outputs.socialInsuranceDeduction);
  updateOutput('cardDeduction', outputs.cardDeduction);
  updateOutput('cardThreshold', outputs.cardThreshold);
  updateOutput('cardBaseTarget', outputs.cardBaseTarget);
  updateOutput('cardBaseTargetCredit', outputs.cardBaseTargetCredit);
  updateOutput('cardMaxTarget', outputs.cardMaxTarget);
  updateOutput('cardAdditionalNeeded', outputs.cardAdditionalNeeded);
  updateOutput('housingSavingsDeduction', outputs.housingSavingsDeduction);
  updateOutput('leaseLoanDeduction', outputs.leaseLoanDeduction);
  updateOutput('mortgageDeduction', outputs.mortgageDeduction);
  updateOutput('otherIncomeDeduction', outputs.otherIncomeDeduction);
  updateOutput('incomeDeductionTotal', outputs.incomeDeductionTotal);
  updateOutput('earnedIncomeTaxCredit', outputs.earnedIncomeTaxCredit);
  updateOutput('childTaxCredit', outputs.childTaxCredit);
  updateOutput('birthTaxCredit', outputs.birthTaxCredit);
  updateOutput('marriageTaxCredit', outputs.marriageTaxCredit);
  updateOutput('pensionTaxCredit', outputs.pensionTaxCredit);
  updateOutput('insuranceTaxCredit', outputs.insuranceTaxCredit);
  updateOutput('medicalTaxCredit', outputs.medicalTaxCredit);
  updateOutput('educationTaxCredit', outputs.educationTaxCredit);
  updateOutput('donationsGeneralCredit', outputs.donationsGeneralCredit);
  updateOutput('donationsPoliticalCredit', outputs.donationsPoliticalCredit);
  updateOutput('donationsHometownCredit', outputs.donationsHometownCredit);
  updateOutput('rentTaxCredit', outputs.rentTaxCredit);
  updateOutput('standardTaxCredit', outputs.standardTaxCredit);
  updateOutput('otherTaxCredit', outputs.otherTaxCredit);
  updateOutput('withheldIncomeTax', outputs.withheldIncomeTax);
  updateOutput('withheldLocalTax', outputs.withheldLocalTax);
  updateOutput('withheldTotalTax', outputs.withheldTotalTax);

  updateOutput('refundLabel', outputs.refundAmount >= 0 ? '예상 환급액' : '추가 납부 예상', true);
  updateOutput(
    'withheldNote',
    meta.withheldLocalProvided
      ? '기납부 지방소득세는 입력값 기준으로 계산됩니다.'
      : '지방소득세가 미입력되어 소득세의 10%로 추정되었습니다.',
    true
  );

  if (estimateRangeCard) {
    if (estimateConfig.enabled && estimateConfig.range) {
      const rangeRatio = Math.max(0, (estimateConfig.range_percent || 0) / 100);
      const lowerData = buildAdjustedData(baseData, estimateConfig, 1 - rangeRatio);
      const upperData = buildAdjustedData(baseData, estimateConfig, 1 + rangeRatio);
      const lowResult = computeResults(lowerData);
      const highResult = computeResults(upperData);
      const lowRefund = Math.min(lowResult.outputs.refundAmount, highResult.outputs.refundAmount);
      const highRefund = Math.max(lowResult.outputs.refundAmount, highResult.outputs.refundAmount);
      estimateRangeCard.style.display = 'block';
      updateOutput('refundRangeLow', formatSignedWon(lowRefund), true);
      updateOutput('refundRangeHigh', formatSignedWon(highRefund), true);
    } else {
      estimateRangeCard.style.display = 'none';
    }
  }

  latestResults = outputs;
  clearShareOutput();
  recordInterest(pickInterestCategory(baseData));
  updateInputSummary(baseData, estimateConfig);
  updateWarnings([...warnings, ...estimateWarnings]);
};

const updatePaystubStatus = (message, isError = false) => {
  if (!paystubStatus) return;
  paystubStatus.textContent = message;
  paystubStatus.style.color = isError ? '#9b2c1f' : '#6c7a90';
};

const normalizeForMatch = (text) =>
  text
    .normalize('NFD')
    .replace(/[^0-9A-Za-z\u1100-\u11FF\u3130-\u318F]/g, '')
    .toLowerCase();

const normalizeNumberText = (text) => text.replace(/\u00a0/g, ' ').replace(/\s*,\s*/g, ',');

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
    const contexts = indexes.map((idx) =>
      [lines[idx - 1], lines[idx], lines[idx + 1]].filter(Boolean).join(' ')
    );
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
  const ys = Array.from(
    new Set(pageItems.map((item) => Math.round(item.y * 2) / 2))
  ).sort((a, b) => b - a);
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
    if (!groupedByPage.has(item.page)) {
      groupedByPage.set(item.page, []);
    }
    groupedByPage.get(item.page).push(item);
  });

  const lines = [];
  groupedByPage.forEach((pageItems) => {
    const threshold = computeRowThreshold(pageItems);
    pageItems.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    let current = [];
    let lastY = null;

    pageItems.forEach((item) => {
      if (lastY === null || Math.abs(item.y - lastY) <= threshold) {
        current.push(item);
      } else {
        const line = current
          .slice()
          .sort((a, b) => a.x - b.x)
          .map((entry) => entry.text)
          .join(' ');
        lines.push(line);
        current = [item];
      }
      lastY = item.y;
    });

    if (current.length) {
      const line = current
        .slice()
        .sort((a, b) => a.x - b.x)
        .map((entry) => entry.text)
        .join(' ');
      lines.push(line);
    }
  });

  return lines;
};

const buildRowGroupsFromItems = (items, thresholdOverride = null) => {
  const groupedByPage = new Map();
  items.forEach((item) => {
    if (!groupedByPage.has(item.page)) {
      groupedByPage.set(item.page, []);
    }
    groupedByPage.get(item.page).push(item);
  });

  const rows = [];

  groupedByPage.forEach((pageItems) => {
    const threshold = Number.isFinite(thresholdOverride)
      ? thresholdOverride
      : computeRowThreshold(pageItems);
    pageItems.sort((a, b) => (b.y - a.y) || (a.x - b.x));
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

    if (current.length) {
      rows.push(current.slice().sort((a, b) => a.x - b.x));
    }
  });

  return rows;
};

const getRowText = (rowItems) => rowItems.map((item) => item.text).join(' ');

const getRowNumbers = (rowItems) => rowItems.flatMap((item) => extractAmounts(item.text));

const getRowNumericCount = (rowItems) => getRowNumbers(rowItems).length;

const findTotalsRow = (rowGroups) => {
  let best = null;
  rowGroups.forEach((rowItems) => {
    const text = getRowText(rowItems).trim();
    if (!text.startsWith('계')) return;
    const count = getRowNumericCount(rowItems);
    if (!count) return;
    if (!best || count > best.count) {
      best = { rowItems, count };
    }
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
    if (!best || count > best.count) {
      best = { rowItems, count };
    }
  });
  return best ? best.rowItems : null;
};

const findRowWithMaxValue = (rowGroups) => {
  let best = null;
  rowGroups.forEach((rowItems) => {
    const numbers = getRowNumbers(rowItems);
    if (!numbers.length) return;
    const maxValue = Math.max(...numbers);
    if (!best || maxValue > best.maxValue) {
      best = { rowItems, maxValue };
    }
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

const mapLabelToTotal = (labelItem, totalsRow, totalXFallback = null) => {
  if (!labelItem || !totalsRow) return null;
  const value = getNumberNearX(totalsRow, labelItem.x, 24);
  if (value !== null) return value;
  return getNumberNearX(totalsRow, totalXFallback, 24);
};

const getRowNumericValuesSorted = (rowItems) =>
  rowItems
    .flatMap((item) =>
      extractAmounts(item.text).map((value) => ({ x: item.x, value }))
    )
    .sort((a, b) => a.x - b.x)
    .map((item) => item.value);

const countMonthTokens = (rowItems) => {
  const text = getRowText(rowItems);
  const matches = text.match(/\d{1,2}\s*월/g) || [];
  const unique = new Set(matches.map((token) => token.replace(/\s+/g, '')));
  return unique.size;
};

const findRightmostNumericColumnX = (items) => {
  const numericItems = items
    .map((item) => ({
      x: item.x,
      values: extractAmounts(item.text),
    }))
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
    const totalItem =
      rowItems.find((item) => item.text.includes('계')) ||
      rowItems.find((item) => item.text.includes('합계'));
    const rightmostX = rowItems.reduce((max, item) => Math.max(max, item.x), -Infinity);
    const candidateX = totalItem ? totalItem.x : rightmostX;
    if (!best || monthCount > best.monthCount) {
      best = { x: candidateX, monthCount };
    }
  });
  return best ? best.x : null;
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

const getRightmostNumber = (rowItems) => {
  const numericItems = rowItems
    .map((item) => {
      const amounts = extractAmounts(item.text);
      if (!amounts.length) return null;
      return { x: item.x, value: amounts[amounts.length - 1] };
    })
    .filter(Boolean);

  if (!numericItems.length) return null;
  numericItems.sort((a, b) => b.x - a.x);
  return numericItems[0].value;
};

const buildRowData = (rowGroups) =>
  rowGroups.map((rowItems) => {
    const text = getRowText(rowItems);
    return {
      items: rowItems,
      text,
      normalized: normalizeForMatch(text),
    };
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
    const rowItems = items.filter(
      (item) => item.page === labelItem.page && Math.abs(item.y - labelItem.y) <= tolerance
    );
    const rowText = rowItems
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(' ');
    const rowNormalized = normalizeForMatch(rowText);
    if (normalizedExclude.some((label) => rowNormalized.includes(label))) {
      return;
    }
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
  const values = candidates
    .map((row) => getNumberNearX(row.items, totalX))
    .filter((value) => value !== null);
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
    ['합계', '누계']
  );
  const longTermCare = findAmountByLabel(
    lines,
    ['노인장기요양보험', '노인장기요양보', '장기요양보험', '장기요양보', '장기요양'],
    ['합계', '누계'],
    ['연말정산']
  );
  const longTermAdjust = findAmountByLabel(
    lines,
    ['장기요양연말정산', '장기요양 연말정산', '장기요양연말정', '장기요양 연말정'],
    ['합계', '누계']
  );
  const employment = findAmountByLabel(lines, ['고용보험'], ['합계', '누계']);

  const socialInsurance =
    (pension || 0) +
    (healthInsurance || 0) +
    (healthAdjust || 0) +
    (longTermCare || 0) +
    (longTermAdjust || 0) +
    (employment || 0);

  const grossSalary =
    annualSalary !== null && nontaxableSalary !== null
      ? Math.max(0, annualSalary - nontaxableSalary)
      : null;

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

  const pension = findAmountByLabelRows(
    rows,
    ['일반기여금', '국민연금', '공무원연금'],
    ['합계', '누계'],
    [],
    totalX
  );
  const healthInsurance = findAmountByLabelRows(
    rows,
    ['건강보험'],
    ['합계', '누계'],
    ['연말정산'],
    totalX
  );
  const healthAdjust = findAmountByLabelRows(
    rows,
    ['건강보험연말정산', '건강보험 연말정산', '건강보험연말정', '건강보험 연말정'],
    ['합계', '누계'],
    [],
    totalX
  );
  const longTermCare = findAmountByLabelRows(
    rows,
    ['노인장기요양보험', '노인장기요양보', '장기요양보험', '장기요양보', '장기요양'],
    ['합계', '누계'],
    ['연말정산'],
    totalX
  );
  const longTermAdjust = findAmountByLabelRows(
    rows,
    ['장기요양연말정산', '장기요양 연말정산', '장기요양연말정', '장기요양 연말정'],
    ['합계', '누계'],
    [],
    totalX
  );
  const employment = findAmountByLabelRows(rows, ['고용보험'], ['합계', '누계'], [], totalX);

  const socialInsurance =
    (pension || 0) +
    (healthInsurance || 0) +
    (healthAdjust || 0) +
    (longTermCare || 0) +
    (longTermAdjust || 0) +
    (employment || 0);

  const grossSalary =
    annualSalary !== null && nontaxableSalary !== null
      ? Math.max(0, annualSalary - nontaxableSalary)
      : null;

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
  const healthInsurance = findAmountByLabelItems(
    items,
    ['건강보험'],
    ['합계', '누계'],
    ['연말정산']
  );
  const healthAdjust = findAmountByLabelItems(
    items,
    ['건강보험연말정산', '건강보험 연말정산', '건강보험연말정', '건강보험 연말정'],
    ['합계', '누계']
  );
  const longTermCare = findAmountByLabelItems(
    items,
    ['노인장기요양보험', '노인장기요양보', '장기요양보험', '장기요양보', '장기요양'],
    ['합계', '누계'],
    ['연말정산']
  );
  const longTermAdjust = findAmountByLabelItems(
    items,
    ['장기요양연말정산', '장기요양 연말정산', '장기요양연말정', '장기요양 연말정'],
    ['합계', '누계']
  );
  const employment = findAmountByLabelItems(items, ['고용보험'], ['합계', '누계']);

  const socialInsurance =
    (pension || 0) +
    (healthInsurance || 0) +
    (healthAdjust || 0) +
    (longTermCare || 0) +
    (longTermAdjust || 0) +
    (employment || 0);

  const grossSalary =
    annualSalary !== null && nontaxableSalary !== null
      ? Math.max(0, annualSalary - nontaxableSalary)
      : null;

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
    withheldIncomeTax = mapLabelToTotal(
      findLabelItem(taxTotalsItems, ['소득세']),
      taxTotalsRow,
      totalX
    );
    withheldLocalTax = mapLabelToTotal(
      findLabelItem(taxTotalsItems, ['지방소득세', '지방세']),
      taxTotalsRow,
      totalX
    );
    pension = mapLabelToTotal(
      findLabelItem(taxTotalsItems, ['일반기여금', '국민연금', '공무원연금']),
      taxTotalsRow,
      totalX
    );
    healthInsurance = mapLabelToTotal(
      findLabelItem(taxTotalsItems, ['건강보험']),
      taxTotalsRow,
      totalX
    );
    healthAdjust = mapLabelToTotal(
      findLabelItem(taxTotalsItems, ['건강보험연말정산', '건강보험연말정']),
      taxTotalsRow,
      totalX
    );
    longTermCare = mapLabelToTotal(
      findLabelItem(taxTotalsItems, ['노인장기요양보험', '노인장기요양보', '장기요양보험']),
      taxTotalsRow,
      totalX
    );
    longTermAdjust = mapLabelToTotal(
      findLabelItem(taxTotalsItems, ['장기요양연말정산', '장기요양연말정']),
      taxTotalsRow,
      totalX
    );
    employment = mapLabelToTotal(
      findLabelItem(taxTotalsItems, ['고용보험']),
      taxTotalsRow,
      totalX
    );

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

    annualSalary =
      annualFromColumn ?? mapLabelToTotal(annualLabel, salaryRow, totalX);
    nontaxableSalary =
      nontaxableFromColumn ?? mapLabelToTotal(nontaxableLabel, salaryRow, totalX);

    const totals = getRowNumericValuesSorted(salaryRow);
    if (totals.length >= 3) {
      if (annualSalary === null) annualSalary = totals[totals.length - 4] || totals[1];
      if (nontaxableSalary === null) nontaxableSalary = totals[totals.length - 3] || totals[2];
    }
  }

  const grossSalary =
    annualSalary !== null && nontaxableSalary !== null
      ? Math.max(0, annualSalary - nontaxableSalary)
      : null;
  const socialInsurance =
    (pension || 0) +
    (healthInsurance || 0) +
    (healthAdjust || 0) +
    (longTermCare || 0) +
    (longTermAdjust || 0) +
    (employment || 0);

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

const parsePaystubFile = async (file) => {
  if (!pdfjsLib) {
    throw new Error('PDF.js가 로드되지 않았습니다.');
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const disableWorker = window.location.protocol === 'file:';
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
    if (!itemsByPage.has(item.page)) {
      itemsByPage.set(item.page, []);
    }
    itemsByPage.get(item.page).push(item);
  });

  const columnMapResult = parsePaystubByColumnMap(itemsByPage);
  const itemsResult = parsePaystubItems(items);
  const linesResult = parsePaystubLines(lineRows);

  const score = (result) =>
    [
      'annualSalary',
      'nontaxableSalary',
      'grossSalary',
      'withheldIncomeTax',
      'withheldLocalTax',
      'socialInsurance',
    ].reduce((sum, key) => sum + (result[key] !== null ? 1 : 0), 0);

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

const applyPaystubData = (result) => {
  const missing = [];
  if (result.annualSalary !== null) {
    setInputValue('annual_salary', result.annualSalary);
  } else {
    missing.push('연간 근로소득');
  }
  if (result.nontaxableSalary !== null) {
    setInputValue('nontaxable_salary', result.nontaxableSalary);
  } else {
    missing.push('비과세 합계');
  }
  if (result.grossSalary !== null) {
    setInputValue('gross_salary', result.grossSalary);
  }
  if (result.withheldIncomeTax !== null) {
    setInputValue('withheld_income_tax', result.withheldIncomeTax);
  } else {
    missing.push('기납부 소득세');
  }
  if (result.withheldLocalTax !== null) {
    setInputValue('withheld_local_tax', result.withheldLocalTax);
  }
  if (result.socialInsurance !== null) {
    setInputValue('social_insurance', result.socialInsurance);
  } else {
    missing.push('사회보험료');
  }

  const useAnnualSalary = document.getElementById('use_annual_salary');
  if (useAnnualSalary && result.annualSalary !== null && result.nontaxableSalary !== null) {
    useAnnualSalary.checked = true;
  }

  const details = [];
  if (result.annualSalary !== null) details.push(`연봉 ${formatWon(result.annualSalary)}`);
  if (result.nontaxableSalary !== null) details.push(`비과세 ${formatWon(result.nontaxableSalary)}`);
  if (result.grossSalary !== null) details.push(`총급여 ${formatWon(result.grossSalary)}`);
  if (result.withheldIncomeTax !== null) details.push(`소득세 ${formatWon(result.withheldIncomeTax)}`);
  if (result.withheldLocalTax !== null) details.push(`지방세 ${formatWon(result.withheldLocalTax)}`);
  if (result.socialInsurance !== null) details.push(`사회보험료 ${formatWon(result.socialInsurance)}`);

  let message = '';
  let isError = false;
  if (details.length > 0) {
    message = `추출 완료: ${details.join(', ')}${missing.length ? ` (누락: ${missing.join(', ')})` : ''}`;
  } else if (!result.hasText) {
    message = '추출된 값이 없습니다. 스캔 이미지 PDF라 텍스트 레이어가 없을 수 있습니다.';
    isError = true;
  } else {
    message = 'PDF 텍스트는 읽었지만 항목명이 매칭되지 않았습니다. 다른 양식일 수 있어요.';
    isError = true;
  }
  updatePaystubStatus(message, isError);
};

const handlePaystubParse = async () => {
  if (!paystubFileInput || !paystubParseButton) return;
  const file = paystubFileInput.files && paystubFileInput.files[0];
  if (!file) {
    updatePaystubStatus('먼저 지급명세서 PDF 파일을 선택해 주세요.', true);
    return;
  }

  try {
    updatePaystubStatus('PDF 분석 중입니다...');
    const result = await parsePaystubFile(file);
    applyPaystubData(result);
    calculate();
  } catch (error) {
    updatePaystubStatus(`PDF 분석 실패: ${error.message || '알 수 없는 오류'}`, true);
  }
};

const addDependent = (defaults = {}) => {
  const template = document.getElementById('dependent-template');
  const clone = template.content.firstElementChild.cloneNode(true);

  const relation = clone.querySelector('[data-field="relation"]');
  const age = clone.querySelector('[data-field="age"]');
  const income = clone.querySelector('[data-field="income"]');
  const disabled = clone.querySelector('[data-field="disabled"]');

  relation.value = defaults.relation || 'spouse';
  age.value = defaults.age || '';
  income.value = defaults.income || '';
  disabled.checked = Boolean(defaults.disabled);

  clone.querySelector('[data-action="remove"]').addEventListener('click', () => {
    clone.remove();
    calculate();
  });

  clone.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', calculate);
    el.addEventListener('change', calculate);
  });

  dependentsList.appendChild(clone);
};

addDependent({ relation: 'spouse' });
addDependent({ relation: 'child' });

form.addEventListener('input', calculate);
form.addEventListener('change', calculate);
addDependentButton.addEventListener('click', () => addDependent());
if (paystubParseButton) {
  paystubParseButton.addEventListener('click', handlePaystubParse);
}
if (shareButton) {
  shareButton.addEventListener('click', handleShare);
}
if (shareCopy) {
  shareCopy.addEventListener('click', handleShareCopy);
}

calculate();
loadAffiliateBanner();
