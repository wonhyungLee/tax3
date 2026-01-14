import { useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import {
  calculateCorporateTax,
  calculateFinancialTax,
  calculateYearEndTax,
  formatWon,
} from './lib/tax-calculations';
import { parsePaystubPdf } from './lib/paystub-parser';

const calculators = [
  { id: 'yearend', name: '연말정산', blurb: '근로소득 환급/추납' },
  { id: 'corporate', name: '법인세', blurb: '법인세 시뮬레이션' },
  { id: 'financial', name: '종합소득세', blurb: '금융소득 비교과세 · Gross-up' },
];

const docChecklists = {
  yearend: [
    '홈택스 간소화 PDF',
    '근로소득 원천징수영수증(또는 급여명세서)',
    '보험/의료/교육/기부/월세 증빙(해당 시)',
  ],
  corporate: [
    '재무제표/손익계산서',
    '세무조정 내역(접대비/감가상각/간주이자 등)',
    '이월결손금 명세',
    '세액공제 증빙(해당 시)',
  ],
  financial: [
    '배당/이자 원천징수내역',
    '해외 금융소득/외국납부세액(해당 시)',
    '배당 Gross-up 대상 여부',
    '다른 종합소득/소득공제 합계',
  ],
};

const calculatorFrames = [
  { id: 'yearend', title: '연말정산(원본)', src: '/yearend/index.html' },
  { id: 'corporate', title: '법인세(원본)', src: '/corporate/index.html' },
  { id: 'financial', title: '금융소득 종합과세(원본)', src: '/financial/index.html' },
];

const coupangAds = [
  { id: 902948, trackingCode: 'AF7397099', subId: null, template: 'carousel', width: '360', height: '210' },
  { id: 902947, trackingCode: 'AF7397099', subId: null, template: 'carousel', width: '360', height: '210' },
  { id: 902949, trackingCode: 'AF7397099', subId: null, template: 'carousel', width: '360', height: '210' },
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

let pdfjsSdkPromise;
const loadPdfJs = () => {
  if (typeof window === 'undefined') return Promise.reject(new Error('Missing window'));
  if (window.pdfjsLib?.getDocument) return Promise.resolve(window.pdfjsLib);
  if (pdfjsSdkPromise) return pdfjsSdkPromise;

  pdfjsSdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('pdfjs-sdk');
    if (existing?.dataset.loaded === 'true' && window.pdfjsLib?.getDocument) {
      resolve(window.pdfjsLib);
      return;
    }

    const script = existing || document.createElement('script');
    script.id = 'pdfjs-sdk';
    script.src = '/yearend/assets/vendor/pdf.min.js';
    script.async = true;
    script.dataset.loaded = 'false';
    script.onload = () => {
      script.dataset.loaded = 'true';
      const pdfjsLib = window.pdfjsLib;
      if (!pdfjsLib?.getDocument) {
        reject(new Error('PDF.js 로드에 실패했습니다.'));
        return;
      }
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/yearend/assets/vendor/pdf.worker.min.js';
      }
      resolve(pdfjsLib);
    };
    script.onerror = () => reject(new Error('PDF.js 스크립트를 불러오지 못했습니다.'));
    if (!existing) document.head.appendChild(script);
  });

  return pdfjsSdkPromise;
};

function CoupangAd({ title = '추천 상품', showHeader = true }) {
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

  if (!showHeader) {
    return <div ref={containerRef} className="ad-embed-slot" />;
  }

  return (
    <div className="ad-embed">
      <div className="ad-embed-head">
        <span className="pill">쿠팡 파트너스</span>
        <span className="muted">{title}</span>
      </div>
      <div ref={containerRef} className="ad-embed-slot" />
    </div>
  );
}

const COUPANG_BEST_CATEGORY_ID = 1016;
const COUPANG_SUB_ID = 'AF7397099';
const COUPANG_MIN_PRICE = 100_000;
const COUPANG_CATEGORY_IDS = [1001, 1002, 1010, 1011, 1015, 1016, 1024, 1025, 1026, 1030];

const shuffle = (values) => {
  const arr = values.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

function CoupangBestCategoryAds({ title = '베스트 추천', categoryIds = COUPANG_CATEGORY_IDS }) {
  const [state, setState] = useState(() => ({
    status: 'idle',
    products: [],
    error: null,
  }));

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setState({ status: 'loading', products: [], error: null });
    const normalizedCategoryIds = (Array.isArray(categoryIds) && categoryIds.length ? categoryIds : [COUPANG_BEST_CATEGORY_ID])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    const candidates = shuffle(normalizedCategoryIds.length ? normalizedCategoryIds : [COUPANG_BEST_CATEGORY_ID]);

    const fetchCategory = (index) => {
      if (cancelled) return;
      if (index >= candidates.length) {
        setState({ status: 'error', products: [], error: '광고 데이터를 불러오지 못했습니다.' });
        return;
      }

      const categoryId = candidates[index];
      fetch(
        `/api/coupang/bestcategories/${categoryId}?limit=4&imageSize=512x512&minPrice=${COUPANG_MIN_PRICE}&subId=${encodeURIComponent(
          COUPANG_SUB_ID,
        )}`,
        {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        },
      )
        .then(async (res) => {
          const contentType = res.headers.get('content-type') || '';
          const isJson = contentType.includes('application/json');
          const data = isJson ? await res.json().catch(() => ({})) : {};
          if (!res.ok) {
            const message = data?.error || data?.message || `광고 데이터를 불러오지 못했습니다. (${res.status})`;
            throw new Error(message);
          }
          if (!isJson) {
            throw new Error('광고 응답 형식이 올바르지 않습니다. (JSON 아님)');
          }
          return data;
        })
        .then((data) => {
          if (cancelled) return;
          const products = Array.isArray(data?.products) ? data.products : [];
          if (products.length === 0) {
            fetchCategory(index + 1);
            return;
          }
          setState({ status: 'success', products, error: null });
        })
        .catch((error) => {
          if (cancelled) return;
          if (error?.name === 'AbortError') return;
          fetchCategory(index + 1);
        });
    };

    fetchCategory(0);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [JSON.stringify(categoryIds)]);

  if (state.status === 'success' && state.products.length > 0) {
    return (
      <div className="ad-embed">
        <div className="ad-embed-head">
          <span className="pill">쿠팡 파트너스</span>
          <span className="muted">{title}</span>
        </div>
        <div className="ads">
          {state.products.map((p) => (
            <a key={p.id ?? p.url} className="ad-card" href={p.url} target="_blank" rel="noreferrer">
              <img className="ad-img" src={p.image} alt={p.name} loading="lazy" />
              <div className="ad-title">{p.name}</div>
              <div className="ad-desc">
                {p.isRocket ? '로켓배송' : '일반배송'} · {p.isFreeShipping ? '무료배송' : '배송비 확인'}
              </div>
              <div className="ad-price">{typeof p.price === 'number' ? formatWon(p.price) : '-'}</div>
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ad-embed">
      <div className="ad-embed-head">
        <span className="pill">쿠팡 파트너스</span>
        <span className="muted">{title}</span>
      </div>
      {state.status === 'loading' ? (
        <div className="muted">광고를 불러오는 중…</div>
      ) : state.status === 'error' ? (
        <div className="muted">{state.error || '광고를 불러오지 못했습니다.'}</div>
      ) : null}
      <div className="ad-fallback">
        <CoupangAd title="추천 상품" showHeader={false} />
      </div>
    </div>
  );
}

const toNumber = (value) => {
  if (value === '' || value == null) return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const parseAgeList = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((n) => (typeof n === 'string' ? parseInt(n, 10) : Number(n)))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 120)
      .slice(0, 10);
  }
  return String(raw)
    .split(/[,\s]+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 120)
    .slice(0, 10);
};

function AgeListSelect({ label, value, onChange, hint, options = [], maxItems = 10, addLabel = '추가' }) {
  const normalized = useMemo(() => parseAgeList(value), [value]);
  const effectiveOptions = options.length ? options : Array.from({ length: 121 }, (_, i) => i);
  const defaultAge = effectiveOptions[0] ?? 0;

  const updateAt = (index, nextAge) => {
    const next = normalized.slice();
    next[index] = nextAge;
    onChange(next);
  };

  const addRow = () => {
    if (normalized.length >= maxItems) return;
    onChange([...normalized, defaultAge]);
  };

  const removeAt = (index) => {
    onChange(normalized.filter((_, i) => i !== index));
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div className="age-editor">
        {normalized.length === 0 ? <div className="muted">추가 버튼을 눌러 나이를 선택해 주세요.</div> : null}
        <div className="age-list">
          {normalized.map((age, idx) => (
            <div key={`${label}-${idx}`} className="age-row">
              <select value={age} onChange={(e) => updateAt(idx, Number(e.target.value))} aria-label={`${label} ${idx + 1}`}>
                {effectiveOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}세
                  </option>
                ))}
              </select>
              <button type="button" className="icon-btn" onClick={() => removeAt(idx)} aria-label="삭제" title="삭제">
                ×
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn ghost sm" onClick={addRow} disabled={normalized.length >= maxItems}>
          {addLabel}
        </button>
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

const buildDependents = ({ spouse, childrenAges, parentAges }) => {
  const dependents = [];
  if (spouse) dependents.push({ relation: 'spouse', age: null, income: null, disabled: false });
  parseAgeList(childrenAges).forEach((age) => dependents.push({ relation: 'child', age, income: null, disabled: false }));
  parseAgeList(parentAges).forEach((age) => dependents.push({ relation: 'parent', age, income: null, disabled: false }));
  return dependents;
};

const stepOrder = ['select', 'docs', 'input', 'review'];
const stepLabels = {
  select: '계산기 선택',
  docs: '자료 확인',
  input: '입력',
  review: '결과',
};

function TaxWizard() {
  const [calculator, setCalculator] = useState(null);
  const [step, setStep] = useState('select');
  const stepIndex = Math.max(0, stepOrder.indexOf(step));
  const pct = ((stepIndex + 1) / stepOrder.length) * 100;

  const [docReady, setDocReady] = useState([]);
  const docs = calculator ? docChecklists[calculator] || [] : [];

  const [yearendInputs, setYearendInputs] = useState(() => ({
    gross_salary: '',
    withheld_income_tax: '',
    withheld_local_provided: false,
    withheld_local_tax: '',
    social_insurance: '',
    spouse: false,
    childrenAges: [],
    parentAges: [],
    self_disabled: false,
    single_parent: false,
    female_head: false,
    credit_card_spend: '',
    debit_card_spend: '',
    market_transport_spend: '',
    insurance_premiums: '',
    medical_expenses: '',
    education_k12: '',
    donations_general: '',
    rent_paid: '',
    rent_eligible: false,
  }));

  const [paystubFile, setPaystubFile] = useState(null);
  const [paystubParse, setPaystubParse] = useState(() => ({
    status: 'idle',
    message: '',
    extracted: null,
  }));

  useEffect(() => {
    if (calculator !== 'yearend') {
      setPaystubFile(null);
      setPaystubParse({ status: 'idle', message: '', extracted: null });
    }
  }, [calculator]);

  const [corporateInputs, setCorporateInputs] = useState(() => ({
    type: 'SME',
    filingYear: 2025,
    rateTable: '2025',
    netIncome: '',
    revenue: '',
    expense: '',
    lossCarryforward: '',
    prepaidTax: '',
    rdCurrent: '',
    rdIncrement: '',
    invCurrent: '',
    invAvg: '',
    otherCredit: '',
  }));

  const [financialInputs, setFinancialInputs] = useState(() => ({
    financialAmount: '',
    withholdingRate: 0.14,
    grossUpEligible: true,
    grossUpRate: 0.1,
    source: 'domestic',
    foreignTaxPaid: '',
    otherIncomeGross: '',
    otherIncomeDeductions: '',
    prepaidNational: '',
    prepaidLocal: '',
    taxCreditOther: '',
  }));

  const inputStages = useMemo(() => {
    if (calculator === 'yearend') {
      return [
        { id: 'y_income', label: '소득/원천세' },
        { id: 'y_family', label: '부양가족' },
        { id: 'y_deductions', label: '공제' },
      ];
    }
    if (calculator === 'corporate') {
      return [
        { id: 'c_basic', label: '기본' },
        { id: 'c_income', label: '손익' },
        { id: 'c_loss', label: '결손/기납부' },
        { id: 'c_credits', label: '세액공제' },
      ];
    }
    if (calculator === 'financial') {
      return [
        { id: 'f_income', label: '금융소득' },
        { id: 'f_other', label: '기타소득' },
        { id: 'f_prepaid', label: '기납부/옵션' },
      ];
    }
    return [];
  }, [calculator]);

  const [stageIndex, setStageIndex] = useState(0);
  const stage = inputStages[stageIndex]?.id || null;

  useEffect(() => {
    setStageIndex(0);
  }, [calculator]);

  const resetAll = () => {
    setCalculator(null);
    setStep('select');
    setDocReady([]);
    setStageIndex(0);
    setPaystubFile(null);
    setPaystubParse({ status: 'idle', message: '', extracted: null });
    setYearendInputs((prev) => ({ ...prev, gross_salary: '' }));
    setYearendInputs({
      gross_salary: '',
      withheld_income_tax: '',
      withheld_local_provided: false,
      withheld_local_tax: '',
      social_insurance: '',
      spouse: false,
      childrenAges: [],
      parentAges: [],
      self_disabled: false,
      single_parent: false,
      female_head: false,
      credit_card_spend: '',
      debit_card_spend: '',
      market_transport_spend: '',
      insurance_premiums: '',
      medical_expenses: '',
      education_k12: '',
      donations_general: '',
      rent_paid: '',
      rent_eligible: false,
    });
    setCorporateInputs({
      type: 'SME',
      filingYear: 2025,
      rateTable: '2025',
      netIncome: '',
      revenue: '',
      expense: '',
      lossCarryforward: '',
      prepaidTax: '',
      rdCurrent: '',
      rdIncrement: '',
      invCurrent: '',
      invAvg: '',
      otherCredit: '',
    });
    setFinancialInputs({
      financialAmount: '',
      withholdingRate: 0.14,
      grossUpEligible: true,
      grossUpRate: 0.1,
      source: 'domestic',
      foreignTaxPaid: '',
      otherIncomeGross: '',
      otherIncomeDeductions: '',
      prepaidNational: '',
      prepaidLocal: '',
      taxCreditOther: '',
    });
  };

  const parseAndApplyPaystub = async () => {
    if (!paystubFile) {
      setPaystubParse({ status: 'error', message: 'PDF 파일을 선택해 주세요.', extracted: null });
      return;
    }
    if (paystubFile.type && paystubFile.type !== 'application/pdf') {
      setPaystubParse({ status: 'error', message: 'PDF 형식의 파일만 업로드할 수 있어요.', extracted: null });
      return;
    }

    setPaystubParse({ status: 'loading', message: 'PDF를 분석 중입니다…', extracted: null });

    try {
      const pdfjsLib = await loadPdfJs();

      let result = null;
      try {
        result = await parsePaystubPdf(paystubFile, pdfjsLib);
      } catch (error) {
        const msg = String(error?.message || error).toLowerCase();
        if (msg.includes('worker')) {
          result = await parsePaystubPdf(paystubFile, pdfjsLib, { disableWorker: true });
        } else {
          throw error;
        }
      }

      if (!result?.hasText) {
        setPaystubParse({
          status: 'error',
          message: 'PDF에서 텍스트를 찾지 못했습니다. (스캔본/이미지 PDF는 인식이 어려울 수 있어요.)',
          extracted: result,
        });
        return;
      }

      const filled = [];
      const missing = [];

      if (result.grossSalary != null) filled.push('총급여');
      else missing.push('총급여');
      if (result.withheldIncomeTax != null) filled.push('소득세');
      else missing.push('소득세');
      if (result.withheldLocalTax != null) filled.push('지방소득세');
      else missing.push('지방소득세');
      if (result.socialInsurance != null) filled.push('사회보험료');
      else missing.push('사회보험료');

      setYearendInputs((prev) => {
        const next = { ...prev };
        if (result.grossSalary != null) next.gross_salary = result.grossSalary;
        if (result.withheldIncomeTax != null) next.withheld_income_tax = result.withheldIncomeTax;
        if (result.withheldLocalTax != null) {
          next.withheld_local_provided = true;
          next.withheld_local_tax = result.withheldLocalTax;
        }
        if (result.socialInsurance != null) next.social_insurance = result.socialInsurance;
        return next;
      });

      const headline = filled.length ? `자동입력 완료: ${filled.join(', ')}` : '인식된 값이 없어 자동입력하지 못했습니다.';
      const tail = missing.length ? ` (미인식: ${missing.join(', ')})` : '';
      setPaystubParse({ status: 'success', message: headline + tail, extracted: result });
    } catch (error) {
      setPaystubParse({
        status: 'error',
        message: `PDF 분석에 실패했습니다. (${error?.message ? String(error.message) : '알 수 없는 오류'})`,
        extracted: null,
      });
    }
  };

  const yearendForm = useMemo(() => {
    const base = {
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
    };

    return {
      ...base,
      gross_salary: toNumber(yearendInputs.gross_salary),
      withheld_income_tax: toNumber(yearendInputs.withheld_income_tax),
      withheld_local_provided: Boolean(yearendInputs.withheld_local_provided),
      withheld_local_tax: toNumber(yearendInputs.withheld_local_tax),
      dependents: buildDependents(yearendInputs),
      self_disabled: Boolean(yearendInputs.self_disabled),
      single_parent: Boolean(yearendInputs.single_parent),
      female_head: Boolean(yearendInputs.female_head),
      social_insurance: toNumber(yearendInputs.social_insurance),
      credit_card_spend: toNumber(yearendInputs.credit_card_spend),
      debit_card_spend: toNumber(yearendInputs.debit_card_spend),
      market_transport_spend: toNumber(yearendInputs.market_transport_spend),
      insurance_premiums: toNumber(yearendInputs.insurance_premiums),
      medical_expenses: toNumber(yearendInputs.medical_expenses),
      education_k12: toNumber(yearendInputs.education_k12),
      donations_general: toNumber(yearendInputs.donations_general),
      rent_paid: toNumber(yearendInputs.rent_paid),
      rent_eligible: Boolean(yearendInputs.rent_eligible),
    };
  }, [yearendInputs]);

  const yearendResult = useMemo(() => calculateYearEndTax(yearendForm), [yearendForm]);

  const corporatePayload = useMemo(() => {
    const revenue = toNumber(corporateInputs.revenue);
    const expense = toNumber(corporateInputs.expense);
    const netIncome =
      corporateInputs.revenue !== '' || corporateInputs.expense !== ''
        ? revenue - expense
        : toNumber(corporateInputs.netIncome);

    return {
      filingYear: Number(corporateInputs.filingYear) || 2025,
      rateTable: corporateInputs.rateTable || '2025',
      residency: 'domestic',
      shippingMode: 'none',
      shippingTonnageBase: 0,
      fiscalMonths: 12,
      tonnageShips: [],
      companyProfile: {
        type: corporateInputs.type || 'SME',
        isVenture: false,
        location: '',
        largeCorpOwnership: 0,
        equity: 0,
        debt: 0,
        isRealEstateRental: false,
      },
      roundingMode: 'round',
      financialData: {
        netIncome,
        revenue: { general: revenue, relatedParty: 0 },
        expenses: { businessPromotion: { total: 0, cultural: 0, market: 0, noProof: 0 }, vehicles: { count: 0, depreciation: 0 }, generalDepreciation: { claimed: 0, statutoryLimit: null }, nonBusiness: 0 },
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
        lossCarryforward: { totalAvailable: toNumber(corporateInputs.lossCarryforward), originYear: 2020 },
        prepaidTax: toNumber(corporateInputs.prepaidTax),
      },
      donations: { specialLimitRate: 0.5, generalLimitRate: 0.1, specialCarry: 0, specialCurrent: 0, generalCarry: 0, generalCurrent: 0 },
      credits: {
        rd: { current: toNumber(corporateInputs.rdCurrent), increment: toNumber(corporateInputs.rdIncrement), baseRate: null },
        investment: { current: toNumber(corporateInputs.invCurrent), avgThreeYear: toNumber(corporateInputs.invAvg) },
        other: toNumber(corporateInputs.otherCredit),
        foreignTax: 0,
        exemptMinTax: 0,
      },
    };
  }, [corporateInputs]);

  const corporateResult = useMemo(() => calculateCorporateTax(corporatePayload), [corporatePayload]);

  const financialInput = useMemo(() => {
    return {
      financialIncomes: [
        {
          amount: toNumber(financialInputs.financialAmount),
          withholdingRate: Number(financialInputs.withholdingRate) || 0.14,
          grossUpEligible: Boolean(financialInputs.grossUpEligible),
          source: financialInputs.source || 'domestic',
          foreignTaxPaid: toNumber(financialInputs.foreignTaxPaid),
          prepaidTax: 0,
        },
      ],
      otherIncome: {
        gross: toNumber(financialInputs.otherIncomeGross),
        deductions: toNumber(financialInputs.otherIncomeDeductions),
        items: [],
      },
      taxCredits: { other: toNumber(financialInputs.taxCreditOther) },
      prepaid: { national: toNumber(financialInputs.prepaidNational), local: toNumber(financialInputs.prepaidLocal) },
      settings: { grossUpRate: Number(financialInputs.grossUpRate) || 0.1 },
    };
  }, [financialInputs]);

  const financialResult = useMemo(() => calculateFinancialTax(financialInput), [financialInput]);

  const currentCalc = calculators.find((c) => c.id === calculator);

  const openOriginal = calculator ? `/${calculator}` : null;

  const preview = useMemo(() => {
    if (calculator === 'yearend') {
      const refund = yearendResult.outputs.refundAmount;
      const hasWithheld = yearendForm.withheld_income_tax > 0 || yearendForm.withheld_local_provided;
      const refundLabel = hasWithheld ? (refund >= 0 ? '예상 환급액' : '추가 납부') : '환급/납부(원천세 미입력)';
      return [
        { label: '결정세액', value: formatWon(yearendResult.outputs.totalDeterminedTax) },
        { label: refundLabel, value: hasWithheld ? formatWon(Math.abs(refund)) : '-' },
      ];
    }
    if (calculator === 'corporate') {
      return [
        { label: '과세표준', value: formatWon(corporateResult.taxBase) },
        { label: '최종세액', value: formatWon(corporateResult.finalTax) },
        { label: '추가 납부', value: formatWon(Math.max(corporateResult.payableTax, 0)) },
      ];
    }
    if (calculator === 'financial') {
      const methodLabel = financialResult.chosenMethod === 'comprehensive' ? '종합과세' : '분리과세';
      return [
        { label: '비교과세', value: financialResult.comparisonNote },
        { label: '선택 방식', value: methodLabel },
        { label: '총 납부세액', value: formatWon(Math.abs(financialResult.taxes.totalPayable)) },
      ];
    }
    return [];
  }, [calculator, corporateResult, financialResult, yearendForm.withheld_income_tax, yearendForm.withheld_local_provided, yearendResult.outputs.refundAmount, yearendResult.outputs.totalDeterminedTax]);

  const toggleDoc = (doc) => {
    setDocReady((prev) => (prev.includes(doc) ? prev.filter((d) => d !== doc) : [...prev, doc]));
  };

  const goNextInput = () => {
    if (stageIndex < inputStages.length - 1) setStageIndex((i) => i + 1);
    else setStep('review');
  };

  const goPrevInput = () => {
    if (stageIndex > 0) setStageIndex((i) => i - 1);
    else setStep('docs');
  };

  const CardFrame = ({ title, subtitle, children, actions }) => (
    <div className="wizard-card card-anim">
      <div className="wizard-card-head">
        <div>
          <h2 className="wizard-title">{title}</h2>
          {subtitle && <p className="muted wizard-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="wizard-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );

  const SelectCard = () => (
    <CardFrame
      title="어떤 계산을 진행할까요?"
      subtitle="각 계산은 단계별 카드로 나누어 부담을 줄였습니다."
    >
      <div className="calc-grid">
        {calculators.map((c) => (
          <button
            key={c.id}
            type="button"
            className="calc-card"
            onClick={() => {
              setCalculator(c.id);
              setDocReady([]);
              setStep('docs');
            }}
          >
            <div className="calc-name">{c.name}</div>
            <div className="calc-blurb">{c.blurb}</div>
          </button>
        ))}
      </div>
    </CardFrame>
  );

  const DocsCard = () => (
    <CardFrame
      title={`${currentCalc?.name || '계산기'} · 준비 자료`}
      subtitle="준비 여부는 체크만 해두고, 없으면 바로 다음으로 넘어가도 됩니다."
      actions={
        <button className="btn ghost" type="button" onClick={resetAll}>
          처음으로
        </button>
      }
    >
      <div className="checklist">
        {docs.map((d) => (
          <label key={d} className="check">
            <input type="checkbox" checked={docReady.includes(d)} onChange={() => toggleDoc(d)} />
            <span>{d}</span>
          </label>
        ))}
      </div>
      <div className="wizard-nav">
        <button className="btn ghost" type="button" onClick={() => setStep('select')}>
          이전
        </button>
        <button
          className="btn primary"
          type="button"
          onClick={() => {
            setStageIndex(0);
            setStep('input');
          }}
        >
          다음
        </button>
      </div>
    </CardFrame>
  );

  const SummarySideCard = () => (
    <div className="wizard-side">
      <div className="card">
        <div className="side-title">현재 결과 미리보기</div>
        <div className="side-body">
          {preview.length === 0 ? (
            <div className="muted">계산기를 선택하면 미리보기가 표시됩니다.</div>
          ) : (
            <ul className="kv">
              {preview.map((item) => (
                <li key={item.label} className="kv-row">
                  <span className="kv-label">{item.label}</span>
                  <span className="kv-value">{item.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <CoupangBestCategoryAds title="계산 중 추천" />
    </div>
  );

  const InputCard = () => {
    const SubStep = () => (
      <div className="substep">
        {inputStages.map((s, idx) => (
          <button
            key={s.id}
            type="button"
            className={`substep-pill ${idx === stageIndex ? 'active' : ''}`}
            onClick={() => setStageIndex(idx)}
          >
            {idx + 1}. {s.label}
          </button>
        ))}
      </div>
    );

    const YearendIncome = () => (
      <>
        <div className="upload-box">
          <div className="upload-head">
            <div>
              <div className="upload-title">급여명세서 PDF 자동입력(선택)</div>
              <div className="hint">PDF에서 총급여/원천세/사회보험료를 읽어와 아래 입력칸을 채웁니다.</div>
            </div>
            <span className="pill">beta</span>
          </div>
          <div className="upload-row">
            <input
              className="file-input"
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setPaystubFile(file);
                setPaystubParse({ status: 'idle', message: '', extracted: null });
              }}
            />
            <button
              className="btn primary"
              type="button"
              disabled={!paystubFile || paystubParse.status === 'loading'}
              onClick={parseAndApplyPaystub}
            >
              {paystubParse.status === 'loading' ? '분석 중…' : 'PDF 분석'}
            </button>
          </div>
          {paystubParse.status !== 'idle' && (
            <div className={`callout ${paystubParse.status === 'error' ? 'warn' : ''}`}>{paystubParse.message}</div>
          )}
        </div>
        <div className="form-grid">
          <div className="field">
            <label>총급여(원)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.gross_salary}
              onChange={(e) => setYearendInputs((p) => ({ ...p, gross_salary: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 50000000"
            />
          </div>
          <div className="field">
            <label>기납부 소득세(원, 선택)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.withheld_income_tax}
              onChange={(e) =>
                setYearendInputs((p) => ({
                  ...p,
                  withheld_income_tax: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
              placeholder="예: 3000000"
            />
          </div>
          <div className="field">
            <label className="inline">
              <input
                type="checkbox"
                checked={yearendInputs.withheld_local_provided}
                onChange={(e) => setYearendInputs((p) => ({ ...p, withheld_local_provided: e.target.checked }))}
              />
              지방소득세를 직접 입력할게요
            </label>
            <input
              inputMode="numeric"
              type="number"
              disabled={!yearendInputs.withheld_local_provided}
              value={yearendInputs.withheld_local_tax}
              onChange={(e) =>
                setYearendInputs((p) => ({
                  ...p,
                  withheld_local_tax: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
              placeholder="예: 300000"
            />
            <div className="hint">미입력 시 소득세의 10%로 자동 추정됩니다.</div>
          </div>
          <div className="field">
            <label>사회보험료 합계(원, 선택)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.social_insurance}
              onChange={(e) =>
                setYearendInputs((p) => ({
                  ...p,
                  social_insurance: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
              placeholder="예: 2500000"
            />
            <div className="hint">국민연금/건강보험/장기요양/고용보험 합계(급여명세서 PDF 자동입력 지원).</div>
          </div>
        </div>
      </>
    );

    const YearendFamily = () => (
      <>
        <div className="form-grid">
          <div className="field">
            <label className="inline">
              <input
                type="checkbox"
                checked={yearendInputs.spouse}
                onChange={(e) => setYearendInputs((p) => ({ ...p, spouse: e.target.checked }))}
              />
              배우자(기본공제 대상)
            </label>
            <div className="hint">배우자가 기본공제 대상이면 체크합니다.</div>
          </div>
          <AgeListSelect
            label="자녀 나이"
            value={yearendInputs.childrenAges}
            onChange={(next) => setYearendInputs((p) => ({ ...p, childrenAges: next }))}
            options={Array.from({ length: 26 }, (_, i) => i)}
            addLabel="자녀 추가"
            hint="자녀를 한 명씩 추가해 나이를 선택해 주세요."
          />
          <AgeListSelect
            label="부모 나이"
            value={yearendInputs.parentAges}
            onChange={(next) => setYearendInputs((p) => ({ ...p, parentAges: next }))}
            options={Array.from({ length: 61 }, (_, i) => i + 40)}
            addLabel="부모 추가"
            hint="부모를 한 명씩 추가해 나이를 선택해 주세요. (60세 이상이면 기본공제 대상일 수 있어요)"
          />
        </div>
        <div className="form-grid">
          <label className="check">
            <input
              type="checkbox"
              checked={yearendInputs.self_disabled}
              onChange={(e) => setYearendInputs((p) => ({ ...p, self_disabled: e.target.checked }))}
            />
            <span>본인 장애인 공제(해당 시)</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={yearendInputs.single_parent}
              onChange={(e) =>
                setYearendInputs((p) => ({
                  ...p,
                  single_parent: e.target.checked,
                  female_head: e.target.checked ? false : p.female_head,
                }))
              }
            />
            <span>한부모 공제(해당 시)</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={yearendInputs.female_head}
              onChange={(e) =>
                setYearendInputs((p) => ({
                  ...p,
                  female_head: e.target.checked,
                  single_parent: e.target.checked ? false : p.single_parent,
                }))
              }
            />
            <span>부녀자 공제(해당 시)</span>
          </label>
        </div>
      </>
    );

    const YearendDeductions = () => (
      <>
        <div className="form-grid">
          <div className="field">
            <label>신용카드 사용액(원)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.credit_card_spend}
              onChange={(e) => setYearendInputs((p) => ({ ...p, credit_card_spend: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 12000000"
            />
          </div>
          <div className="field">
            <label>체크카드/현금영수증(원)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.debit_card_spend}
              onChange={(e) => setYearendInputs((p) => ({ ...p, debit_card_spend: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 3000000"
            />
          </div>
          <div className="field">
            <label>전통시장/대중교통(원)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.market_transport_spend}
              onChange={(e) => setYearendInputs((p) => ({ ...p, market_transport_spend: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 500000"
            />
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>보장성 보험료(원)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.insurance_premiums}
              onChange={(e) => setYearendInputs((p) => ({ ...p, insurance_premiums: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 1200000"
            />
          </div>
          <div className="field">
            <label>의료비(원)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.medical_expenses}
              onChange={(e) => setYearendInputs((p) => ({ ...p, medical_expenses: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 2000000"
            />
          </div>
          <div className="field">
            <label>교육비(원)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.education_k12}
              onChange={(e) => setYearendInputs((p) => ({ ...p, education_k12: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 500000"
            />
          </div>
          <div className="field">
            <label>기부금(일반, 원)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.donations_general}
              onChange={(e) => setYearendInputs((p) => ({ ...p, donations_general: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 300000"
            />
          </div>
          <div className="field">
            <label>월세(원)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.rent_paid}
              onChange={(e) => setYearendInputs((p) => ({ ...p, rent_paid: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 6000000"
            />
            <label className="inline" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={yearendInputs.rent_eligible}
                onChange={(e) => setYearendInputs((p) => ({ ...p, rent_eligible: e.target.checked }))}
              />
              월세 세액공제 대상
            </label>
          </div>
        </div>
        {yearendResult.warnings?.length > 0 && (
          <div className="callout warn">
            {yearendResult.warnings.slice(0, 3).map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}
      </>
    );

    const CorporateBasic = () => (
      <div className="form-grid">
        <div className="field">
          <label>기업 유형</label>
          <select
            value={corporateInputs.type}
            onChange={(e) => setCorporateInputs((p) => ({ ...p, type: e.target.value }))}
          >
            <option value="SME">중소기업(SME)</option>
            <option value="General">일반법인</option>
          </select>
        </div>
        <div className="field">
          <label>신고 연도</label>
          <input
            inputMode="numeric"
            type="number"
            value={corporateInputs.filingYear}
            onChange={(e) => setCorporateInputs((p) => ({ ...p, filingYear: Number(e.target.value) }))}
          />
        </div>
        <div className="field">
          <label>세율 테이블</label>
          <select
            value={corporateInputs.rateTable}
            onChange={(e) => setCorporateInputs((p) => ({ ...p, rateTable: e.target.value }))}
          >
            <option value="2025">2023~2025(1구간 9%)</option>
            <option value="2018-2022">2018~2022(1구간 10%)</option>
          </select>
        </div>
      </div>
    );

    const CorporateIncome = () => (
      <>
        <div className="form-grid">
          <div className="field">
            <label>당기순이익(원)</label>
            <input
              inputMode="numeric"
              type="number"
              value={corporateInputs.netIncome}
              onChange={(e) => setCorporateInputs((p) => ({ ...p, netIncome: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 500000000"
            />
            <div className="hint">모르면 아래 매출/비용으로 입력해도 됩니다.</div>
          </div>
          <div className="field">
            <label>매출(원, 선택)</label>
            <input
              inputMode="numeric"
              type="number"
              value={corporateInputs.revenue}
              onChange={(e) => setCorporateInputs((p) => ({ ...p, revenue: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 1500000000"
            />
          </div>
          <div className="field">
            <label>비용(원, 선택)</label>
            <input
              inputMode="numeric"
              type="number"
              value={corporateInputs.expense}
              onChange={(e) => setCorporateInputs((p) => ({ ...p, expense: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 1000000000"
            />
          </div>
        </div>
      </>
    );

    const CorporateLoss = () => (
      <div className="form-grid">
        <div className="field">
          <label>이월결손금(원)</label>
          <input
            inputMode="numeric"
            type="number"
            value={corporateInputs.lossCarryforward}
            onChange={(e) =>
              setCorporateInputs((p) => ({ ...p, lossCarryforward: e.target.value === '' ? '' : Number(e.target.value) }))
            }
            placeholder="예: 100000000"
          />
        </div>
        <div className="field">
          <label>기납부세액(원천징수/중간예납)</label>
          <input
            inputMode="numeric"
            type="number"
            value={corporateInputs.prepaidTax}
            onChange={(e) => setCorporateInputs((p) => ({ ...p, prepaidTax: e.target.value === '' ? '' : Number(e.target.value) }))}
            placeholder="예: 0"
          />
        </div>
      </div>
    );

    const CorporateCredits = () => (
      <div className="form-grid">
        <div className="field">
          <label>R&D 지출(당기)</label>
          <input
            inputMode="numeric"
            type="number"
            value={corporateInputs.rdCurrent}
            onChange={(e) => setCorporateInputs((p) => ({ ...p, rdCurrent: e.target.value === '' ? '' : Number(e.target.value) }))}
            placeholder="예: 300000000"
          />
        </div>
        <div className="field">
          <label>R&D 증액분</label>
          <input
            inputMode="numeric"
            type="number"
            value={corporateInputs.rdIncrement}
            onChange={(e) => setCorporateInputs((p) => ({ ...p, rdIncrement: e.target.value === '' ? '' : Number(e.target.value) }))}
            placeholder="예: 100000000"
          />
        </div>
        <div className="field">
          <label>투자금액(당기)</label>
          <input
            inputMode="numeric"
            type="number"
            value={corporateInputs.invCurrent}
            onChange={(e) => setCorporateInputs((p) => ({ ...p, invCurrent: e.target.value === '' ? '' : Number(e.target.value) }))}
            placeholder="예: 500000000"
          />
        </div>
        <div className="field">
          <label>직전 3년 평균 투자</label>
          <input
            inputMode="numeric"
            type="number"
            value={corporateInputs.invAvg}
            onChange={(e) => setCorporateInputs((p) => ({ ...p, invAvg: e.target.value === '' ? '' : Number(e.target.value) }))}
            placeholder="예: 300000000"
          />
        </div>
        <div className="field">
          <label>기타 세액공제</label>
          <input
            inputMode="numeric"
            type="number"
            value={corporateInputs.otherCredit}
            onChange={(e) => setCorporateInputs((p) => ({ ...p, otherCredit: e.target.value === '' ? '' : Number(e.target.value) }))}
            placeholder="예: 5000000"
          />
        </div>
      </div>
    );

    const FinancialIncome = () => (
      <div className="form-grid">
        <div className="field">
          <label>금융소득 총액(이자/배당)</label>
          <input
            inputMode="numeric"
            type="number"
            value={financialInputs.financialAmount}
            onChange={(e) => setFinancialInputs((p) => ({ ...p, financialAmount: e.target.value === '' ? '' : Number(e.target.value) }))}
            placeholder="예: 24000000"
          />
        </div>
        <div className="field">
          <label>원천세율</label>
          <input
            inputMode="decimal"
            type="number"
            step="0.01"
            value={financialInputs.withholdingRate}
            onChange={(e) => setFinancialInputs((p) => ({ ...p, withholdingRate: Number(e.target.value) }))}
          />
          <div className="hint">0.14(14%)가 일반적입니다.</div>
        </div>
        <div className="field">
          <label>Gross-up 비율</label>
          <input
            inputMode="decimal"
            type="number"
            step="0.01"
            value={financialInputs.grossUpRate}
            onChange={(e) => setFinancialInputs((p) => ({ ...p, grossUpRate: Number(e.target.value) }))}
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={financialInputs.grossUpEligible}
            onChange={(e) => setFinancialInputs((p) => ({ ...p, grossUpEligible: e.target.checked }))}
          />
          <span>Gross-up 대상 배당 포함</span>
        </label>
      </div>
    );

    const FinancialOther = () => (
      <div className="form-grid">
        <div className="field">
          <label>다른 종합소득금액(금융 제외)</label>
          <input
            inputMode="numeric"
            type="number"
            value={financialInputs.otherIncomeGross}
            onChange={(e) => setFinancialInputs((p) => ({ ...p, otherIncomeGross: e.target.value === '' ? '' : Number(e.target.value) }))}
            placeholder="예: 40000000"
          />
        </div>
        <div className="field">
          <label>소득공제 합계(선택)</label>
          <input
            inputMode="numeric"
            type="number"
            value={financialInputs.otherIncomeDeductions}
            onChange={(e) =>
              setFinancialInputs((p) => ({ ...p, otherIncomeDeductions: e.target.value === '' ? '' : Number(e.target.value) }))
            }
            placeholder="예: 10000000"
          />
        </div>
      </div>
    );

    const FinancialPrepaid = () => (
      <>
        <div className="form-grid">
          <div className="field">
            <label>해외소득 여부</label>
            <select
              value={financialInputs.source}
              onChange={(e) => setFinancialInputs((p) => ({ ...p, source: e.target.value }))}
            >
              <option value="domestic">국내</option>
              <option value="foreign">해외</option>
            </select>
          </div>
          <div className="field">
            <label>외국납부세액(해외인 경우)</label>
            <input
              inputMode="numeric"
              type="number"
              value={financialInputs.foreignTaxPaid}
              onChange={(e) => setFinancialInputs((p) => ({ ...p, foreignTaxPaid: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 500000"
            />
          </div>
          <div className="field">
            <label>기납부 국세(선택)</label>
            <input
              inputMode="numeric"
              type="number"
              value={financialInputs.prepaidNational}
              onChange={(e) => setFinancialInputs((p) => ({ ...p, prepaidNational: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 0"
            />
          </div>
          <div className="field">
            <label>기납부 지방세(선택)</label>
            <input
              inputMode="numeric"
              type="number"
              value={financialInputs.prepaidLocal}
              onChange={(e) => setFinancialInputs((p) => ({ ...p, prepaidLocal: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 0"
            />
          </div>
          <div className="field">
            <label>기타 세액공제(선택)</label>
            <input
              inputMode="numeric"
              type="number"
              value={financialInputs.taxCreditOther}
              onChange={(e) => setFinancialInputs((p) => ({ ...p, taxCreditOther: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="예: 0"
            />
          </div>
        </div>
        <div className="callout">
          <div className="muted">{financialResult.comparisonNote}</div>
        </div>
      </>
    );

    const renderStage = () => {
      if (calculator === 'yearend') {
        if (stage === 'y_income') return <YearendIncome />;
        if (stage === 'y_family') return <YearendFamily />;
        return <YearendDeductions />;
      }
      if (calculator === 'corporate') {
        if (stage === 'c_basic') return <CorporateBasic />;
        if (stage === 'c_income') return <CorporateIncome />;
        if (stage === 'c_loss') return <CorporateLoss />;
        return <CorporateCredits />;
      }
      if (calculator === 'financial') {
        if (stage === 'f_income') return <FinancialIncome />;
        if (stage === 'f_other') return <FinancialOther />;
        return <FinancialPrepaid />;
      }
      return null;
    };

    return (
      <CardFrame
        title={`${currentCalc?.name || '계산기'} · 입력`}
        subtitle="필요한 정보만 카드로 나누어 입력합니다."
        actions={
          <button className="btn ghost" type="button" onClick={resetAll}>
            처음으로
          </button>
        }
      >
        <SubStep />
        {calculator === 'yearend' && stage === 'y_family' ? (
          <div className="wizard-stack">
            <div className="wizard-main">{renderStage()}</div>
            <SummarySideCard />
          </div>
        ) : (
          <div className="wizard-grid">
            <div className="wizard-main">{renderStage()}</div>
            <SummarySideCard />
          </div>
        )}
        <div className="wizard-nav">
          <button className="btn ghost" type="button" onClick={goPrevInput}>
            이전
          </button>
          <button className="btn primary" type="button" onClick={goNextInput}>
            {stageIndex < inputStages.length - 1 ? '다음' : '결과 보기'}
          </button>
        </div>
      </CardFrame>
    );
  };

  const ReviewCard = () => {
    const yearend = calculator === 'yearend' ? yearendResult : null;
    const corporate = calculator === 'corporate' ? corporateResult : null;
    const financial = calculator === 'financial' ? financialResult : null;

    return (
      <CardFrame
        title={`${currentCalc?.name || '계산기'} · 결과`}
        subtitle="입력값을 수정하려면 이전으로 돌아가세요."
        actions={
          <button className="btn ghost" type="button" onClick={resetAll}>
            다시 시작
          </button>
        }
      >
        <div className="result-grid">
          {calculator === 'yearend' && (
            <div className="result-card">
              <div className="result-title">결정세액(국세+지방)</div>
              <div className="result-value">{formatWon(yearend.outputs.totalDeterminedTax)}</div>
              <div className="result-body">
                과세표준 {formatWon(yearend.outputs.taxableIncome)}
                {'\n'}
                기납부(원천징수) {formatWon(yearend.outputs.withheldTotalTax)}
                {'\n'}
                {yearend.outputs.refundAmount >= 0 ? '예상 환급액' : '추가 납부 예상'}{' '}
                {formatWon(Math.abs(yearend.outputs.refundAmount))}
              </div>
            </div>
          )}
          {calculator === 'corporate' && (
            <div className="result-card">
              <div className="result-title">최종세액</div>
              <div className="result-value">{formatWon(corporate.finalTax)}</div>
              <div className="result-body">
                과세표준 {formatWon(corporate.taxBase)}
                {'\n'}
                산출세액 {formatWon(corporate.calculatedTax)}
                {'\n'}
                최저한세 {formatWon(corporate.minimumTax)}
                {'\n'}
                기납부세액 {formatWon(corporate.prepaidTax)}
                {'\n'}
                {corporate.payableTax >= 0 ? '추가 납부' : '환급/차감'} {formatWon(Math.abs(corporate.payableTax))}
              </div>
            </div>
          )}
          {calculator === 'financial' && (
            <div className="result-card">
              <div className="result-title">비교과세 결과</div>
              <div className="result-value">{financial.chosenMethod === 'comprehensive' ? '종합과세' : '분리과세'}</div>
              <div className="result-body">
                {financial.comparisonNote}
                {'\n'}
                금융소득 {formatWon(financial.financialTotal)}
                {'\n'}
                총 납부세액 {formatWon(Math.abs(financial.taxes.totalPayable))}
              </div>
            </div>
          )}
        </div>

        {openOriginal && (
          <div className="callout">
            <div className="muted">정밀 입력이 필요하면 원본 계산기를 열어 사용할 수 있어요.</div>
            <div className="actions">
              <a className="btn primary" href={openOriginal}>
                원본 계산기 열기
              </a>
              <button className="btn ghost" type="button" onClick={() => setStep('input')}>
                입력 수정
              </button>
            </div>
          </div>
        )}

        <CoupangBestCategoryAds title="추천 상품" />
      </CardFrame>
    );
  };

  const cardKey = `${step}-${calculator ?? 'none'}-${stage ?? 'none'}`;

  return (
    <section className="shell">
      <div className="wizard-wrap">
        <div className="chat-head">
          <div className="progress">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="stepper">
            {stepOrder.map((s, i) => (
              <div key={s} className={`step ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'completed' : ''}`}>
                {i + 1}단계 · {stepLabels[s]}
              </div>
            ))}
          </div>
        </div>

        <div key={cardKey} className="wizard-body">
          {step === 'select' && <SelectCard />}
          {step === 'docs' && <DocsCard />}
          {step === 'input' && <InputCard />}
          {step === 'review' && <ReviewCard />}
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
      <p className="muted">원본 계산기 화면입니다. 카드형 위저드가 부족한 항목은 여기서 입력할 수 있어요.</p>
      <div className="actions">
        <a className="btn primary" href={src} target="_blank" rel="noreferrer">
          새 창에서 열기
        </a>
        <a className="btn ghost" href="/">
          홈으로
        </a>
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
          <p className="pill">카드형 단계 진행</p>
          <h1>단계별 카드로 세금 계산을 진행합니다</h1>
          <p className="lede">복잡한 입력을 한 번에 보여주지 않고, 필요한 항목만 카드로 나눠서 입력합니다.</p>
          <div className="hero-badges">
            <span className="pill">Progressive Disclosure</span>
            <span className="pill">결과 실시간 미리보기</span>
            <span className="pill">원본 계산기 옵션</span>
          </div>
        </div>
      </header>
      <TaxWizard />
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
