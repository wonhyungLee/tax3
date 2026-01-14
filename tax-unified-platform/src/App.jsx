import { useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import {
  formatWon,
  formatSignedWon,
  calculateYearEndTax,
  calculateCorporateTax,
  calculateFinancialTax
} from './lib/tax-calculations';

const calculators = [
  { id: 'yearend', name: '연말정산', blurb: '근로소득 환급/추납' },
  { id: 'corporate', name: '법인세', blurb: 'TaxCore 2025 시뮬레이터' },
  { id: 'financial', name: '종합소득세', blurb: '금융소득 비교과세 · Gross-up · 해외소득' },
];

const calculatorFrames = [
  { id: 'yearend', title: '연말정산', src: '/yearend/index.html' },
  { id: 'corporate', title: '법인세', src: '/corporate/index.html' },
  { id: 'financial', title: '금융소득 종합과세', src: '/financial/index.html' },
];

const docChecklist = [
  '홈택스 간소화 PDF',
  '배당/이자 원천징수내역',
  '해외 금융소득/외국납부세액',
  '배당 Gross-up 대상 여부',
  '기타 종합소득/소득공제 합계',
];

const docChecklists = {
  yearend: ['홈택스 간소화 PDF', '근로소득 원천징수영수증(또는 급여명세서)', '보험/의료/교육/기부/월세 증빙(해당 시)'],
  corporate: ['재무제표/손익계산서', '세무조정 내역(접대비/감가상각/간주이자 등)', '이월결손금 명세', '세액공제 증빙(해당 시)'],
  financial: docChecklist,
};

const createInitialYearendForm = () => ({
  annual_salary: 0,
  nontaxable_salary: 0,
  use_annual_salary: false,
  gross_salary: 0,
  withheld_income_tax: 0,
  withheld_local_provided: false,
  withheld_local_tax: 0,
  dependents: [],
  self_disabled: false,
  single_parent: false,
  female_head: false,
  social_insurance: 0,
  credit_card_spend: 0,
  debit_card_spend: 0,
  market_transport_spend: 0,
  culture_expenses: 0,
  sports_facility_fee_eligible: 0,
  previous_card_spend: 0,
  culture_eligible: true,
  housing_savings: 0,
  housing_savings_eligible: true,
  lease_loan_repayment: 0,
  lease_loan_eligible: false,
  mortgage_interest: 0,
  mortgage_eligible: false,
  mortgage_limit: 0,
  other_income_deduction: 0,
  birth_first: 0,
  birth_second: 0,
  birth_third: 0,
  marriage_credit: false,
  pension_contribution: 0,
  isa_transfer: 0,
  pension_with_irp: false,
  insurance_premiums: 0,
  insurance_disabled: false,
  medical_expenses: 0,
  medical_special_expenses: 0,
  medical_infertility: 0,
  medical_premature: 0,
  postnatal_care: 0,
  medical_reimbursements: 0,
  education_k12: 0,
  education_university: 0,
  education_self: 0,
  donations_general: 0,
  donations_religious: 0,
  donations_special: 0,
  donations_political: 0,
  donations_hometown: 0,
  donations_hometown_disaster: 0,
  donations_employee_stock: 0,
  rent_paid: 0,
  rent_eligible: false,
  use_standard_credit: false,
  other_tax_credit: 0,
});

const createInitialCorporatePayload = () => ({
  filingYear: 2025,
  rateTable: '2025',
  residency: 'domestic',
  shippingMode: 'none',
  shippingTonnageBase: 0,
  fiscalMonths: 12,
  tonnageShips: [
    { tonnage: 0, days: 0, rate: 0 },
    { tonnage: 0, days: 0, rate: 0 },
    { tonnage: 0, days: 0, rate: 0 },
  ],
  companyProfile: {
    type: 'SME',
    isVenture: false,
    location: '',
    largeCorpOwnership: 0,
    equity: 0,
    debt: 0,
    isRealEstateRental: false,
  },
  roundingMode: 'round',
  financialData: {
    netIncome: 0,
    revenue: { general: 0, relatedParty: 0 },
    expenses: {
      businessPromotion: { total: 0, cultural: 0, market: 0, noProof: 0 },
      vehicles: { count: 0, depreciation: 0 },
      generalDepreciation: { claimed: 0, statutoryLimit: null },
      nonBusiness: 0,
    },
    advancesToRelated: 0,
    overdraftRate: 0,
    interestPaid: 0,
    deemedRentOverride: 0,
    excessRetainedOverride: 0,
  },
  adjustments: {
    manualIncomeAdd: 0,
    manualIncomeExclude: 0,
    manualExpenseDisallow: 0,
    manualExpenseAllow: 0,
    lossCarryforward: { totalAvailable: 0, originYear: 2020 },
    prepaidTax: 0,
  },
  donations: {
    specialLimitRate: 0.5,
    generalLimitRate: 0.1,
    specialCarry: 0,
    specialCurrent: 0,
    generalCarry: 0,
    generalCurrent: 0,
  },
  credits: {
    rd: { current: 0, increment: 0, baseRate: null },
    investment: { current: 0, avgThreeYear: 0 },
    other: 0,
    foreignTax: 0,
    exemptMinTax: 0,
  },
});

const createInitialFinancialInput = () => ({
  financialIncomes: [
    {
      amount: 0,
      withholdingRate: 0.14,
      grossUpEligible: true,
      source: 'domestic',
      foreignTaxPaid: 0,
      prepaidTax: 0,
    },
  ],
  otherIncome: { gross: 0, deductions: 0, items: [] },
  taxCredits: { other: 0 },
  prepaid: { national: 0, local: 0 },
  settings: { grossUpRate: 0.1 },
});

const normalizeCompact = (value) => String(value ?? '').replace(/\s+/g, '').replace(/,/g, '');

const parseMoneyString = (raw) => {
  const value = normalizeCompact(raw).replace(/원/g, '');
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);

  const hasEok = value.includes('억');
  let remaining = value;
  let total = 0;

  const take = (regex, multiplier) => {
    const match = remaining.match(regex);
    if (!match) return;
    total += Number(match[1]) * multiplier;
    remaining = remaining.replace(match[0], '');
  };

  take(/(\d+(?:\.\d+)?)억/, 100_000_000);
  take(/(\d+(?:\.\d+)?)천만/, 10_000_000);
  take(/(\d+(?:\.\d+)?)백만/, 1_000_000);
  take(/(\d+(?:\.\d+)?)십만/, 100_000);
  take(/(\d+(?:\.\d+)?)만/, 10_000);

  if (hasEok) {
    take(/(\d+(?:\.\d+)?)천/, 10_000_000);
    take(/(\d+(?:\.\d+)?)백/, 1_000_000);
    take(/(\d+(?:\.\d+)?)십/, 100_000);
  } else {
    take(/(\d+(?:\.\d+)?)천/, 1_000);
    take(/(\d+(?:\.\d+)?)백/, 100);
    take(/(\d+(?:\.\d+)?)십/, 10);
  }

  if (remaining && /^\d+(?:\.\d+)?$/.test(remaining)) total += Number(remaining);
  return Number.isFinite(total) ? total : null;
};

const extractMoney = (text, regex) => {
  const match = String(text).match(regex);
  if (!match) return null;
  return parseMoneyString(match[1]);
};

const parseYesNo = (text) => {
  const t = String(text);
  if (/(네|예|맞아|맞습니다|y|yes|true)/i.test(t)) return true;
  if (/(아니|아니요|no|n|false)/i.test(t)) return false;
  return null;
};

const parseRate = (text) => {
  const raw = extractMoney(text, /(?:gross|그로스|배당가산|가산율)\s*[:=]?\s*([0-9.,%]+)/i);
  if (raw == null) return null;
  if (raw > 1) return raw / 100;
  if (raw < 0) return 0;
  return raw;
};

const cloneDeep = (value) => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const coupangAds = [
  { id: 902948, trackingCode: 'AF7397099', subId: null, template: 'carousel', width: '1200', height: '250' },
  { id: 902947, trackingCode: 'AF7397099', subId: null, template: 'carousel', width: '1200', height: '250' },
  { id: 902949, trackingCode: 'AF7397099', subId: null, template: 'carousel', width: '1200', height: '250' },
];

let coupangSdkPromise;
const loadCoupangSdk = () => {
  if (typeof window === 'undefined') return Promise.reject(new Error('Missing window'));
  if (coupangSdkPromise) return coupangSdkPromise;
  coupangSdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('coupang-partners-sdk');
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }
    const script = existing || document.createElement('script');
    script.id = 'coupang-partners-sdk';
    script.src = 'https://ads-partners.coupang.com/g.js';
    script.async = true;
    script.dataset.loaded = 'false';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Coupang Partners SDK'));
    if (!existing) document.head.appendChild(script);
  });
  return coupangSdkPromise;
};

const ChatBubble = ({ role, text, links = [], children }) => (
  <div className={`bubble-row ${role === 'user' ? 'me' : ''}`}>
    <div className={`bubble ${role}`}>
      {text && <div className="bubble-body">{text}</div>}
      {links && links.length > 0 && (
        <div className="bubble-links">
          {links.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="link">
              {l.label}
            </a>
          ))}
        </div>
      )}
      {children}
    </div>
  </div>
);

function CoupangAd() {
  const containerRef = useRef(null);
  const [ad] = useState(() => coupangAds[Math.floor(Math.random() * coupangAds.length)]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    container.innerHTML = '';
    let cancelled = false;

    loadCoupangSdk()
      .then(() => {
        if (cancelled) return;
        const inline = document.createElement('script');
        inline.type = 'text/javascript';
        inline.text = `new PartnersCoupang.G(${JSON.stringify(ad)});`;
        container.appendChild(inline);
      })
      .catch(() => {
        if (cancelled) return;
        container.textContent = '광고를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
      });

    return () => {
      cancelled = true;
      container.innerHTML = '';
    };
  }, [ad]);

  return (
    <div className="ad-embed">
      <div className="ad-embed-head">
        <span className="pill">쿠팡 파트너스</span>
        <span className="muted">추천 상품</span>
      </div>
      <div ref={containerRef} className="ad-embed-slot" />
    </div>
  );
}

function useProgress(step) {
  const steps = useMemo(() => ['select', 'docs', 'input', 'review'], []);
  const index = Math.max(0, steps.indexOf(step));
  const pct = ((index + 1) / steps.length) * 100;
  return { steps, index, pct };
}

function ChatWizard() {
  const [calculator, setCalculator] = useState(null);
  const [step, setStep] = useState('select');
  const { steps, index, pct } = useProgress(step);
  const [stage, setStage] = useState(null);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([
    { role: 'bot', text: '안녕하세요! 메신저처럼 대화하면서 세금을 계산해 볼게요.' },
    { role: 'bot', text: '연말정산 · 법인세 · 종합소득세 중 무엇을 계산하고 싶으신가요?' },
  ]);
  const [docReady, setDocReady] = useState([]);
  const [yearendForm, setYearendForm] = useState(createInitialYearendForm);
  const [corporatePayload, setCorporatePayload] = useState(createInitialCorporatePayload);
  const [financialInput, setFinancialInput] = useState(createInitialFinancialInput);
  const messagesRef = useRef(null);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const pushMessage = (payload) => setMessages((prev) => [...prev, payload]);
  const pushBot = (text, extra = {}) => pushMessage({ role: 'bot', text, ...extra });
  const pushUser = (text) => pushMessage({ role: 'user', text });
  const pushAd = () => pushMessage({ role: 'bot', kind: 'ad', text: '추천 상품을 확인해 보세요.' });

  const resetFlow = () => {
    setCalculator(null);
    setStage(null);
    setDocReady([]);
    setYearendForm(createInitialYearendForm());
    setCorporatePayload(createInitialCorporatePayload());
    setFinancialInput(createInitialFinancialInput());
    setStep('select');
    setMessages([
      { role: 'bot', text: '대화형 세금 계산을 다시 시작할게요.' },
      { role: 'bot', text: '연말정산 · 법인세 · 종합소득세 중 무엇을 계산할까요?' },
    ]);
  };

  const currentDocs = docChecklists[calculator] || [];

  const yearendSummary = (form) => {
    const result = calculateYearEndTax(form);
    const refund = result.outputs.refundAmount;
    const refundLabel = refund >= 0 ? '예상 환급액' : '추가 납부 예상';
    const warnings = result.warnings?.length ? `\n주의: ${result.warnings.slice(0, 2).join(' / ')}` : '';
    return [
      `결정세액 ${formatWon(result.outputs.totalDeterminedTax)}`,
      `기납부(원천징수) ${formatWon(result.outputs.withheldTotalTax)}`,
      `${refundLabel} ${formatWon(Math.abs(refund))}`,
    ].join(' · ') + warnings;
  };

  const corporateSummary = (payload) => {
    const result = calculateCorporateTax(payload);
    const payable = result.payableTax;
    const payableLabel = payable >= 0 ? '추가 납부' : '환급/차감';
    return [
      `과세표준 ${formatWon(result.taxBase)}`,
      `산출세액 ${formatWon(result.calculatedTax)}`,
      `최저한세 ${formatWon(result.minimumTax)}`,
      `최종세액 ${formatWon(result.finalTax)}`,
      `${payableLabel} ${formatWon(Math.abs(payable))}`,
    ].join(' · ');
  };

  const financialSummary = (input) => {
    const result = calculateFinancialTax(input);
    const payable = result.taxes.totalPayable;
    const payableLabel = payable >= 0 ? '추가 납부' : '환급/차감';
    const methodLabel = result.chosenMethod === 'comprehensive' ? '종합과세' : '분리과세';
    return [
      `금융소득 ${formatWon(result.financialTotal)}`,
      result.comparisonNote,
      `선택: ${methodLabel}`,
      `${payableLabel} ${formatWon(Math.abs(payable))}`,
    ].join(' · ');
  };

  const handleSelectCalculator = (id) => {
    setCalculator(id);
    setStage(null);
    setDocReady([]);
    if (id === 'yearend') setYearendForm(createInitialYearendForm());
    if (id === 'corporate') setCorporatePayload(createInitialCorporatePayload());
    if (id === 'financial') setFinancialInput(createInitialFinancialInput());
    setStep('docs');
    const name = calculators.find((c) => c.id === id)?.name || '계산기';
    pushUser(`${name} 계산을 시작할게요.`);
    const docs = docChecklists[id] || [];
    pushBot('좋아요. 먼저 준비 자료를 확인할게요. 준비된 게 있으면 체크해 주세요. 예: "간소화 PDF 있음"');
    pushBot(`준비 자료 예시: ${docs.join(' · ')}`);
  };

  const beginInput = () => {
    setStep('input');
    if (calculator === 'yearend') {
      setStage('yearend_gross');
      pushBot('연말정산을 시작할게요. 올해 총급여(원)를 알려주세요. 예: "총급여 5000만"');
      return;
    }
    if (calculator === 'corporate') {
      setStage('corp_profile');
      pushBot('법인세를 시작할게요. 기업 유형을 알려주세요. 예: "중소" 또는 "일반"');
      return;
    }
    if (calculator === 'financial') {
      setStage('fin_income');
      pushBot('종합소득세(금융소득) 비교과세를 시작할게요. 금융소득 총액을 알려주세요. 예: "금융 2400만"');
    }
  };

  const handleDocsNext = () => {
    pushUser(`준비한 자료: ${docReady.length ? docReady.join(', ') : '없음'}`);
    beginInput();
  };

  const handleHelp = () => {
    if (!calculator) {
      pushBot('예: "연말정산", "법인세", "종합소득세" 중 하나를 입력해 주세요.');
      return;
    }
    if (calculator === 'yearend') {
      pushBot(
        [
          '연말정산 입력 예시:',
          '- 총급여 5000만',
          '- 소득세 300만 / 지방세 30만 (모르면 "모름")',
          '- 배우자 1, 자녀 2(10,15) / 없음',
          '- 신용카드 1200만 체크카드 300만 전통시장 50만',
          '- 연금 400만 IRP / 보험료 120만 / 의료비 200만 / 교육비 50만 / 기부금 30만 / 월세 600만(공제대상)',
          '입력이 끝나면 "완료"라고 보내 주세요.',
        ].join('\n'),
      );
      return;
    }
    if (calculator === 'corporate') {
      pushBot(
        [
          '법인세 입력 예시:',
          '- 중소 / 일반',
          '- 당기순이익 5억 (또는) 매출 15억 비용 10억',
          '- 이월결손금 1억 / 기납부세액 0',
          '- R&D 3억 증액 1억 / 투자 5억 평균 3억 / 기타공제 500만',
          '입력이 끝나면 "완료"라고 보내 주세요.',
        ].join('\n'),
      );
      return;
    }
    pushBot(
      [
        '종합소득세(금융소득) 입력 예시:',
        '- 금융 2400만 / 기타소득 4000만 / gross 0.1',
        '- 해외소득 1000만 / 외국납부세액 50만',
        '- 기납부 국세 0 / 기납부 지방세 0',
        '입력이 끝나면 "완료"라고 보내 주세요.',
      ].join('\n'),
    );
  };

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    pushUser(text);
    setInputText('');

    const lower = text.toLowerCase();
    if (lower.includes('리셋') || lower.includes('처음')) {
      resetFlow();
      return;
    }

    if (lower.includes('도움') || lower.includes('help')) {
      handleHelp();
      return;
    }

    if (lower.includes('광고') || lower.includes('추천')) {
      pushAd();
      pushBot('계산은 계속 이어갈 수 있어요. 원하시면 입력을 계속 보내 주세요.');
      return;
    }

    if (step === 'select') {
      if (lower.includes('연말') || lower.includes('year')) return handleSelectCalculator('yearend');
      if (lower.includes('법인') || lower.includes('corp')) return handleSelectCalculator('corporate');
      if (lower.includes('종합') || lower.includes('소득세') || lower.includes('금융') || lower.includes('financial')) {
        return handleSelectCalculator('financial');
      }
      pushBot('연말정산/법인세/종합소득세 중 하나를 말씀해 주세요. 예: "연말정산 계산"');
      return;
    }

    if (step === 'docs') {
      if (lower.includes('준비완료') || lower.includes('준비 완료') || lower.includes('완료') || lower === 'ok') {
        handleDocsNext();
        return;
      }
      const found = currentDocs.filter((d) =>
        d.toLowerCase().split(/[\s/()·]+/).some((token) => token && lower.includes(token)),
      );
      if (found.length) {
        setDocReady((prev) => Array.from(new Set([...prev, ...found])));
        pushBot(`${found.join(', ')} 체크되었습니다. "준비 완료"라고 보내면 다음 단계로 이동합니다.`);
        return;
      }
      pushBot('자료 준비 여부를 말씀해 주세요. 예: "간소화 PDF 준비", "준비 완료".');
      return;
    }

    const showIframeLink = () => {
      const name = calculators.find((c) => c.id === calculator)?.name ?? '계산기';
      pushBot('원본 계산기 화면도 열 수 있어요.', { links: [{ label: `${name} 계산기 열기`, href: `/${calculator}` }] });
    };

    const maybeFinish = () => {
      setStep('review');
      showIframeLink();
      pushBot('추가로 값을 수정하고 싶으면 그대로 메시지로 보내 주세요. "다시"라고 하면 처음부터 시작합니다.');
    };

    const finishRequested = /(완료|결과|계산끝|끝)\b/i.test(text);

    const updateYearend = () => {
      const next = { ...yearendForm };
      const gross = extractMoney(text, /(?:총급여|급여|연봉)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (gross != null) next.gross_salary = gross;

      const incomeTax = extractMoney(text, /(?:원천징수)?\s*(?:소득세|기납부소득세|기납부 소득세)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (incomeTax != null) next.withheld_income_tax = incomeTax;

      const localTax = extractMoney(text, /(?:지방(?:소득)?세|지방세)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (localTax != null) {
        next.withheld_local_tax = localTax;
        next.withheld_local_provided = true;
      }
      if (/모름|몰라/i.test(text)) {
        next.withheld_local_provided = false;
      }

      const socialInsurance = extractMoney(text, /(?:4대보험|사회보험)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (socialInsurance != null) next.social_insurance = socialInsurance;

      const insurancePremiums = extractMoney(text, /(?:보장성)?\s*보험료\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (insurancePremiums != null) next.insurance_premiums = insurancePremiums;

      const medical = extractMoney(text, /의료비\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (medical != null) next.medical_expenses = medical;

      const education = extractMoney(text, /교육비\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (education != null) next.education_k12 = education;

      const donation = extractMoney(text, /기부금\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (donation != null) next.donations_general = donation;

      const rent = extractMoney(text, /월세\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (rent != null) next.rent_paid = rent;
      if (/월세.*(공제대상|대상)/i.test(text)) next.rent_eligible = true;

      const creditCard = extractMoney(text, /신용카드\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (creditCard != null) next.credit_card_spend = creditCard;
      const debitCard = extractMoney(text, /(?:체크카드|현금영수증|체크)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (debitCard != null) next.debit_card_spend = debitCard;
      const market = extractMoney(text, /(?:전통시장|대중교통)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (market != null) next.market_transport_spend = market;

      if (/부녀자/i.test(text)) next.female_head = true;
      if (/한부모/i.test(text)) next.single_parent = true;

      if (stage === 'yearend_family') {
        if (/없음|없어요|없습니다/i.test(text)) {
          next.dependents = [];
        } else {
          const dependents = [];
          const spouseMatch = text.match(/배우자\s*(\d+)?/);
          if (spouseMatch) {
            const count = spouseMatch[1] ? Number(spouseMatch[1]) : 1;
            for (let i = 0; i < count; i += 1) {
              dependents.push({ relation: 'spouse', age: null, income: null, disabled: false });
            }
          }

          const childMatch = text.match(/자녀\s*(\d+)?(?:\(([^)]+)\))?/);
          if (childMatch) {
            const count = childMatch[1] ? Number(childMatch[1]) : 1;
            const ages = (childMatch[2] || '')
              .split(/[,\s]+/)
              .map((n) => parseInt(n, 10))
              .filter((n) => Number.isFinite(n));
            for (let i = 0; i < count; i += 1) {
              dependents.push({ relation: 'child', age: ages[i] ?? null, income: null, disabled: false });
            }
          }

          const parentMatch = text.match(/부모\s*(\d+)?(?:\(([^)]+)\))?/);
          if (parentMatch) {
            const count = parentMatch[1] ? Number(parentMatch[1]) : 1;
            const ages = (parentMatch[2] || '')
              .split(/[,\s]+/)
              .map((n) => parseInt(n, 10))
              .filter((n) => Number.isFinite(n));
            for (let i = 0; i < count; i += 1) {
              dependents.push({ relation: 'parent', age: ages[i] ?? null, income: null, disabled: false });
            }
          }

          if (dependents.length) next.dependents = dependents;
        }
      }

      setYearendForm(next);
      return next;
    };

    const updateCorporate = () => {
      const next = cloneDeep(corporatePayload);

      if (/중소|sme/i.test(text)) next.companyProfile.type = 'SME';
      if (/일반|general/i.test(text)) next.companyProfile.type = 'General';

      const netIncome = extractMoney(text, /(?:당기순이익|순이익|소득금액)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      const revenue = extractMoney(text, /(?:매출|수익)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      const expense = extractMoney(text, /(?:비용|지출)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);

      if (revenue != null) next.financialData.revenue.general = revenue;
      if (revenue != null && expense != null) next.financialData.netIncome = revenue - expense;
      if (netIncome != null) next.financialData.netIncome = netIncome;

      const loss = extractMoney(text, /(?:이월결손금|결손금)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (loss != null) next.adjustments.lossCarryforward.totalAvailable = loss;

      const prepaid = extractMoney(text, /(?:기납부세액|중간예납)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (prepaid != null) next.adjustments.prepaidTax = prepaid;

      const otherCredit = extractMoney(text, /(?:기타공제|기타\s*공제)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (otherCredit != null) next.credits.other = otherCredit;

      const rdCurrent = extractMoney(text, /(?:R&D|RD|연구)\s*(?:당기|현재)?\s*[:=]?\s*([0-9.,억만천백십 ]+)/i);
      if (rdCurrent != null) next.credits.rd.current = rdCurrent;
      const rdIncrement = extractMoney(text, /(?:증액|증가)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (rdIncrement != null) next.credits.rd.increment = rdIncrement;

      const invCurrent = extractMoney(text, /투자\s*(?:당기|현재)?\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (invCurrent != null) next.credits.investment.current = invCurrent;
      const invAvg = extractMoney(text, /(?:평균|3년)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (invAvg != null) next.credits.investment.avgThreeYear = invAvg;

      setCorporatePayload(next);
      return next;
    };

    const updateFinancial = () => {
      const next = cloneDeep(financialInput);

      const fin = extractMoney(text, /(?:금융|배당|이자)\s*[:=]?\s*([0-9.,억만천백십 ]+)/i);
      if (fin != null) next.financialIncomes[0].amount = fin;

      const other = extractMoney(text, /(?:기타소득|기타\s*소득|다른소득|기타)\s*[:=]?\s*([0-9.,억만천백십 ]+)/i);
      if (other != null) next.otherIncome.gross = other;

      const deductions = extractMoney(text, /(?:필요경비|공제)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (deductions != null) next.otherIncome.deductions = deductions;

      const rate = parseRate(text);
      if (rate != null) next.settings.grossUpRate = rate;

      if (/해외/i.test(text)) next.financialIncomes[0].source = 'foreign';
      const foreignTax = extractMoney(text, /(?:외국납부세액|해외세금)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (foreignTax != null) next.financialIncomes[0].foreignTaxPaid = foreignTax;

      const prepaidNational = extractMoney(text, /(?:기납부|원천징수)\s*(?:국세|소득세)?\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (prepaidNational != null) next.prepaid.national = prepaidNational;
      const prepaidLocal = extractMoney(text, /(?:기납부)\s*(?:지방세|지방소득세)\s*[:=]?\s*([0-9.,억만천백십 ]+)/);
      if (prepaidLocal != null) next.prepaid.local = prepaidLocal;

      setFinancialInput(next);
      return next;
    };

    const handleInput = () => {
      if (calculator === 'yearend') {
        const next = updateYearend();
        if (stage === 'yearend_gross') {
          if (!next.gross_salary) {
            pushBot('총급여를 숫자로 알려주세요. 예: "총급여 5000만"');
            return;
          }
          setStage('yearend_withheld');
          pushBot('좋아요. 이제 기납부(원천징수) 소득세를 알려주세요. 모르면 "모름"이라고 보내 주세요.');
          return;
        }
        if (stage === 'yearend_withheld') {
          setStage('yearend_family');
          pushBot('부양가족이 있나요? 예: "배우자 1", "자녀 2(10,15)", "없음"');
          return;
        }
        if (stage === 'yearend_family') {
          setStage('yearend_details');
          pushBot('이제 공제/세액공제 항목을 알려주시면 바로 반영해 드릴게요. 예: "신용카드 1200만, 의료비 200만". 다 입력했으면 "완료".');
          pushBot(yearendSummary(next));
          return;
        }
        pushBot(yearendSummary(next));
        if (finishRequested) maybeFinish();
        return;
      }

      if (calculator === 'corporate') {
        const next = updateCorporate();
        if (stage === 'corp_profile') {
          setStage('corp_financial');
          pushBot('좋아요. 당기순이익(또는 매출/비용)을 알려주세요. 예: "당기순이익 5억" 또는 "매출 15억 비용 10억"');
          return;
        }
        if (stage === 'corp_financial') {
          setStage('corp_loss');
          pushBot('이월결손금/기납부세액이 있나요? 예: "이월결손금 1억, 기납부세액 0" (없으면 0)');
          pushBot(corporateSummary(next));
          return;
        }
        if (stage === 'corp_loss') {
          setStage('corp_credits');
          pushBot('세액공제가 있나요? 예: "R&D 3억 증액 1억", "투자 5억 평균 3억", "기타공제 500만"');
          pushBot(corporateSummary(next));
          return;
        }
        if (stage === 'corp_credits') {
          setStage('corp_details');
          pushBot('추가 조정 항목이 있으면 계속 입력해 주세요. 다 입력했으면 "완료".');
          pushBot(corporateSummary(next));
          return;
        }
        pushBot(corporateSummary(next));
        if (finishRequested) maybeFinish();
        return;
      }

      if (calculator === 'financial') {
        const next = updateFinancial();
        if (stage === 'fin_income') {
          if (!next.financialIncomes[0].amount) {
            pushBot('금융소득 금액을 알려주세요. 예: "금융 2400만"');
            return;
          }
          setStage('fin_other');
          pushBot('좋아요. 기타 종합소득(금융 제외) 금액을 알려주세요. 예: "기타소득 4000만"');
          return;
        }
        if (stage === 'fin_other') {
          setStage('fin_details');
          pushBot('추가로 Gross-up/해외소득/외국납부세액/기납부세액이 있으면 입력해 주세요. 다 입력했으면 "완료".');
          pushBot(financialSummary(next));
          return;
        }
        pushBot(financialSummary(next));
        if (finishRequested) maybeFinish();
        return;
      }
      pushBot('계산기를 먼저 선택해 주세요.');
    };

    if (step === 'input') {
      if (lower.includes('열기')) {
        showIframeLink();
        return;
      }
      if (finishRequested) {
        maybeFinish();
        return;
      }
      handleInput();
      return;
    }

    if (step === 'review') {
      if (lower.includes('다시')) {
        resetFlow();
        return;
      }
      if (lower.includes('열기')) {
        showIframeLink();
        return;
      }
      // review 단계에서도 입력을 계속 받아 업데이트
      if (calculator === 'yearend') {
        const next = updateYearend();
        pushBot(yearendSummary(next));
        return;
      }
      if (calculator === 'corporate') {
        const next = updateCorporate();
        pushBot(corporateSummary(next));
        return;
      }
      if (calculator === 'financial') {
        const next = updateFinancial();
        pushBot(financialSummary(next));
        return;
      }
      pushBot('추가로 궁금한 점이 있으면 알려주세요.');
    }
  };

  const quickReplies = () => {
    if (step === 'select') return ['연말정산', '법인세', '종합소득세', '도움말'];
    if (step === 'docs') return ['준비 완료', ...(currentDocs.slice(0, 2) || []), '도움말'];
    if (step === 'input') {
      if (calculator === 'yearend' && stage === 'yearend_gross') return ['총급여 5000만', '총급여 50000000', '도움말'];
      if (calculator === 'yearend' && stage === 'yearend_withheld') return ['소득세 300만 지방세 30만', '모름', '도움말'];
      if (calculator === 'yearend' && stage === 'yearend_family') return ['없음', '배우자 1', '자녀 2(10,15)'];
      if (calculator === 'yearend') return ['신용카드 1200만 체크카드 300만', '의료비 200만', '완료'];

      if (calculator === 'corporate' && stage === 'corp_profile') return ['중소', '일반', '도움말'];
      if (calculator === 'corporate' && stage === 'corp_financial') return ['당기순이익 5억', '매출 15억 비용 10억', '도움말'];
      if (calculator === 'corporate' && stage === 'corp_loss') return ['이월결손금 0 기납부세액 0', '도움말'];
      if (calculator === 'corporate') return ['기타공제 500만', 'R&D 3억 증액 1억', '완료'];

      if (calculator === 'financial' && stage === 'fin_income') return ['금융 2400만', '금융 24000000', '도움말'];
      if (calculator === 'financial' && stage === 'fin_other') return ['기타소득 4000만', 'gross 0.1', '도움말'];
      if (calculator === 'financial') return ['해외소득 0 외국납부세액 0', '완료', '도움말'];
    }
    if (step === 'review') return ['계산기 열기', '다시 시작', '도움말'];
    return [];
  };

  const stepLabels = {
    select: '계산기 선택',
    docs: '자료 확인',
    input: '대화 입력',
    review: '결과/수정',
  };

  return (
    <section className="shell">
      <div className="chat-wrap">
        <div className="chat-head">
          <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
          <div className="stepper">
            {steps.map((s, i) => (
              <div key={s} className={`step ${i === index ? 'active' : ''} ${i < index ? 'completed' : ''}`}>
                {i + 1}단계 · {stepLabels[s] ?? s}
              </div>
            ))}
          </div>
        </div>

        <div className="messages" ref={messagesRef}>
          {messages.map((m, idx) => (
            <ChatBubble key={idx} role={m.role} text={m.text} links={m.links}>
              {m.kind === 'ad' && <CoupangAd />}
            </ChatBubble>
          ))}
        </div>
        <div className="composer">
          <div className="quick-replies">
            {quickReplies().map((q) => (
              <button key={q} className="btn ghost" type="button" onClick={() => { setInputText(q); setTimeout(handleSend, 0); }}>
                {q}
              </button>
            ))}
          </div>
          <div className="composer-row">
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              placeholder="메시지를 입력하세요. 예: 금융소득 2400만, 기타 4000만"
            />
            <button className="btn primary" type="button" onClick={handleSend}>전송</button>
          </div>
        </div>
      </div>
    </section>
  );
}

const PageLayout = ({ title, children }) => (
  <main className="shell">
    <h1 className="page-title">{title}</h1>
    {children}
  </main>
);

const IframePage = ({ title, src }) => (
  <PageLayout title={title}>
    <div className="card">
      <p className="muted">기존 계산기 화면을 그대로 제공합니다. 새 창 또는 아래 프레임에서 바로 계산할 수 있어요.</p>
      <div className="actions">
        <a className="btn primary" href={src} target="_blank" rel="noreferrer">새 창에서 열기</a>
      </div>
      <div className="frame-wrap">
        <iframe title={title} src={src} loading="lazy" />
      </div>
    </div>
  </PageLayout>
);

function Home() {
  return (
    <div>
      <header className="hero">
        <div>
          <p className="pill">대화형 진행</p>
          <h1>챗봇처럼 단계별로 세금 계산을 안내합니다</h1>
          <p className="lede">
            많은 입력을 한 번에 요구하지 않습니다. 필요한 자료 확인 → 소득/공제 입력 → 비교과세 결과를 메시지로 안내하며,
            모든 단계를 하나의 대화 안에서 이어 갑니다.
          </p>
          <div className="hero-badges">
            <span className="pill">Progressive Disclosure</span>
            <span className="pill">비교과세 강조</span>
            <span className="pill">접근성 준수</span>
          </div>
        </div>
      </header>
      <ChatWizard />
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {calculatorFrames.map((c) => (
        <Route key={c.id} path={`/${c.id}`} element={<IframePage title={c.title} src={c.src} />} />
      ))}
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

export default App;
