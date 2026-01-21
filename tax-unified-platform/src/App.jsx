import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import {
  calculateCorporateTax,
  calculateFinancialTax,
  calculateYearEndTax,
  FINANCIAL_RULES,
  formatSignedWon,
  formatWon,
} from './lib/tax-calculations';
import { createShareImageDataUrl } from './lib/share-image';
import { getTaxGamification } from './lib/tax-gamification';
import { parsePaystubPdf } from './lib/paystub-parser';
import {
  parseCorporateFinancialStatementPdf,
  parseCorporateTaxReturnPdf,
} from './lib/corporate-pdf-parser';

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

function CardFrame({ title, subtitle, children, actions }) {
  return (
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
}

const COUPANG_POOL_CACHE_KEY = 'tax3.coupangPoolCache.v1';
const COUPANG_POOL_CACHE_TTL_MS = 1000 * 60 * 60 * 48;

const readCoupangPoolCache = () => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(COUPANG_POOL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const products = Array.isArray(parsed?.products) ? parsed.products : null;
    if (!products?.length) return null;
    const ts = typeof parsed?.ts === 'number' ? parsed.ts : Date.parse(parsed?.fetchedAt || '');
    if (Number.isFinite(ts) && Date.now() - ts > COUPANG_POOL_CACHE_TTL_MS) return null;
    return products;
  } catch {
    return null;
  }
};

const writeCoupangPoolCache = (products) => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const payload = { ts: Date.now(), products };
    window.localStorage.setItem(COUPANG_POOL_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
};

const COUPANG_ROTATE_INTERVAL_MS = 10_000;
let coupangProductCursor = Math.floor(Math.random() * 1_000_000);
const COUPANG_PRODUCT_CURSOR_KEY = 'tax3.coupangProductCursor';

const modIndex = (value, total) => ((value % total) + total) % total;

const getRotationStartIndex = ({ total, storageKey, fallbackState, step = 1 }) => {
  if (!total) return 0;
  const normalizedStep = Number.isFinite(step) && step > 0 ? Math.floor(step) : 1;

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(storageKey);
      const stored = raw == null ? NaN : parseInt(raw, 10);
      const start = Number.isFinite(stored) ? modIndex(stored, total) : Math.floor(Math.random() * total);
      window.localStorage.setItem(storageKey, String(modIndex(start + normalizedStep, total)));
      return start;
    }
  } catch {
    // ignore localStorage failures and fall back to in-memory cursor
  }

  const start = modIndex(fallbackState.value, total);
  fallbackState.value = modIndex(start + normalizedStep, total);
  return start;
};

const getProductRotationStartIndex = (total, step) =>
  getRotationStartIndex({
    total,
    storageKey: COUPANG_PRODUCT_CURSOR_KEY,
    fallbackState: {
      get value() {
        return coupangProductCursor;
      },
      set value(v) {
        coupangProductCursor = v;
      },
    },
    step,
  });

const pickRotated = (items, count) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (items.length <= count) return items.slice(0, count);
  const start = getProductRotationStartIndex(items.length, count);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(items[(start + i) % items.length]);
  }
  return out;
};

const pickRotatedDistinctGroups = (items, count) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (items.length <= count) return items.slice(0, count);

  const start = getProductRotationStartIndex(items.length, count);
  const picked = [];
  const usedGroups = new Set();
  const usedKeys = new Set();

  for (let i = 0; i < items.length && picked.length < count; i += 1) {
    const item = items[(start + i) % items.length];
    const groupKey = item?.groupId || item?.groupLabel || '';
    if (groupKey && usedGroups.has(groupKey)) continue;
    const uniq = item?.url || item?.id || `${groupKey}:${i}`;
    if (usedKeys.has(uniq)) continue;
    usedKeys.add(uniq);
    if (groupKey) usedGroups.add(groupKey);
    picked.push(item);
  }

  if (picked.length < count) {
    for (let i = 0; i < items.length && picked.length < count; i += 1) {
      const item = items[(start + i) % items.length];
      const uniq = item?.url || item?.id || i;
      if (usedKeys.has(uniq)) continue;
      usedKeys.add(uniq);
      picked.push(item);
    }
  }

  return picked.slice(0, count);
};

function CoupangBestCategoryAds({ title = '추천 상품' }) {
  const [state, setState] = useState(() => ({
    status: 'idle',
    products: [],
    error: null,
  }));
  const poolRef = useRef([]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const desiredCount = 4;
    const cached = readCoupangPoolCache();
    if (cached?.length) {
      poolRef.current = cached;
      setState({ status: 'success', products: pickRotatedDistinctGroups(cached, desiredCount), error: null });
    } else {
      setState({ status: 'loading', products: [], error: null });
    }

    const load = async () => {
      try {
        const res = await fetch('/api/coupang/pool?limit=60', {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });

        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');
        const data = isJson ? await res.json().catch(() => ({})) : {};

        if (!active) return;
        if (!res.ok || !isJson || !data?.ok) {
          if (!cached?.length) setState({ status: 'error', products: [], error: '광고 데이터를 불러오지 못했습니다.' });
          return;
        }

        const pool = Array.isArray(data?.products) ? data.products : [];
        if (!pool.length) {
          if (!cached?.length) setState({ status: 'error', products: [], error: '광고 데이터를 불러오지 못했습니다.' });
          return;
        }

        poolRef.current = pool;
        writeCoupangPoolCache(pool);
        setState({ status: 'success', products: pickRotatedDistinctGroups(pool, desiredCount), error: null });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (!active) return;
        if (!cached?.length) setState({ status: 'error', products: [], error: '광고 데이터를 불러오지 못했습니다.' });
        return;
      }
    };

    load();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'success') return undefined;
    if (!poolRef.current.length) return undefined;

    const tick = () => {
      setState((prev) => {
        if (prev.status !== 'success') return prev;
        const pool = poolRef.current;
        if (!pool.length) return prev;
        return { ...prev, products: pickRotatedDistinctGroups(pool, 4) };
      });
    };

    const intervalId = window.setInterval(tick, COUPANG_ROTATE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [state.status]);

  if (state.status === 'success' && state.products.length > 0) {
    return (
      <div className="ad-embed">
        <div className="ad-embed-head">
          <span className="pill">쿠팡 파트너스</span>
          <span className="muted">{title}</span>
        </div>
        <div className="ad-disclosure">
          이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
        </div>
        <div className="ads">
          {state.products.map((p) => (
            <a key={p.id ?? p.url} className="ad-card" href={p.url} target="_blank" rel="noreferrer">
              <img className="ad-img" src={p.image} alt={p.name} loading="lazy" />
              <div className="ad-title">{p.name}</div>
              <div className="ad-desc">
                {p.groupLabel ? `${p.groupLabel} · ` : ''}
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
      <div className="ad-disclosure">
        이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
      </div>
      {state.status === 'loading' ? (
        <div className="muted">광고를 불러오는 중…</div>
      ) : state.status === 'error' ? (
        <div className="muted">{state.error || '광고를 불러오지 못했습니다.'}</div>
      ) : null}
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

function TaxWizard({ initialCalculator = null }) {
  const normalizedInitial =
    calculators.some((c) => c.id === initialCalculator) ? initialCalculator : null;
  const [calculator, setCalculator] = useState(normalizedInitial);
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
    pension_savings: '',
    irp_contribution: '',
    isa_transfer: '',
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

  const [corporateFsFile, setCorporateFsFile] = useState(null);
  const [corporateFsParse, setCorporateFsParse] = useState(() => ({
    status: 'idle',
    message: '',
    extracted: null,
  }));

  const [corporateReturnFile, setCorporateReturnFile] = useState(null);
  const [corporateReturnParse, setCorporateReturnParse] = useState(() => ({
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

  useEffect(() => {
    if (calculator !== 'corporate') {
      setCorporateFsFile(null);
      setCorporateFsParse({ status: 'idle', message: '', extracted: null });
      setCorporateReturnFile(null);
      setCorporateReturnParse({ status: 'idle', message: '', extracted: null });
    }
  }, [calculator]);

  const [corporateInputs, setCorporateInputs] = useState(() => ({
    type: 'SME',
    filingYear: 2025,
    rateTable: '2025',
    baseMode: 'pbt',
    netIncome: '',
    revenue: '',
    expense: '',
    taxAdjustmentAdd: '',
    taxAdjustmentDeduct: '',
    lossCarryforward: '',
    prepaidTax: '',
    rdCurrent: '',
    rdIncrement: '',
    invCurrent: '',
    invAvg: '',
    otherCredit: '',
  }));

  const [financialInputs, setFinancialInputs] = useState(() => ({
    interestAmount: '',
    dividendAmount: '',
    withholdingRate: 0.14,
    dividendGrossUpEligible: true,
    grossUpRate: 0.1,
    interestSource: 'domestic',
    dividendSource: 'domestic',
    foreignTaxPaidInterest: '',
    foreignTaxPaidDividend: '',
    otherMode: 'simple',
    otherIncomeGross: '',
    personalDeductionPeople: 1,
    otherIncomeDeductions: '',
    otherItems: [],
    freelancerGross: '',
    healthInsuranceProfile: 'unknown',
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
        { id: 'f_other', label: '다른소득·경비' },
        { id: 'f_prepaid', label: '기납부·리스크' },
      ];
    }
    return [];
  }, [calculator]);

  const [stageIndex, setStageIndex] = useState(0);
  const stage = inputStages[stageIndex]?.id || null;

  useEffect(() => {
    setStageIndex(0);
  }, [calculator]);

  const [shareState, setShareState] = useState(() => ({
    status: 'idle',
    url: '',
    error: '',
    copied: false,
  }));
  const [shareModalOpen, setShareModalOpen] = useState(false);

  useEffect(() => {
    if (step !== 'review') {
      setShareState({ status: 'idle', url: '', error: '', copied: false });
      setShareModalOpen(false);
    }
  }, [step, calculator]);

  const resetAll = () => {
    setCalculator(normalizedInitial);
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
      pension_savings: '',
      irp_contribution: '',
      isa_transfer: '',
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
      baseMode: 'pbt',
      netIncome: '',
      revenue: '',
      expense: '',
      taxAdjustmentAdd: '',
      taxAdjustmentDeduct: '',
      lossCarryforward: '',
      prepaidTax: '',
      rdCurrent: '',
      rdIncrement: '',
      invCurrent: '',
      invAvg: '',
      otherCredit: '',
    });
    setFinancialInputs({
      interestAmount: '',
      dividendAmount: '',
      withholdingRate: 0.14,
      dividendGrossUpEligible: true,
      grossUpRate: 0.1,
      interestSource: 'domestic',
      dividendSource: 'domestic',
      foreignTaxPaidInterest: '',
      foreignTaxPaidDividend: '',
      otherMode: 'simple',
      otherIncomeGross: '',
      personalDeductionPeople: 1,
      otherIncomeDeductions: '',
      otherItems: [],
      freelancerGross: '',
      healthInsuranceProfile: 'unknown',
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

  const parseAndApplyCorporateFs = async () => {
    if (!corporateFsFile) {
      setCorporateFsParse({ status: 'error', message: 'PDF 파일을 선택해 주세요.', extracted: null });
      return;
    }
    if (corporateFsFile.type && corporateFsFile.type !== 'application/pdf') {
      setCorporateFsParse({ status: 'error', message: 'PDF 형식의 파일만 업로드할 수 있어요.', extracted: null });
      return;
    }

    setCorporateFsParse({ status: 'loading', message: 'PDF를 분석 중입니다…', extracted: null });

    try {
      const pdfjsLib = await loadPdfJs();
      let result = null;
      try {
        result = await parseCorporateFinancialStatementPdf(corporateFsFile, pdfjsLib);
      } catch (error) {
        const msg = String(error?.message || error).toLowerCase();
        if (msg.includes('worker')) {
          result = await parseCorporateFinancialStatementPdf(corporateFsFile, pdfjsLib, { disableWorker: true });
        } else {
          throw error;
        }
      }

      if (!result?.hasText) {
        setCorporateFsParse({
          status: 'error',
          message: 'PDF에서 텍스트를 찾지 못했습니다. (스캔본/이미지 PDF는 인식이 어려울 수 있어요.)',
          extracted: result,
        });
        return;
      }

      const filled = [];
      if (result.sales != null) filled.push('매출액');
      if (result.profitBeforeTax != null) filled.push('법인세차감전이익');
      if (result.netIncome != null) filled.push('당기순이익');

      setCorporateInputs((prev) => {
        const next = { ...prev, baseMode: 'pbt' };
        if (result.sales != null) next.revenue = result.sales;
        if (result.profitBeforeTax != null) next.netIncome = result.profitBeforeTax;
        return next;
      });

      setCorporateFsParse({
        status: 'success',
        message: filled.length ? `추출 완료: ${filled.join(', ')} 입력칸에 반영했습니다.` : 'PDF에서 유효한 금액을 찾지 못했습니다.',
        extracted: result,
      });
    } catch (error) {
      setCorporateFsParse({
        status: 'error',
        message: `PDF 분석 중 오류가 발생했습니다: ${String(error?.message || error)}`,
        extracted: null,
      });
    }
  };

  const parseAndApplyCorporateReturn = async () => {
    if (!corporateReturnFile) {
      setCorporateReturnParse({ status: 'error', message: 'PDF 파일을 선택해 주세요.', extracted: null });
      return;
    }
    if (corporateReturnFile.type && corporateReturnFile.type !== 'application/pdf') {
      setCorporateReturnParse({ status: 'error', message: 'PDF 형식의 파일만 업로드할 수 있어요.', extracted: null });
      return;
    }

    setCorporateReturnParse({ status: 'loading', message: 'PDF를 분석 중입니다…', extracted: null });

    try {
      const pdfjsLib = await loadPdfJs();
      let result = null;
      try {
        result = await parseCorporateTaxReturnPdf(corporateReturnFile, pdfjsLib);
      } catch (error) {
        const msg = String(error?.message || error).toLowerCase();
        if (msg.includes('worker')) {
          result = await parseCorporateTaxReturnPdf(corporateReturnFile, pdfjsLib, { disableWorker: true });
        } else {
          throw error;
        }
      }

      if (!result?.hasText) {
        setCorporateReturnParse({
          status: 'error',
          message: 'PDF에서 텍스트를 찾지 못했습니다. (스캔본/이미지 PDF는 인식이 어려울 수 있어요.)',
          extracted: result,
        });
        return;
      }

      const filled = [];
      if (result.taxBase != null) filled.push('과세표준');
      if (result.prepaidTax != null) filled.push('기납부세액');
      if (result.creditTotal != null) filled.push('세액공제(추정)');

      setCorporateInputs((prev) => {
        const next = { ...prev, baseMode: 'taxBase' };
        next.rateTable = '2018-2022';
        next.filingYear = 2021;
        if (result.taxBase != null) next.netIncome = result.taxBase;
        if (result.prepaidTax != null) next.prepaidTax = result.prepaidTax;
        if (result.creditTotal != null) next.otherCredit = result.creditTotal;
        return next;
      });

      setCorporateReturnParse({
        status: 'success',
        message: filled.length
          ? `추출 완료: ${filled.join(', ')} 입력칸에 반영했습니다.`
          : 'PDF에서 유효한 금액을 찾지 못했습니다.',
        extracted: result,
      });
    } catch (error) {
      setCorporateReturnParse({
        status: 'error',
        message: `PDF 분석 중 오류가 발생했습니다: ${String(error?.message || error)}`,
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
      pension_contribution: toNumber(yearendInputs.pension_savings) + toNumber(yearendInputs.irp_contribution),
      pension_with_irp: toNumber(yearendInputs.irp_contribution) > 0,
      isa_transfer: toNumber(yearendInputs.isa_transfer),
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
    const baseMode = corporateInputs.baseMode || 'pbt';
    const revenue = toNumber(corporateInputs.revenue);
    const expense = toNumber(corporateInputs.expense);
    const netIncome =
      baseMode === 'taxBase'
        ? toNumber(corporateInputs.netIncome)
        : corporateInputs.revenue !== '' && corporateInputs.expense !== ''
          ? revenue - expense
          : toNumber(corporateInputs.netIncome);
    const taxAdjustmentAdd = baseMode === 'taxBase' ? 0 : toNumber(corporateInputs.taxAdjustmentAdd);
    const taxAdjustmentDeduct = baseMode === 'taxBase' ? 0 : toNumber(corporateInputs.taxAdjustmentDeduct);
    const lossCarryforward = baseMode === 'taxBase' ? 0 : toNumber(corporateInputs.lossCarryforward);

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
      roundingMode: 'floor',
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
        manualIncomeAdd: taxAdjustmentAdd,
        manualIncomeExclude: taxAdjustmentDeduct,
        manualExpenseDisallow: 0,
        manualExpenseAllow: 0,
        lossCarryforward: { totalAvailable: lossCarryforward, originYear: 2020 },
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
    const withholdingRate = Number(financialInputs.withholdingRate) || 0.14;
    const interestAmount = toNumber(financialInputs.interestAmount);
    const dividendAmount = toNumber(financialInputs.dividendAmount);

    const people = Math.max(1, Math.min(10, parseInt(financialInputs.personalDeductionPeople, 10) || 1));
    const personalDeduction = people * 1_500_000;
    const extraIncomeDeductions = toNumber(financialInputs.otherIncomeDeductions);
    const incomeDeductionsTotal = personalDeduction + extraIncomeDeductions;

    const financialIncomes = [
      {
        amount: dividendAmount,
        withholdingRate,
        grossUpEligible: Boolean(financialInputs.dividendGrossUpEligible),
        source: financialInputs.dividendSource || 'domestic',
        foreignTaxPaid: toNumber(financialInputs.foreignTaxPaidDividend),
        prepaidTax: 0,
      },
      {
        amount: interestAmount,
        withholdingRate,
        grossUpEligible: false,
        source: financialInputs.interestSource || 'domestic',
        foreignTaxPaid: toNumber(financialInputs.foreignTaxPaidInterest),
        prepaidTax: 0,
      },
    ].filter((item) => item.amount > 0);

    const otherItems = Array.isArray(financialInputs.otherItems) ? financialInputs.otherItems : [];
    const normalizedOtherItems = otherItems.map((item) => ({
      type: item.type || 'business',
      label: item.label || '',
      amount: toNumber(item.amount),
      expenseMode: item.expenseMode || 'standard',
      expenseRate:
        item.expenseMode === 'standard'
          ? item.expenseRate === '' || item.expenseRate == null
            ? undefined
            : Number(item.expenseRate)
          : undefined,
      expenseAmount: item.expenseMode === 'actual' ? toNumber(item.expenseAmount) : undefined,
      separate: Boolean(item.separate),
      separateRate:
        item.separate && !(item.separateRate === '' || item.separateRate == null) ? Number(item.separateRate) : undefined,
      deposit: toNumber(item.deposit),
      houseCount: item.houseCount === '' || item.houseCount == null ? undefined : Number(item.houseCount),
      months: item.months === '' || item.months == null ? undefined : Number(item.months),
      prepaidTax: 0,
    }));

    const otherMode = financialInputs.otherMode || 'simple';

    return {
      financialIncomes,
      otherIncome: {
        gross: otherMode === 'simple' ? toNumber(financialInputs.otherIncomeGross) : 0,
        deductions: incomeDeductionsTotal,
        items: otherMode === 'items' ? normalizedOtherItems : [],
      },
      taxCredits: { other: toNumber(financialInputs.taxCreditOther) },
      prepaid: { national: toNumber(financialInputs.prepaidNational), local: toNumber(financialInputs.prepaidLocal) },
      settings: { grossUpRate: Number(financialInputs.grossUpRate) || 0.1 },
    };
  }, [financialInputs]);

  const financialResult = useMemo(() => calculateFinancialTax(financialInput), [financialInput]);

  const gamification = useMemo(() => {
    if (calculator === 'yearend') {
      return getTaxGamification({ calculatorId: 'yearend', netBenefitWon: yearendResult.outputs.refundAmount });
    }
    if (calculator === 'corporate') {
      return getTaxGamification({ calculatorId: 'corporate', netBenefitWon: -corporateResult.payableTax });
    }
    if (calculator === 'financial') {
      return getTaxGamification({ calculatorId: 'financial', netBenefitWon: -financialResult.taxes.totalPayable });
    }
    return null;
  }, [calculator, corporateResult.payableTax, financialResult.taxes.totalPayable, yearendResult.outputs.refundAmount]);

  const shareDraft = useMemo(() => {
    if (calculator === 'yearend') {
      const refund = yearendResult?.outputs?.refundAmount ?? 0;
      const outcomeLabel = refund >= 0 ? '환급' : '납부';
      const amountText = formatWon(Math.abs(refund));
      const title = `연말정산 · ${outcomeLabel} ${amountText} · ${gamification?.tier ?? '-'}등급`;
      const subtitle = gamification?.tagline ? String(gamification.tagline) : '';
      return {
        calculatorId: 'yearend',
        targetPath: '/yearend-tax',
        title,
        subtitle,
        tier: gamification?.tier,
        tierTitle: gamification?.title,
        tierTagline: gamification?.tagline,
        primaryLabel: outcomeLabel,
        primaryValue: amountText,
        lines: [],
      };
    }

    if (calculator === 'corporate') {
      const payable = corporateResult?.payableTax ?? 0;
      const outcomeLabel = payable >= 0 ? '납부' : '환급';
      const amountText = formatWon(Math.abs(payable));
      const title = `법인세 · ${outcomeLabel} ${amountText} · ${gamification?.tier ?? '-'}등급`;
      const subtitle = gamification?.tagline ? String(gamification.tagline) : '';
      return {
        calculatorId: 'corporate',
        targetPath: '/corporate-tax',
        title,
        subtitle,
        tier: gamification?.tier,
        tierTitle: gamification?.title,
        tierTagline: gamification?.tagline,
        primaryLabel: outcomeLabel,
        primaryValue: amountText,
        lines: [],
      };
    }

    if (calculator === 'financial') {
      const payable = financialResult?.taxes?.totalPayable ?? 0;
      const method = financialResult?.chosenMethod === 'comprehensive' ? '종합과세' : '분리과세';
      const outcomeLabel = payable >= 0 ? '납부' : '환급';
      const amountText = formatWon(Math.abs(payable));
      const title = `종합소득세 · ${outcomeLabel} ${amountText} · ${gamification?.tier ?? '-'}등급`;
      const subtitle = `선택: ${method}`;
      return {
        calculatorId: 'financial',
        targetPath: '/income-tax',
        title,
        subtitle,
        tier: gamification?.tier,
        tierTitle: gamification?.title,
        tierTagline: gamification?.tagline,
        primaryLabel: outcomeLabel,
        primaryValue: amountText,
        lines: [],
      };
    }

    return null;
  }, [calculator, yearendResult, corporateResult, financialResult, gamification]);

  const copyShareUrl = async (urlToCopy) => {
    const text = String(urlToCopy || '').trim();
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  };

  const createShareLink = async () => {
    if (!shareDraft) return;
    setShareState({ status: 'loading', url: '', error: '', copied: false });

    try {
      const imageDataUrl = await createShareImageDataUrl({
        title: shareDraft.title,
        subtitle: shareDraft.subtitle,
        lines: shareDraft.lines,
        tier: gamification,
        primaryLabel: shareDraft.primaryLabel,
        primaryValue: shareDraft.primaryValue,
        footerTitle: '',
        footerText: '',
        footnote: '',
      });

      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...shareDraft, imageDataUrl }),
      });

      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json().catch(() => ({})) : {};
      if (!res.ok || !data?.ok || !data?.url) {
        throw new Error(data?.error || '공유 링크 생성에 실패했습니다.');
      }

      const url = String(data.url);
      setShareState({ status: 'success', url, error: '', copied: false });
    } catch (error) {
      setShareState({
        status: 'error',
        url: '',
        error: error?.message || '공유 링크 생성에 실패했습니다.',
        copied: false,
      });
    }
  };

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
      const payable = financialResult.taxes.totalPayable;
      const payableLabel = payable >= 0 ? '추가 납부' : '환급 예상';
      return [
        { label: '비교과세', value: financialResult.comparisonNote },
        { label: '선택 방식', value: methodLabel },
        { label: payableLabel, value: formatWon(Math.abs(payable)) },
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

  const SelectCard = () => (
    <CardFrame
      title="어떤 계산을 진행할까요?"
      subtitle="각 계산은 단계별 카드로 나누어 부담을 줄였습니다."
    >
      {calculator ? (
        <div className="callout">
          <div className="muted">
            {currentCalc?.name || '선택한 계산기'}로 시작합니다. 변경하려면 아래에서 다른 계산기를 선택하세요.
          </div>
          <div className="actions">
            <button className="btn primary" type="button" onClick={() => setStep('docs')}>
              다음
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setStageIndex(0);
                setStep('input');
              }}
            >
              입력 바로가기
            </button>
          </div>
        </div>
      ) : null}
      <div className="calc-grid">
        {calculators.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`calc-card ${calculator === c.id ? 'active' : ''}`}
            aria-pressed={calculator === c.id}
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
              id="paystub-pdf"
              className="file-input-hidden"
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setPaystubFile(file);
                setPaystubParse({ status: 'idle', message: '', extracted: null });
              }}
            />
            <label className="btn ghost" htmlFor="paystub-pdf">
              {paystubFile ? 'PDF 변경' : 'PDF 선택'}
            </label>
            <div className={`file-display ${paystubFile ? '' : 'muted'}`} title={paystubFile?.name || ''}>
              {paystubFile ? paystubFile.name : '선택된 파일 없음'}
            </div>
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
            <label>연금저축 납입액(원, 선택)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.pension_savings}
              onChange={(e) =>
                setYearendInputs((p) => ({ ...p, pension_savings: e.target.value === '' ? '' : Number(e.target.value) }))
              }
              placeholder="예: 4000000"
            />
          </div>
          <div className="field">
            <label>IRP 납입액(원, 선택)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.irp_contribution}
              onChange={(e) =>
                setYearendInputs((p) => ({ ...p, irp_contribution: e.target.value === '' ? '' : Number(e.target.value) }))
              }
              placeholder="예: 3000000"
            />
          </div>
          <div className="field">
            <label>ISA 만기자금 연금계좌 전환액(원, 선택)</label>
            <input
              inputMode="numeric"
              type="number"
              value={yearendInputs.isa_transfer}
              onChange={(e) =>
                setYearendInputs((p) => ({ ...p, isa_transfer: e.target.value === '' ? '' : Number(e.target.value) }))
              }
              placeholder="예: 0"
            />
            <div className="hint">
              연금계좌 세액공제는 납입액 한도 내에서 적용됩니다(총급여 5,500만원 이하면 15%, 초과는 12%).
            </div>
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
        <div className="field">
          <label>입력 기준</label>
          <select
            value={corporateInputs.baseMode}
            onChange={(e) => setCorporateInputs((p) => ({ ...p, baseMode: e.target.value }))}
          >
            <option value="pbt">재무제표(법인세차감전이익) 기준</option>
            <option value="taxBase">신고서(과세표준) 직접입력</option>
          </select>
          <div className="hint">재무제표만으로는 세무조정이 필요할 수 있어요.</div>
        </div>
      </div>
    );

    const CorporateIncome = () => (
      <>
        <div className="upload-box">
          <div className="upload-head">
            <div>
              <div className="upload-title">재무제표 PDF 자동입력(선택)</div>
              <div className="hint">매출액/법인세차감전이익을 읽어와 아래 입력칸을 채웁니다.</div>
            </div>
            <span className="pill">beta</span>
          </div>
          <div className="upload-row">
            <input
              id="corporate-fs-pdf"
              className="file-input-hidden"
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setCorporateFsFile(file);
                setCorporateFsParse({ status: 'idle', message: '', extracted: null });
              }}
            />
            <label className="btn ghost" htmlFor="corporate-fs-pdf">
              {corporateFsFile ? 'PDF 변경' : 'PDF 선택'}
            </label>
            <div className={`file-display ${corporateFsFile ? '' : 'muted'}`} title={corporateFsFile?.name || ''}>
              {corporateFsFile ? corporateFsFile.name : '선택된 파일 없음'}
            </div>
            <button
              className="btn primary"
              type="button"
              disabled={!corporateFsFile || corporateFsParse.status === 'loading'}
              onClick={parseAndApplyCorporateFs}
            >
              {corporateFsParse.status === 'loading' ? '분석 중…' : 'PDF 분석'}
            </button>
          </div>
          {corporateFsParse.status !== 'idle' && (
            <div className={`callout ${corporateFsParse.status === 'error' ? 'warn' : ''}`}>{corporateFsParse.message}</div>
          )}
        </div>
        <div className="upload-box">
          <div className="upload-head">
            <div>
              <div className="upload-title">법인세 신고서 PDF 자동입력(선택)</div>
              <div className="hint">과세표준/기납부세액/세액공제(산출-총부담)를 읽어옵니다.</div>
            </div>
            <span className="pill">beta</span>
          </div>
          <div className="upload-row">
            <input
              id="corporate-return-pdf"
              className="file-input-hidden"
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setCorporateReturnFile(file);
                setCorporateReturnParse({ status: 'idle', message: '', extracted: null });
              }}
            />
            <label className="btn ghost" htmlFor="corporate-return-pdf">
              {corporateReturnFile ? 'PDF 변경' : 'PDF 선택'}
            </label>
            <div
              className={`file-display ${corporateReturnFile ? '' : 'muted'}`}
              title={corporateReturnFile?.name || ''}
            >
              {corporateReturnFile ? corporateReturnFile.name : '선택된 파일 없음'}
            </div>
            <button
              className="btn primary"
              type="button"
              disabled={!corporateReturnFile || corporateReturnParse.status === 'loading'}
              onClick={parseAndApplyCorporateReturn}
            >
              {corporateReturnParse.status === 'loading' ? '분석 중…' : 'PDF 분석'}
            </button>
          </div>
          {corporateReturnParse.status !== 'idle' && (
            <div className={`callout ${corporateReturnParse.status === 'error' ? 'warn' : ''}`}>{corporateReturnParse.message}</div>
          )}
        </div>
        {corporateFsParse.extracted?.profitBeforeTax != null && corporateReturnParse.extracted?.taxBase != null ? (
          <div className="callout">
            <div className="muted">
              PDF 비교(참고): 손익계산서 법인세차감전이익 {formatWon(corporateFsParse.extracted.profitBeforeTax)} vs 신고서 과세표준{' '}
              {formatWon(corporateReturnParse.extracted.taxBase)} (차이 {formatSignedWon(corporateReturnParse.extracted.taxBase - corporateFsParse.extracted.profitBeforeTax)}
              )
            </div>
          </div>
        ) : null}
        <div className="form-grid">
          <div className="field">
            <label>
              {corporateInputs.baseMode === 'taxBase' ? '과세표준(원)' : '법인세비용차감전이익(원)'}
            </label>
            <input
              inputMode="numeric"
              type="number"
              value={corporateInputs.netIncome}
              onChange={(e) => setCorporateInputs((p) => ({ ...p, netIncome: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder={corporateInputs.baseMode === 'taxBase' ? '예: 90000000' : '예: 50000000'}
            />
            {corporateInputs.baseMode === 'taxBase' ? (
              <div className="hint">신고서의 ‘과세표준’ 값을 그대로 입력합니다.</div>
            ) : (
              <div className="hint">손익계산서의 ‘법인세차감전이익’을 입력하세요. (모르면 아래 매출/비용으로 추정)</div>
            )}
          </div>
          {corporateInputs.baseMode !== 'taxBase' ? (
            <>
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
              <div className="field">
                <label>세무조정 가산(+)(선택)</label>
                <input
                  inputMode="numeric"
                  type="number"
                  value={corporateInputs.taxAdjustmentAdd}
                  onChange={(e) =>
                    setCorporateInputs((p) => ({ ...p, taxAdjustmentAdd: e.target.value === '' ? '' : Number(e.target.value) }))
                  }
                  placeholder="예: 10000000"
                />
                <div className="hint">익금산입/손금불산입 등 과세소득에 더해지는 금액</div>
              </div>
              <div className="field">
                <label>세무조정 차감(-)(선택)</label>
                <input
                  inputMode="numeric"
                  type="number"
                  value={corporateInputs.taxAdjustmentDeduct}
                  onChange={(e) =>
                    setCorporateInputs((p) => ({ ...p, taxAdjustmentDeduct: e.target.value === '' ? '' : Number(e.target.value) }))
                  }
                  placeholder="예: 10000000"
                />
                <div className="hint">익금불산입/손금산입 등 과세소득에서 빠지는 금액</div>
              </div>
            </>
          ) : null}
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
            disabled={corporateInputs.baseMode === 'taxBase'}
            onChange={(e) =>
              setCorporateInputs((p) => ({ ...p, lossCarryforward: e.target.value === '' ? '' : Number(e.target.value) }))
            }
            placeholder="예: 100000000"
          />
          {corporateInputs.baseMode === 'taxBase' ? (
            <div className="hint">과세표준 직접입력 모드에서는 이월결손금을 별도로 적용하지 않습니다.</div>
          ) : null}
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

    const makeOtherIncomeItem = (type = 'business') => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const isRental = type === 'rental';
      return {
        id,
        type,
        label: isRental ? '임대' : '프리랜서/사업',
        amount: '',
        expenseMode: 'standard',
        expenseRate: isRental ? 50 : '',
        expenseAmount: '',
        separate: isRental,
        separateRate: isRental ? 14 : '',
        deposit: '',
        houseCount: '',
        months: 12,
      };
    };

    const normalizeRateInput = (raw) => {
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) return 0;
      return num > 1 ? num / 100 : num;
    };

    const calcOtherExpense = (item) => {
      const gross = toNumber(item.amount);
      if (!gross) return 0;
      const mode = item.expenseMode || 'standard';
      if (mode === 'actual') return Math.min(toNumber(item.expenseAmount), gross);
      const isRental = (item.type || '').toLowerCase() === 'rental';
      const fallback = isRental ? 0.5 : 0;
      const rate =
        item.expenseRate === '' || item.expenseRate == null ? fallback : normalizeRateInput(item.expenseRate);
      return Math.min(Math.floor(gross * rate), gross);
    };

    const calcOtherTaxable = (item) => {
      const gross = toNumber(item.amount);
      const expense = calcOtherExpense(item);
      return Math.max(gross - expense, 0);
    };

    const FinancialIncome = () => {
      const interest = toNumber(financialInputs.interestAmount);
      const dividend = toNumber(financialInputs.dividendAmount);
      const total = interest + dividend;
      const threshold = 20_000_000;

      return (
        <>
          <div className="form-grid">
            <div className="field">
              <label>이자소득(원)</label>
              <input
                inputMode="numeric"
                type="number"
                value={financialInputs.interestAmount}
                onChange={(e) =>
                  setFinancialInputs((p) => ({ ...p, interestAmount: e.target.value === '' ? '' : Number(e.target.value) }))
                }
                placeholder="예: 8000000"
              />
            </div>
            <div className="field">
              <label>배당소득(원)</label>
              <input
                inputMode="numeric"
                type="number"
                value={financialInputs.dividendAmount}
                onChange={(e) =>
                  setFinancialInputs((p) => ({ ...p, dividendAmount: e.target.value === '' ? '' : Number(e.target.value) }))
                }
                placeholder="예: 16000000"
              />
              <label className="check" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={financialInputs.dividendGrossUpEligible}
                  onChange={(e) => setFinancialInputs((p) => ({ ...p, dividendGrossUpEligible: e.target.checked }))}
                />
                <span>Gross-up 대상 배당 포함</span>
              </label>
            </div>
            <div className="field">
              <label>원천세율(국세)</label>
              <input
                inputMode="decimal"
                type="number"
                step="0.01"
                value={financialInputs.withholdingRate}
                onChange={(e) => setFinancialInputs((p) => ({ ...p, withholdingRate: Number(e.target.value) }))}
              />
              <div className="hint">국내 이자/배당은 보통 0.14(14%)입니다. 지방세(10%)는 별도 계산돼요.</div>
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
              <div className="hint">배당이 종합과세로 넘어갈 때(2천만원 초과) 참고됩니다.</div>
            </div>
            <div className="field">
              <label>이자소득 출처</label>
              <select
                value={financialInputs.interestSource}
                onChange={(e) => setFinancialInputs((p) => ({ ...p, interestSource: e.target.value }))}
              >
                <option value="domestic">국내</option>
                <option value="foreign">해외</option>
              </select>
            </div>
            <div className="field">
              <label>배당소득 출처</label>
              <select
                value={financialInputs.dividendSource}
                onChange={(e) => setFinancialInputs((p) => ({ ...p, dividendSource: e.target.value }))}
              >
                <option value="domestic">국내</option>
                <option value="foreign">해외</option>
              </select>
            </div>
            {financialInputs.interestSource === 'foreign' ? (
              <div className="field">
                <label>외국납부세액(이자, 선택)</label>
                <input
                  inputMode="numeric"
                  type="number"
                  value={financialInputs.foreignTaxPaidInterest}
                  onChange={(e) =>
                    setFinancialInputs((p) => ({
                      ...p,
                      foreignTaxPaidInterest: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                  placeholder="예: 500000"
                />
              </div>
            ) : null}
            {financialInputs.dividendSource === 'foreign' ? (
              <div className="field">
                <label>외국납부세액(배당, 선택)</label>
                <input
                  inputMode="numeric"
                  type="number"
                  value={financialInputs.foreignTaxPaidDividend}
                  onChange={(e) =>
                    setFinancialInputs((p) => ({
                      ...p,
                      foreignTaxPaidDividend: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                  placeholder="예: 500000"
                />
              </div>
            ) : null}
          </div>
          <div className="callout">
            <div className="muted">
              금융소득 합계 {formatWon(total)} · 2천만원 기준{' '}
              {total > threshold ? `초과(${formatWon(total - threshold)})` : '이하'} · 비교과세 메모: {financialResult.comparisonNote}
            </div>
          </div>
        </>
      );
    };

    const FinancialOther = () => {
      const otherMode = financialInputs.otherMode || 'simple';
      const items = Array.isArray(financialInputs.otherItems) ? financialInputs.otherItems : [];
      const people = Math.max(1, Math.min(10, parseInt(financialInputs.personalDeductionPeople, 10) || 1));
      const personalDeduction = people * 1_500_000;
      const extraIncomeDeductions = toNumber(financialInputs.otherIncomeDeductions);
      const incomeDeductionsTotal = personalDeduction + extraIncomeDeductions;

      const ensureItems = () => {
        if (items.length > 0) return;
        setFinancialInputs((p) => ({ ...p, otherItems: [makeOtherIncomeItem('business')] }));
      };

      const updateItem = (id, patch) => {
        setFinancialInputs((prev) => ({
          ...prev,
          otherItems: (prev.otherItems || []).map((it) => (it.id === id ? { ...it, ...patch } : it)),
        }));
      };

      const removeItem = (id) => {
        setFinancialInputs((prev) => ({ ...prev, otherItems: (prev.otherItems || []).filter((it) => it.id !== id) }));
      };

      const addItem = (type) => {
        setFinancialInputs((prev) => ({ ...prev, otherItems: [...(prev.otherItems || []), makeOtherIncomeItem(type)] }));
      };

      const otherIncomeBeforeDeductions =
        otherMode === 'items' ? items.reduce((sum, it) => sum + calcOtherTaxable(it), 0) : toNumber(financialInputs.otherIncomeGross);
      const otherAfterDeductions = Math.max(otherIncomeBeforeDeductions - incomeDeductionsTotal, 0);

      return (
        <>
          <div className="form-grid">
            <div className="field">
              <label>입력 방식</label>
              <select
                value={otherMode}
                onChange={(e) => {
                  const next = e.target.value;
                  setFinancialInputs((p) => ({ ...p, otherMode: next }));
                  if (next === 'items') ensureItems();
                }}
              >
                <option value="simple">간단(합계만 입력)</option>
                <option value="items">상세(사업/임대·경비)</option>
              </select>
              <div className="hint">“경비 증빙/경비율” 고민이 있으면 ‘상세’를 추천합니다.</div>
            </div>
            {otherMode === 'simple' ? (
              <div className="field">
                <label>다른 종합소득(금융 제외, 소득금액 기준)</label>
                <input
                  inputMode="numeric"
                  type="number"
                  value={financialInputs.otherIncomeGross}
                  onChange={(e) =>
                    setFinancialInputs((p) => ({ ...p, otherIncomeGross: e.target.value === '' ? '' : Number(e.target.value) }))
                  }
                  placeholder="예: 40000000"
                />
                <div className="hint">근로/사업/임대 등 금융을 제외한 “소득금액” 합계(대략)를 입력하세요.</div>
              </div>
            ) : null}
            <div className="field">
              <label>인적공제(기본공제) 인원</label>
              <select
                value={financialInputs.personalDeductionPeople}
                onChange={(e) => setFinancialInputs((p) => ({ ...p, personalDeductionPeople: Number(e.target.value) }))}
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}명(본인 포함)
                  </option>
                ))}
              </select>
              <div className="hint">단순화: 1인당 1,500,000원(기본공제)으로 계산합니다.</div>
            </div>
            <div className="field">
              <label>추가 소득공제(선택)</label>
              <input
                inputMode="numeric"
                type="number"
                value={financialInputs.otherIncomeDeductions}
                onChange={(e) =>
                  setFinancialInputs((p) => ({
                    ...p,
                    otherIncomeDeductions: e.target.value === '' ? '' : Number(e.target.value),
                  }))
                }
                placeholder="예: 10000000"
              />
              <div className="hint">연금저축/보험료/기부금 등 소득공제·세액공제와는 구분됩니다(간단 모델).</div>
            </div>
          </div>

          {otherMode === 'items' ? (
            <div className="mini-stack" style={{ marginTop: 12 }}>
              {items.length === 0 ? (
                <div className="muted">항목을 추가해 주세요.</div>
              ) : (
                items.map((item, idx) => {
                  const taxable = calcOtherTaxable(item);
                  const expense = calcOtherExpense(item);
                  const isRental = (item.type || '').toLowerCase() === 'rental';
                  return (
                    <div key={item.id} className="mini-card">
                      <div className="mini-head">
                        <div className="mini-title">
                          {idx + 1}. {item.label || (isRental ? '임대' : '프리랜서/사업')}
                        </div>
                        <button type="button" className="btn ghost sm" onClick={() => removeItem(item.id)}>
                          삭제
                        </button>
                      </div>
                      <div className="form-grid">
                        <div className="field">
                          <label>유형</label>
                          <select
                            value={item.type}
                            onChange={(e) => {
                              const nextType = e.target.value;
                              const patch = { type: nextType };
                              if (nextType === 'rental') {
                                patch.label = item.label || '임대';
                                patch.expenseRate = item.expenseRate === '' ? 50 : item.expenseRate;
                                patch.separate = true;
                                patch.separateRate = item.separateRate === '' ? 14 : item.separateRate;
                              }
                              updateItem(item.id, patch);
                            }}
                          >
                            <option value="business">사업/프리랜서</option>
                            <option value="rental">임대</option>
                          </select>
                        </div>
                        <div className="field">
                          <label>수입금액(원)</label>
                          <input
                            inputMode="numeric"
                            type="number"
                            value={item.amount}
                            onChange={(e) => updateItem(item.id, { amount: e.target.value === '' ? '' : Number(e.target.value) })}
                            placeholder="예: 30000000"
                          />
                        </div>
                        <div className="field">
                          <label>경비 방식</label>
                          <select
                            value={item.expenseMode}
                            onChange={(e) => updateItem(item.id, { expenseMode: e.target.value })}
                          >
                            <option value="standard">경비율(추정)</option>
                            <option value="actual">실제경비</option>
                          </select>
                        </div>
                        {item.expenseMode === 'actual' ? (
                          <div className="field">
                            <label>실제경비(원)</label>
                            <input
                              inputMode="numeric"
                              type="number"
                              value={item.expenseAmount}
                              onChange={(e) =>
                                updateItem(item.id, { expenseAmount: e.target.value === '' ? '' : Number(e.target.value) })
                              }
                              placeholder="예: 12000000"
                            />
                          </div>
                        ) : (
                          <div className="field">
                            <label>경비율(%)</label>
                            <input
                              inputMode="decimal"
                              type="number"
                              step="0.1"
                              value={item.expenseRate}
                              onChange={(e) => updateItem(item.id, { expenseRate: e.target.value === '' ? '' : Number(e.target.value) })}
                              placeholder={isRental ? '기본 50' : '예: 60'}
                            />
                            <div className="hint">예: 60(=60%), 0.6도 가능</div>
                          </div>
                        )}
                        {isRental ? (
                          <>
                            <div className="field">
                              <label className="inline">
                                <input
                                  type="checkbox"
                                  checked={Boolean(item.separate)}
                                  onChange={(e) => updateItem(item.id, { separate: e.target.checked })}
                                />
                                임대 분리과세(연 2천만원 한도)
                              </label>
                              <div className="hint">초과분은 종합과세로 자동 전환됩니다.</div>
                            </div>
                            {item.separate ? (
                              <div className="field">
                                <label>분리과세 세율(국세)</label>
                                <input
                                  inputMode="decimal"
                                  type="number"
                                  step="0.01"
                                  value={item.separateRate}
                                  onChange={(e) =>
                                    updateItem(item.id, { separateRate: e.target.value === '' ? '' : Number(e.target.value) })
                                  }
                                  placeholder="예: 0.14"
                                />
                              </div>
                            ) : null}
                            <div className="field">
                              <label>보증금 합계(선택)</label>
                              <input
                                inputMode="numeric"
                                type="number"
                                value={item.deposit}
                                onChange={(e) => updateItem(item.id, { deposit: e.target.value === '' ? '' : Number(e.target.value) })}
                                placeholder="예: 400000000"
                              />
                              <div className="hint">2주택 이상 등 조건에 따라 간주임대료가 발생할 수 있어요.</div>
                            </div>
                            <div className="field">
                              <label>주택 수(선택)</label>
                              <input
                                inputMode="numeric"
                                type="number"
                                value={item.houseCount}
                                onChange={(e) =>
                                  updateItem(item.id, { houseCount: e.target.value === '' ? '' : Number(e.target.value) })
                                }
                                placeholder="예: 2"
                              />
                            </div>
                          </>
                        ) : null}
                      </div>
                      <div className="hint">
                        필요경비 {formatWon(expense)} · 과세 대상(수입-경비) {formatWon(taxable)}
                      </div>
                    </div>
                  );
                })
              )}
              <div className="actions" style={{ marginTop: 6 }}>
                <button type="button" className="btn ghost sm" onClick={() => addItem('business')}>
                  + 사업/프리랜서 추가
                </button>
                <button type="button" className="btn ghost sm" onClick={() => addItem('rental')}>
                  + 임대 추가
                </button>
              </div>
            </div>
          ) : null}

          <div className="callout" style={{ marginTop: 12 }}>
            <div className="muted">
              다른 소득금액(추정) {formatWon(otherIncomeBeforeDeductions)} · 소득공제 합계(인적+추가) {formatWon(incomeDeductionsTotal)} · 공제 후 {formatWon(otherAfterDeductions)}
            </div>
          </div>
        </>
      );
    };

    const FinancialPrepaid = () => {
      const otherMode = financialInputs.otherMode || 'simple';
      const otherItems = Array.isArray(financialInputs.otherItems) ? financialInputs.otherItems : [];
      const otherGross =
        otherMode === 'items'
          ? otherItems.reduce((sum, it) => sum + toNumber(it.amount), 0)
          : toNumber(financialInputs.otherIncomeGross);

      const extraIncomeGross = financialResult.financialTotal + otherGross;
      const comprehensiveBase = financialResult.progressive?.comprehensive?.taxable ?? 0;
      const bracketUsed = financialResult.progressive?.comprehensive?.bracketUsed ?? null;
      const progressiveRates = FINANCIAL_RULES.progressiveRates || [];
      const bracketIndex = bracketUsed
        ? progressiveRates.findIndex(
            (b) =>
              b.threshold === bracketUsed.threshold &&
              b.rate === bracketUsed.rate &&
              b.deduction === bracketUsed.deduction,
          )
        : -1;
      const nextBracket = bracketIndex >= 0 ? progressiveRates[bracketIndex + 1] : null;

      const bracketUpper = bracketUsed?.threshold ?? null;
      const remainingToUpper = bracketUpper == null ? null : Math.max(bracketUpper - comprehensiveBase, 0);

      const calcProgressiveTax = (taxable) => {
        const base = Math.max(Number(taxable) || 0, 0);
        if (!progressiveRates.length) return 0;
        const bracket =
          progressiveRates.find((b) => b.threshold == null || base <= b.threshold) || progressiveRates[progressiveRates.length - 1];
        const tax = base * bracket.rate - bracket.deduction;
        return Math.floor(tax);
      };
      const inc1m = calcProgressiveTax(comprehensiveBase + 1_000_000) - calcProgressiveTax(comprehensiveBase);

      const healthProfile = financialInputs.healthInsuranceProfile || 'unknown';
      const hiThreshold = 20_000_000;
      const hiRisk =
        healthProfile === 'dependent' && extraIncomeGross > hiThreshold
          ? '피부양자는 소득 기준에 따라 자격이 박탈되어 지역가입자로 전환될 수 있어요.'
          : healthProfile === 'employee' && extraIncomeGross > hiThreshold
            ? '직장가입자는 추가 소득이 커지면 “소득월액보험료”가 추가될 수 있어요.'
            : healthProfile === 'local'
              ? '지역가입자는 소득/재산 등에 따라 건보료가 조정될 수 있어요.'
              : null;

      return (
        <>
          <div className="form-grid">
            <div className="field">
              <label>기납부 국세(선택)</label>
              <input
                inputMode="numeric"
                type="number"
                value={financialInputs.prepaidNational}
                onChange={(e) =>
                  setFinancialInputs((p) => ({ ...p, prepaidNational: e.target.value === '' ? '' : Number(e.target.value) }))
                }
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
                onChange={(e) =>
                  setFinancialInputs((p) => ({ ...p, taxCreditOther: e.target.value === '' ? '' : Number(e.target.value) }))
                }
                placeholder="예: 0"
              />
            </div>
            <div className="field">
              <label>건강보험 가입 형태(참고)</label>
              <select
                value={financialInputs.healthInsuranceProfile}
                onChange={(e) => setFinancialInputs((p) => ({ ...p, healthInsuranceProfile: e.target.value }))}
              >
                <option value="unknown">선택 안 함</option>
                <option value="dependent">피부양자</option>
                <option value="employee">직장가입자(투잡/부업)</option>
                <option value="local">지역가입자/기타</option>
              </select>
              <div className="hint">건보료는 규정이 복잡해 “리스크 경고” 중심으로만 안내합니다.</div>
            </div>
          </div>

          <div className="upload-box" style={{ marginTop: 12 }}>
            <div className="upload-head">
              <div>
                <div className="upload-title">프리랜서 3.3% 원천징수 자동입력(선택)</div>
                <div className="hint">입력한 수입금액 기준으로 국세 3% + 지방세 0.3%를 기납부에 더합니다.</div>
              </div>
              <span className="pill">helper</span>
            </div>
            <div className="upload-row">
              <input
                className="file-display"
                inputMode="numeric"
                type="number"
                value={financialInputs.freelancerGross}
                onChange={(e) =>
                  setFinancialInputs((p) => ({ ...p, freelancerGross: e.target.value === '' ? '' : Number(e.target.value) }))
                }
                placeholder="3.3% 원천징수 대상 수입(원)"
              />
              <button
                type="button"
                className="btn primary sm"
                onClick={() => {
                  const base = toNumber(financialInputs.freelancerGross);
                  if (!base) return;
                  const addNational = Math.floor(base * 0.03);
                  const addLocal = Math.floor(base * 0.003);
                  setFinancialInputs((prev) => ({
                    ...prev,
                    prepaidNational: toNumber(prev.prepaidNational) + addNational,
                    prepaidLocal: toNumber(prev.prepaidLocal) + addLocal,
                  }));
                }}
              >
                기납부에 반영
              </button>
            </div>
          </div>

          <div className="callout">
            <div className="muted" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
              비교과세(국세): 종합 {formatWon(financialResult.taxes.methodATax)} / 분리 {formatWon(financialResult.taxes.methodBTax)} → 큰 값이 적용됩니다.
              {'\n'}
              소득공제(인적공제 포함) {formatWon(financialResult.incomeDeductions)} · 종합 과세표준(공제 후) {formatWon(comprehensiveBase)}
              {'\n'}
              분리과세 기준(다른소득 과세표준, 공제 후) {formatWon(financialResult.bases.otherAfterDeductions)}
              {'\n'}
              종합 과세표준(공제 후) 기준 현재 구간 {Math.round((bracketUsed?.rate ?? 0) * 100)}%
              {bracketUpper == null ? '' : ` (상한 ${formatWon(bracketUpper)}까지 ${formatWon(remainingToUpper)} 남음)`}
              {nextBracket ? ` · 다음 구간 ${Math.round(nextBracket.rate * 100)}%` : ''}
              {'\n'}
              과세표준 +100만원 시 국세(누진) 약 {formatWon(Math.max(inc1m, 0))} 증가(대략)
              {'\n'}
              {hiRisk ? `건보료 리스크: ${hiRisk}` : '건보료 리스크: 가입 형태를 선택하면 경고를 표시합니다.'}
              {'\n'}
              추가 소득(대략) {formatWon(extraIncomeGross)} (금융 {formatWon(financialResult.financialTotal)} + 기타 {formatWon(otherGross)})
            </div>
          </div>
        </>
      );
    };

    const renderStage = () => {
      if (calculator === 'yearend') {
        if (stage === 'y_income') return YearendIncome();
        if (stage === 'y_family') return YearendFamily();
        return YearendDeductions();
      }
      if (calculator === 'corporate') {
        if (stage === 'c_basic') return CorporateBasic();
        if (stage === 'c_income') return CorporateIncome();
        if (stage === 'c_loss') return CorporateLoss();
        return CorporateCredits();
      }
      if (calculator === 'financial') {
        if (stage === 'f_income') return FinancialIncome();
        if (stage === 'f_other') return FinancialOther();
        return FinancialPrepaid();
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
        {SubStep()}
        {calculator === 'yearend' && stage === 'y_family' ? (
          <div className="wizard-stack">
            <div className="wizard-main">{renderStage()}</div>
            {SummarySideCard()}
          </div>
        ) : (
          <div className="wizard-grid">
            <div className="wizard-main">{renderStage()}</div>
            {SummarySideCard()}
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

    const summaryLines = [];
    if (calculator === 'yearend' && yearend) {
      summaryLines.push(`결정세액(국세+지방) ${formatWon(yearend.outputs.totalDeterminedTax)}`);
      summaryLines.push(`기납부(원천징수) ${formatWon(yearend.outputs.withheldTotalTax)}`);
      summaryLines.push(`${yearend.outputs.refundAmount >= 0 ? '예상 환급' : '추가 납부'} ${formatWon(Math.abs(yearend.outputs.refundAmount))}`);
      summaryLines.push(`과세표준 ${formatWon(yearend.outputs.taxableIncome)}`);
    }
    if (calculator === 'corporate' && corporate) {
      summaryLines.push(`과세표준 ${formatWon(corporate.taxBase)}`);
      summaryLines.push(`최종세액 ${formatWon(corporate.finalTax)}`);
      summaryLines.push(`기납부세액 ${formatWon(corporate.prepaidTax)}`);
      summaryLines.push(`${corporate.payableTax >= 0 ? '추가 납부' : '환급/차감'} ${formatWon(Math.abs(corporate.payableTax))}`);
    }
    if (calculator === 'financial' && financial) {
      const methodLabel = financial.chosenMethod === 'comprehensive' ? '종합과세' : '분리과세';
      const prepaidTotal = financial.prepaid.prepaidNational + financial.prepaid.prepaidLocal + financial.prepaid.prepaidOther;
      summaryLines.push(`선택 방식 ${methodLabel}`);
      summaryLines.push(`금융소득 ${formatWon(financial.financialTotal)} (초과 ${formatWon(financial.excessFinancial)})`);
      summaryLines.push(`국세 ${formatWon(financial.taxes.nationalTax)} · 지방세 ${formatWon(financial.taxes.localIncomeTax)}`);
      summaryLines.push(`기납부 ${formatWon(prepaidTotal)}`);
      summaryLines.push(`${financial.taxes.totalPayable >= 0 ? '추가 납부' : '환급 예상'} ${formatWon(Math.abs(financial.taxes.totalPayable))}`);
    }

    const summaryText = summaryLines.map((line) => `• ${line}`).join('\n');
    const tipsText = gamification?.tips?.length ? gamification.tips.map((line) => `• ${line}`).join('\n') : '';

    return (
      <CardFrame
        title={`${currentCalc?.name || '계산기'} · 결과`}
        subtitle="입력값을 수정하려면 이전으로 돌아가세요."
        actions={
          <>
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                setShareModalOpen(true);
                if (shareDraft && shareState.status !== 'success' && shareState.status !== 'loading') {
                  createShareLink();
                }
              }}
              disabled={!shareDraft}
            >
              공유하기
            </button>
            <button className="btn ghost" type="button" onClick={resetAll}>
              다시 시작
            </button>
          </>
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
                금융소득 합계 {formatWon(financial.financialTotal)} (2천만원 초과분 {formatWon(financial.excessFinancial)})
                {'\n'}
                종합 계산(국세) {formatWon(financial.taxes.methodATax)} / 분리 계산(국세) {formatWon(financial.taxes.methodBTax)}
                {'\n'}
                소득공제(인적공제 포함) {formatWon(financial.incomeDeductions)}
                {'\n'}
                종합 과세표준(공제 전) {formatWon(financial.bases.comprehensiveBeforeDeductions)}
                {'\n'}
                종합 과세표준(공제 후) {formatWon(financial.bases.comprehensiveAfterDeductions)}
                {'\n'}
                국세 {formatWon(financial.taxes.nationalTax)} / 지방세 {formatWon(financial.taxes.localIncomeTax)}
                {'\n'}
                기납부 {formatWon(financial.prepaid.prepaidNational + financial.prepaid.prepaidLocal + financial.prepaid.prepaidOther)}
                {'\n'}
                {financial.taxes.totalPayable >= 0 ? '추가 납부' : '환급 예상'} {formatWon(Math.abs(financial.taxes.totalPayable))}
              </div>
            </div>
          )}

          {gamification ? (
            <div className="result-card">
              <div className="result-title">세금 등급(9등급)</div>
              <div className="result-value">
                {gamification.tier}등급 · {gamification.title}
              </div>
              <img className="meme-img" src={gamification.memeImageUrl} alt={`세금 등급 ${gamification.tier}등급`} loading="lazy" />
              <div className="result-body">{gamification.tagline}</div>
            </div>
          ) : null}

          {summaryText || tipsText ? (
            <div className="result-card">
              <div className="result-title">요약 & 팁</div>
              <div className="result-body">
                {summaryText}
                {tipsText ? `\n\n${tipsText}` : ''}
              </div>
            </div>
          ) : null}
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

      </CardFrame>
    );
  };

  const cardKey = `${step}-${calculator ?? 'none'}-${stage ?? 'none'}`;
  const showMobileNav = step === 'docs' || step === 'input';
  const mobileNextLabel = step === 'docs' ? '다음' : stageIndex < inputStages.length - 1 ? '다음' : '결과 보기';
  const nativeShareAvailable = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const runNativeShare = async () => {
    if (!shareDraft || !shareState.url) return;
    try {
      await navigator.share({
        title: shareDraft.title,
        text: shareDraft.subtitle || '세금 계산 결과 공유',
        url: shareState.url,
      });
    } catch {
    }
  };

  return (
    <section className="shell">
      <div className={`wizard-wrap ${showMobileNav ? 'has-mobile-nav' : ''}`}>
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
          {step === 'select' && SelectCard()}
          {step === 'docs' && DocsCard()}
          {step === 'input' && InputCard()}
          {step === 'review' && ReviewCard()}
        </div>
      </div>

      {showMobileNav ? (
        <div className="wizard-mobile-nav" role="navigation" aria-label="단계 이동">
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              if (step === 'docs') setStep('select');
              else goPrevInput();
            }}
          >
            이전
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              if (step === 'docs') {
                setStageIndex(0);
                setStep('input');
              } else {
                goNextInput();
              }
            }}
          >
            {mobileNextLabel}
          </button>
        </div>
      ) : null}

      {shareModalOpen && shareDraft ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="결과 공유"
          onClick={() => setShareModalOpen(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">공유하기</div>
                <div className="muted">{shareDraft.title}</div>
              </div>
              <button className="icon-btn" type="button" onClick={() => setShareModalOpen(false)} aria-label="닫기">
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="muted">
                링크가 생성되면, 카카오톡/인스타 등은 모바일의 “시스템 공유”에서 선택할 수 있어요.
              </div>

              {shareState.status === 'loading' ? <div className="muted">링크 생성 중…</div> : null}
              {shareState.status === 'error' ? <div className="muted">{shareState.error}</div> : null}
              {shareState.url ? <div className="share-url mono">{shareState.url}</div> : null}

              <div className="actions">
                {shareState.url ? (
                  <button
                    className="btn primary"
                    type="button"
                    onClick={async () => {
                      const copied = await copyShareUrl(shareState.url);
                      setShareState((prev) => ({ ...prev, copied }));
                    }}
                  >
                    URL 복사
                  </button>
                ) : (
                  <button className="btn primary" type="button" onClick={createShareLink} disabled={shareState.status === 'loading'}>
                    {shareState.status === 'loading' ? '링크 생성 중…' : '링크 생성'}
                  </button>
                )}

                {nativeShareAvailable && shareState.url ? (
                  <button className="btn ghost" type="button" onClick={runNativeShare}>
                    시스템 공유
                  </button>
                ) : null}

                {shareState.url ? (
                  <a className="btn ghost" href={shareState.url} target="_blank" rel="noreferrer">
                    미리보기 열기
                  </a>
                ) : null}

                <button className="btn ghost" type="button" onClick={createShareLink} disabled={shareState.status === 'loading'}>
                  다시 생성
                </button>
              </div>

              {shareState.status === 'success' && shareState.copied ? (
                <div className="muted">URL을 복사했습니다.</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
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

const landingConfigs = {
  yearend: {
    path: '/yearend-tax',
    pill: '연말정산 계산기',
    h1: '연말정산 계산기',
    lede: '총급여·공제·세액공제를 단계로 입력하고, 과세표준→산출세액→결정세액(지방세 포함) 흐름으로 환급/추납을 추정합니다.',
    badges: ['PDF 업로드(급여명세서)', '부양가족 공제', '세액공제/소득공제', '결과 실시간 미리보기'],
    glossary: [
      { term: '총급여', desc: '세전 급여 합계(비과세 제외). 본 계산기는 총급여를 기준으로 공제/세액공제를 반영합니다.' },
      { term: '근로소득공제', desc: '총급여 구간에 따라 일정 금액을 공제(근로소득금액 산출용).' },
      { term: '근로소득금액', desc: '총급여에서 근로소득공제를 차감한 금액.' },
      { term: '소득공제', desc: '과세표준을 줄이는 공제(인적공제·사회보험료·카드 소득공제 등).' },
      { term: '과세표준', desc: '근로소득금액에서 소득공제 합계를 차감한 금액(누진세율 적용 기준).' },
      { term: '산출세액', desc: '과세표준에 누진세율을 적용해 계산한 세액.' },
      { term: '세액공제', desc: '산출세액에서 직접 빼주는 공제(연금저축/IRP, 보험·의료·교육·기부·월세 등).' },
      { term: '결정세액', desc: '산출세액 - 세액공제(일부 절사 규칙 반영).' },
      { term: '지방소득세', desc: '결정세액의 10%로 계산(간단화).' },
      { term: '환급/추납', desc: '원천징수세액(소득세+지방세)과 최종세액을 비교해 환급/추납을 추정.' },
    ],
    steps: [
      '총급여/원천징수세액 입력',
      '부양가족(인적공제) 입력',
      '소득공제(사회보험·카드·주택 등) 입력',
      '세액공제(연금저축/IRP, 보험·의료·교육·기부·월세 등) 입력',
      '결정세액(국세+지방세) → 원천징수세액과 비교',
    ],
    formulas: [
      { title: '근로소득금액', formula: '근로소득금액 = 총급여 - 근로소득공제' },
      { title: '과세표준', formula: '과세표준 = max(근로소득금액 - 소득공제합계, 0)' },
      { title: '산출세액', formula: '산출세액 = 누진세율(과세표준)' },
      { title: '결정세액(국세)', formula: '결정세액 = max(산출세액 - 세액공제합계, 0)' },
      { title: '지방소득세', formula: '지방소득세 = 결정세액 × 10%' },
      { title: '환급/추납', formula: '환급(+) / 추납(-) = 원천징수세액 - (결정세액 + 지방소득세)' },
    ],
    notes: [
      '본 페이지의 용어/계산식은 “서비스 계산 로직”을 이해하기 위한 요약입니다.',
      '세법 개정, 공제 요건/한도, 증빙 인정 여부에 따라 실제 정산 결과는 달라질 수 있습니다.',
    ],
    faq: [
      {
        q: 'PDF로 자동 입력이 가능한가요?',
        a: '급여명세서/지급명세서 PDF에서 일부 항목을 추출해 입력을 줄이는 방식입니다. 양식이 다르면 일부 값은 직접 확인이 필요합니다.',
      },
      {
        q: '계산 결과가 확정 세액과 다를 수 있나요?',
        a: '네. 본 서비스는 추정치이며, 공제 적용 요건/한도/증빙 인정 여부에 따라 실제 신고·정산 결과가 달라질 수 있습니다.',
      },
    ],
  },
  corporate: {
    path: '/corporate-tax',
    pill: '법인세 계산기',
    h1: '법인세 계산기',
    lede: '회계상 손익을 출발점으로 세무조정(가산/차감)·결손금·세액공제를 반영해 과세표준→산출세액→최저한세→납부세액 흐름을 계산합니다.',
    badges: ['재무제표 PDF 참고', '세무조정 입력', '결손금/기납부', '세액공제 반영'],
    glossary: [
      { term: '당기순이익(회계)', desc: '재무제표(손익계산서) 기준 이익(세무조정 전).' },
      { term: '세무조정(가산/차감)', desc: '회계 이익을 과세소득으로 바꾸는 조정. 가산(+)·차감(-) 입력값이 과세표준에 반영됩니다.' },
      { term: '결손금 공제', desc: '이월결손금으로 과세표준을 줄이는 항목(적용 가능액 범위 내).' },
      { term: '과세표준', desc: '세무조정 후 소득에서 결손금 공제를 적용한 금액(법인세율 적용 기준).' },
      { term: '산출세액', desc: '과세표준에 법인세율을 적용한 세액(세율표/연도 선택 가능).' },
      { term: '세액공제', desc: '산출세액에서 차감되는 공제(R&D/투자/기타 등 입력).' },
      { term: '최저한세', desc: '세액공제 후 세액과 비교해 적용되는 최소 세액(간단화).' },
      { term: '기납부세액', desc: '중간예납 등 이미 납부한 세액. 납부(환급) 계산에 반영됩니다.' },
    ],
    steps: [
      '손익(매출/비용/순이익) 입력',
      '세무조정(가산/차감) 입력',
      '결손금·기납부세액 입력',
      '세액공제 입력',
      '최종세액/납부세액 확인',
    ],
    formulas: [
      { title: '세무상 소득(결손 전)', formula: '세무상 소득 = 회계 순이익 + 가산(+) - 차감(-)' },
      { title: '과세표준', formula: '과세표준 = max(세무상 소득 - 결손금 공제, 0)' },
      { title: '산출세액', formula: '산출세액 = 법인세율(과세표준, 세율표)' },
      { title: '세액공제 후 세액', formula: '세액공제 후 세액 = max(산출세액 - 세액공제합계, 0)' },
      { title: '최저한세 반영', formula: '최종세액 = max(세액공제 후 세액, 최저한세) - (최저한세 감면/공제)' },
      { title: '납부(환급)세액', formula: '납부세액 = 최종세액 - 기납부세액' },
    ],
    notes: [
      '세율표/연도 및 기업유형(중소/일반)에 따라 계산 결과가 달라질 수 있습니다.',
      '세무조정의 “판단(해당 여부)”은 자동화하지 않고, 입력된 금액을 그대로 반영합니다.',
    ],
    faq: [
      {
        q: '세무조정까지 자동으로 되는 건가요?',
        a: '자동 판단까지는 어렵고, 사용자가 금액(가산/차감)을 입력하면 계산에 반영되는 형태입니다.',
      },
      {
        q: '세액공제는 어떤 것들이 있나요?',
        a: 'R&D/투자 등 일부 항목을 입력받아 반영합니다. 실제 적용 가능 여부는 요건 충족/증빙에 따라 달라질 수 있습니다.',
      },
    ],
  },
  financial: {
    path: '/income-tax',
    pill: '종합소득세 계산기',
    h1: '종합소득세(금융소득 포함) 계산기',
    lede: '금융소득(이자·배당) 2,000만 원 기준의 비교과세를 계산하고, “종합과세 vs 분리과세” 결과를 비교합니다(누진세율·Gross-up·기납부 반영).',
    badges: ['누진세율 구간', '건보료 리스크 안내', '경비/공제 입력', '기납부세액 반영'],
    glossary: [
      { term: '금융소득', desc: '이자 + 배당. 연간 2,000만 원을 기준으로 종합과세 전환 여부(비교과세)를 판단합니다.' },
      { term: '분리과세', desc: '일정 범위의 금융소득을 원천징수로 종결(간단화: 기본 원천세율 14%).' },
      { term: '종합과세', desc: '금융소득(초과분)과 다른 소득을 합산해 누진세율로 과세.' },
      { term: '비교과세', desc: '종합 계산(A)과 분리 계산(B)을 비교해 더 큰 세액으로 과세(금융소득 종합과세 특성).' },
      { term: 'Gross-up', desc: '배당소득 가산(간단화: 초과분 × 10%)을 과세표준에 더하고, 배당세액공제로 일부 상쇄.' },
      { term: '소득공제(인적공제 등)', desc: '종합과세 과세표준을 줄이는 공제. 화면에서 인원/금액으로 입력합니다.' },
      { term: '기납부세액', desc: '원천징수(이자·배당), 프리랜서 3.3% 등 이미 납부한 세액. 최종 납부/환급 계산에 반영됩니다.' },
      { term: '건강보험료 리스크', desc: '피부양자/소득월액보험료 등은 정밀 계산이 어려워 “체크/안내” 중심으로 제공합니다.' },
    ],
    steps: [
      '이자/배당 입력(원천세율, Gross-up 여부 포함)',
      '다른 소득/경비 입력(필요 시 분리과세 항목 포함)',
      '소득공제(인적공제 등)·기납부세액 입력',
      '비교과세(A vs B) 결과 확인',
      '결정세액(지방세 포함)과 납부/환급 추정 확인',
    ],
    formulas: [
      { title: '2,000만 원 기준 분리/초과분', formula: '금융소득 = 이자 + 배당\n기준금액(2,000만) 이내분 + 초과분으로 나누어 계산' },
      {
        title: '방법 A(종합)',
        formula:
          'A = (기준금액 이내 금융소득 원천세) + (초과분 + 다른소득 + Gross-up) 누진세 + (다른 분리과세 세액)',
      },
      {
        title: '방법 B(분리)',
        formula: 'B = (전체 금융소득 원천세) + (다른소득만 누진세) + (다른 분리과세 세액)',
      },
      { title: '비교과세', formula: '비교과세 세액(국세) = max(A, B)' },
      { title: 'Gross-up(간단화)', formula: 'Gross-up 가산 = (Gross-up 대상 초과분) × 10%' },
      { title: '납부(환급)세액', formula: '납부세액 = (국세 + 지방소득세) - 기납부세액(원천징수 등)' },
    ],
    notes: [
      '본 계산기는 금융소득 비교과세의 핵심 흐름을 “간단화”해 제공합니다(해외소득/외국납부세액공제 등은 단순화).',
      '세법·요건·한도에 따라 실제 신고 결과는 달라질 수 있습니다.',
    ],
    faq: [
      {
        q: '종합과세/분리과세 비교가 중요한 이유는?',
        a: '2,000만 원까지는 분리과세(원천징수로 종결)로 끝나지만, 초과분은 다른 소득과 합산되어 누진세율을 적용받아 세 부담이 급증할 수 있습니다.',
      },
      {
        q: '건강보험료(소득월액/피부양자)까지 정확히 계산되나요?',
        a: '정밀한 산정은 자격/재산/부과기준 등 변수가 많아 단순화된 안내 수준으로 제공됩니다. 실제 부과는 공단 기준에 따릅니다.',
      },
      {
        q: '기납부세액(3.3%)이 환급/납부에 어떻게 반영되나요?',
        a: '이미 낸 세액을 입력하면 결정세액과 비교해 환급/추납을 추정합니다. 실제 환급/납부는 신고 내용과 원천징수 내역에 따라 달라질 수 있습니다.',
      },
      {
        q: '경비 처리는 어디까지 인정되나요?',
        a: '업무 관련성/증빙 유무에 따라 달라집니다. 본 계산기는 입력한 경비/공제를 반영하지만, 인정 여부 판단은 세무서/세무대리인 확인이 필요합니다.',
      },
    ],
  },
};

function CalculatorLandingPage({ calculatorId }) {
  const config = landingConfigs[calculatorId] || null;
  const fallbackTitle = '세금 계산기';

  return (
    <div>
      <header className="hero">
        <div>
          <p className="pill">{config?.pill ?? fallbackTitle}</p>
          <h1>{config?.h1 ?? fallbackTitle}</h1>
          {config?.lede ? <p className="lede">{config.lede}</p> : null}
          {config?.badges?.length ? (
            <div className="hero-badges">
              {config.badges.map((badge) => (
                <span key={badge} className="pill">
                  {badge}
                </span>
              ))}
            </div>
          ) : null}
          <div className="actions">
            <Link className="btn ghost" to="/">
              전체 계산기
            </Link>
            <a className="btn ghost" href="/sitemap.xml">
              사이트맵
            </a>
          </div>
        </div>
      </header>

      <TaxWizard initialCalculator={calculatorId} />

      <section className="shell">
        <details className="seo-details">
          <summary>용어 · 계산식 · FAQ 보기</summary>
          <div className="seo-details-body">
            {config?.glossary?.length ? (
              <div className="card">
                <h2>핵심 용어</h2>
                <dl className="glossary">
                  {config.glossary.map((item) => (
                    <div key={item.term} className="glossary-row">
                      <dt>{item.term}</dt>
                      <dd>{item.desc}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {config?.steps?.length ? (
              <div className="card">
                <h2>계산 흐름(입력 순서)</h2>
                <ol className="list">
                  {config.steps.map((stepItem) => (
                    <li key={stepItem}>{stepItem}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            {config?.formulas?.length ? (
              <div className="card">
                <h2>핵심 계산식(요약)</h2>
                <div className="formula-grid">
                  {config.formulas.map((item) => (
                    <div key={item.title} className="formula-block">
                      <div className="formula-title">{item.title}</div>
                      <pre className="formula-code">{item.formula}</pre>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {config?.notes?.length ? (
              <div className="card">
                <h2>참고</h2>
                <ul className="list">
                  {config.notes.map((note) => (
                    <li key={note} className="muted">
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {config?.faq?.length ? (
              <div className="card">
                <h2>자주 묻는 질문</h2>
                <div className="faq-list">
                  {config.faq.map((item) => (
                    <details key={item.q}>
                      <summary>{item.q}</summary>
                      <p className="muted">{item.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </details>
      </section>
    </div>
  );
}

function Home() {
  return (
    <div>
      <TaxWizard />

      <section className="shell">
        <details className="seo-details">
          <summary>서비스 소개 · 바로가기</summary>
          <div className="seo-details-body">
            <header className="hero hero-compact">
              <div>
                <p className="pill">카드형 단계 진행</p>
                <h1>단계별 카드로 세금 계산을 진행합니다</h1>
                <p className="lede">복잡한 입력을 한 번에 보여주지 않고, 필요한 항목만 카드로 나눠서 입력합니다.</p>
                <div className="hero-badges">
                  <span className="pill">Progressive Disclosure</span>
                  <span className="pill">결과 실시간 미리보기</span>
                  <span className="pill">원본 계산기 옵션</span>
                </div>
                <div className="actions">
                  <Link className="btn primary" to={landingConfigs.yearend.path}>
                    연말정산 계산기
                  </Link>
                  <Link className="btn primary" to={landingConfigs.corporate.path}>
                    법인세 계산기
                  </Link>
                  <Link className="btn primary" to={landingConfigs.financial.path}>
                    종합소득세 계산기
                  </Link>
                </div>
              </div>
            </header>
          </div>
        </details>
      </section>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path={landingConfigs.yearend.path} element={<CalculatorLandingPage calculatorId="yearend" />} />
      <Route path={landingConfigs.corporate.path} element={<CalculatorLandingPage calculatorId="corporate" />} />
      <Route path={landingConfigs.financial.path} element={<CalculatorLandingPage calculatorId="financial" />} />
      {calculatorFrames.map((c) => (
        <Route key={c.id} path={`/${c.id}`} element={<IframePage title={c.title} src={c.src} />} />
      ))}
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

export default App;
