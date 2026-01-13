import { useEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route } from 'react-router-dom';

const calculators = [
  { id: 'yearend', name: '연말정산', blurb: '근로소득 환급/추납' },
  { id: 'corporate', name: '법인세', blurb: 'TaxCore 2025 시뮬레이터' },
  { id: 'financial', name: '금융소득 종합과세', blurb: '비교과세 · Gross-up · 해외소득' },
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

const formatKRW = (n) => Number(n || 0).toLocaleString('ko-KR');

const initialAnswers = {
  financialIncome: '',
  otherIncome: '',
  grossUpRate: 0.1,
  salary: '',
  insurance: '',
  education: '',
  donation: '',
  corpRevenue: '',
  corpExpense: '',
  corpCredit: '',
};

// 계산에 사용될 주요 함수들 (yearend/script.js에서 가져온 로직 일부)
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

const calcYearendEstimate = ({ salary, insurance, education, donation }) => {
  const gross = Number(salary) || 0;
  if (!gross) return '총급여를 먼저 알려주세요. 예: 총급여 5000만';
  const ins = Number(insurance) || 0;
  const edu = Number(education) || 0;
  const don = Number(donation) || 0;

  const earnedDed = earnedIncomeDeduction(gross);
  const personalDed = 1_500_000; // 단순 개인 기본공제
  const totalDed = earnedDed + personalDed + ins + edu + don;
  const taxable = Math.max(0, gross - totalDed);
  const incomeTax = Math.max(0, progressiveTax(taxable));
  const localTax = incomeTax * 0.1;
  const total = incomeTax + localTax;

  return [
    `총급여 ${formatKRW(gross)} / 근로소득공제 ${formatKRW(earnedDed)} / 기본공제 ${formatKRW(personalDed)}`,
    `기타 공제(보험·교육·기부): ${formatKRW(ins + edu + don)}`,
    `과세표준 약 ${formatKRW(taxable)}, 산출세액 약 ${formatKRW(incomeTax)}, 지방소득세 약 ${formatKRW(localTax)}`,
    `예상 납부(또는 원천 징수 비교): 총 약 ${formatKRW(total)}`,
  ].join(' · ');
};

const calcCorporateEstimate = ({ corpRevenue, corpExpense, corpCredit }) => {
  const rev = Number(corpRevenue) || 0;
  const exp = Number(corpExpense) || 0;
  const credit = Number(corpCredit) || 0;
  if (!rev) return '매출을 먼저 알려주세요. 예: 매출 3억';
  const profit = Math.max(0, rev - exp);
  const firstBand = Math.min(profit, 200_000_000);
  const secondBand = Math.max(0, profit - 200_000_000);
  const incomeTax = firstBand * 0.1 + secondBand * 0.2;
  const localTax = incomeTax * 0.1;
  const totalTax = Math.max(0, incomeTax + localTax - credit);

  return [
    `과세표준(추정) ${formatKRW(profit)} / 산출세액 ${formatKRW(incomeTax)} / 지방소득세 ${formatKRW(localTax)}`,
    credit ? `세액공제 차감 후 예상 납부액 약 ${formatKRW(totalTax)}` : `예상 납부액 약 ${formatKRW(totalTax)}`,
  ].join(' · ');
};

const coupangAds = [
  { id: 902948, trackingCode: 'AF7397099', template: 'carousel', width: '100%', height: '250' },
  { id: 902947, trackingCode: 'AF7397099', template: 'carousel', width: '100%', height: '250' },
  { id: 902949, trackingCode: 'AF7397099', template: 'carousel', width: '100%', height: '250' },
];

const ChatBubble = ({ role, text, links = [] }) => (
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

    const initWidget = () => {
      if (window?.PartnersCoupang?.G) {
        // eslint-disable-next-line no-new
        new window.PartnersCoupang.G(ad);
      }
    };

    const existing = document.getElementById('coupang-partners-sdk');
    if (existing && existing.dataset.ready === 'true') {
      initWidget();
    } else {
      const script = existing || document.createElement('script');
      script.id = 'coupang-partners-sdk';
      script.src = 'https://ads-partners.coupang.com/g.js';
      script.async = true;
      script.dataset.ready = 'false';
      script.onload = () => {
        script.dataset.ready = 'true';
        initWidget();
      };
      if (!existing) container.appendChild(script);
    }

    return () => {
      container.innerHTML = '';
    };
  }, [ad]);

  return (
    <div className="card ad-card">
      <div className="ad-head">
        <span className="pill">쿠팡 파트너스</span>
        <span className="muted">랜덤 추천 슬롯</span>
      </div>
      <div ref={containerRef} className="ad-slot" />
    </div>
  );
}

function useProgress(calculator, step) {
  const steps = useMemo(() => {
    if (calculator === 'financial') return ['select', 'docs', 'financialIncome', 'review'];
    if (calculator === 'yearend' || calculator === 'corporate') return ['select', 'docs', 'input', 'review'];
    return ['select', 'docs', 'input', 'review'];
  }, [calculator]);

  const index = Math.max(0, steps.indexOf(step));
  const pct = ((index + 1) / steps.length) * 100;
  return { steps, index, pct };
}

function ChatWizard() {
  const [calculator, setCalculator] = useState(null);
  const [messages, setMessages] = useState([
    { role: 'bot', text: '안녕하세요! 한 단계씩 차분히 세금 계산을 도와드릴게요. 준비 자료부터 함께 살펴보죠.' },
    { role: 'bot', text: '연말정산 · 법인세 · 금융소득 중 무엇을 계산하고 싶으신가요?' },
  ]);
  const [docReady, setDocReady] = useState([]);
  const [answers, setAnswers] = useState({ ...initialAnswers });
  const [step, setStep] = useState('select');
  const { steps, index, pct } = useProgress(calculator, step);
  const [inputText, setInputText] = useState('');

  const pushMessage = (payload) => {
    setMessages((prev) => [...prev, payload]);
  };
  const pushBot = (text, extra = {}) => pushMessage({ role: 'bot', text, ...extra });
  const pushUser = (text) => pushMessage({ role: 'user', text });

  const financialAdvice = (data) => {
    const fin = Number(data.financialIncome) || 0;
    const other = Number(data.otherIncome) || 0;
    const gross = Number(data.grossUpRate || 0);
    const threshold = 20_000_000;
    if (!fin) return '금융소득 금액을 알려주시면 종합 vs 분리 어느 쪽이 더 큰지 안내해 드릴게요.';
    const separateTax = fin * 0.14;
    const progressive = (income) => {
      if (income <= 14_000_000) return income * 0.06;
      if (income <= 50_000_000) return 840000 + (income - 14_000_000) * 0.15;
      if (income <= 88_000_000) return 6240000 + (income - 50_000_000) * 0.24;
      return 15440000 + (income - 88_000_000) * 0.35;
    };
    const grossUpAdd = fin > threshold ? (fin - threshold) * gross : 0;
    const comprehensiveTax = progressive(Math.max(other + Math.max(fin - threshold, 0) + grossUpAdd, 0)) + threshold * 0.14;
    const picked = comprehensiveTax >= separateTax ? '종합과세 금액이 더 커서 종합으로 비교과세 적용' : '14% 전액 분리과세가 더 큼';
    return [
      `금융소득 ${formatKRW(fin)} / 기타소득 ${formatKRW(other)} / Gross-up ${gross}`,
      `종합 방식(초과+누진세): 약 ₩${formatKRW(Math.round(comprehensiveTax))}, 분리: 약 ₩${formatKRW(Math.round(separateTax))}`,
      picked,
    ].join(' · ');
  };

  const resetFlow = () => {
    setCalculator(null);
    setDocReady([]);
    setAnswers({ ...initialAnswers });
    setStep('select');
    setMessages([
      { role: 'bot', text: '메신저처럼 대화하며 계산을 안내합니다. 자료 준비 → 금액 입력 → 결과/링크 순서로 진행해요.' },
      { role: 'bot', text: '연말정산 · 법인세 · 금융소득 중 무엇을 계산할까요?' },
    ]);
  };

  const handleSelectCalculator = (id) => {
    setCalculator(id);
    setStep('docs');
    const name = calculators.find((c) => c.id === id)?.name || '계산기';
    pushUser(`${name} 계산기를 선택했어요.`);
    pushBot('필요한 자료를 체크해 볼게요. 준비된 것이 있으면 알려주세요. 예: "간소화 PDF 있음".');
    pushBot(`준비 예시: ${docChecklist.join(' · ')}`);
  };

  const handleDocsNext = () => {
    pushUser(`준비한 자료: ${docReady.length ? docReady.join(', ') : '없음'}`);
    const next = calculator === 'financial' ? 'financialIncome' : 'input';
    const name = calculators.find((c) => c.id === calculator)?.name ?? '계산기';
    if (calculator === 'financial') {
      pushBot('금융소득/기타소득 금액을 메시지로 알려주세요. 예: "금융 24000000 기타 40000000 gross 0.1"');
      pushBot('필요하면 원래 계산 화면도 바로 열 수 있어요.', { links: [{ label: `${name} 계산기 열기`, href: `/${calculator}` }] });
      setStep(next);
      return;
    }
    if (calculator === 'yearend') {
      pushBot('총급여와 공제 항목을 알려주세요. 예: "총급여 5000만, 보험료 120만, 교육비 50만, 기부금 30만"');
    } else if (calculator === 'corporate') {
      pushBot('매출/비용/세액공제 금액을 알려주세요. 예: "매출 3억, 비용 2억2천, 세액공제 500만"');
    } else {
      pushBot('필요한 금액을 메시지로 알려주세요.');
    }
    pushBot('필요하면 원래 계산 화면도 바로 열 수 있어요.', { links: [{ label: `${name} 계산기 열기`, href: `/${calculator}` }] });
    setStep(next);
  };

  const parseNumeric = (text) => {
    if (!text) return [];
    return (text.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(String(n).replace(/[^\d.]/g, '')));
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

    if (lower.includes('광고') || lower.includes('추천')) {
      pushBot('광고 추천 기능은 현재 비활성화되어 있어요. 세금 계산을 이어서 진행해 볼까요?');
      return;
    }

    if (step === 'select') {
      if (lower.includes('연말') || lower.includes('year')) return handleSelectCalculator('yearend');
      if (lower.includes('법인') || lower.includes('corp')) return handleSelectCalculator('corporate');
      if (lower.includes('금융') || lower.includes('financial')) return handleSelectCalculator('financial');
      return pushBot('연말정산/법인세/금융소득 중 하나를 말씀해 주세요. 예: "금융소득 계산"');
    }

    if (step === 'docs') {
      if (lower.includes('준비 완료') || lower.includes('완료') || lower.includes('ok')) return handleDocsNext();
      const found = docChecklist.filter((d) => d.toLowerCase().split(/[\s/]+/).some((token) => token && lower.includes(token)));
      if (found.length) {
        setDocReady((prev) => Array.from(new Set([...prev, ...found])));
        return pushBot(`${found.join(', ')} 체크되었습니다. "준비 완료"라고 보내면 다음 단계로 이동합니다.`);
      }
      return pushBot('자료 준비 여부를 말씀해 주세요. 예: "간소화 PDF 준비", "준비 완료".');
    }

    if (step === 'financialIncome') {
      const nums = parseNumeric(text);
      const grossMatch = text.match(/gross|그로스|배당|%/i);
      const grossRate = grossMatch && nums.length ? nums[nums.length - 1] : answers.grossUpRate;
      const [fin, other] = nums;
      if (fin) {
        setAnswers((prev) => ({
          ...prev,
          financialIncome: fin,
          otherIncome: other ?? prev.otherIncome,
          grossUpRate: grossRate ?? prev.grossUpRate,
        }));
        pushBot(`금융소득 ${formatKRW(fin)} / 기타소득 ${formatKRW(other ?? prev.otherIncome)} / Gross-up ${grossRate ?? prev.grossUpRate}`);
        setStep('review');
        pushBot(financialAdvice({ financialIncome: fin, otherIncome: other ?? answers.otherIncome, grossUpRate: grossRate ?? answers.grossUpRate }));
        return;
      }
      if (lower.includes('조언')) {
        pushBot(financialAdvice(answers));
        return;
      }
      return pushBot('숫자를 인식하지 못했어요. 예: "금융 24000000 기타 40000000 gross 0.1"');
    }

    if (step === 'input' && calculator === 'yearend') {
      const salary = text.match(/(총)?급여\s*([\d,\.]+)/i)?.[2];
      const insurance = text.match(/보험료\s*([\d,\.]+)/i)?.[1];
      const education = text.match(/교육비\s*([\d,\.]+)/i)?.[1];
      const donation = text.match(/기부금\s*([\d,\.]+)/i)?.[1];
      const nextAnswers = {
        ...answers,
        salary: salary ? Number(String(salary).replace(/[^\d]/g, '')) : answers.salary || '',
        insurance: insurance ? Number(String(insurance).replace(/[^\d]/g, '')) : answers.insurance || '',
        education: education ? Number(String(education).replace(/[^\d]/g, '')) : answers.education || '',
        donation: donation ? Number(String(donation).replace(/[^\d]/g, '')) : answers.donation || '',
      };
      setAnswers(nextAnswers);
      pushBot(
        `입력값 확인: 총급여 ${formatKRW(salary || answers.salary)} / 보험료 ${formatKRW(insurance || answers.insurance)} / 교육비 ${formatKRW(education || answers.education)} / 기부금 ${formatKRW(donation || answers.donation)}`,
      );
      pushBot(calcYearendEstimate(nextAnswers));
      pushBot('추가로 수정할 항목이 있으면 알려주세요. 보다 정밀한 계산은 원본 계산기 열기로 이동할 수 있어요.');
      setStep('review');
      return;
    }

    if (step === 'input' && calculator === 'corporate') {
      const revenue = text.match(/(매출|수익)\s*([\d,\.]+)/i)?.[2];
      const expense = text.match(/(비용|지출)\s*([\d,\.]+)/i)?.[2];
      const credit = text.match(/(세액공제|공제)\s*([\d,\.]+)/i)?.[2];
      const nextAnswers = {
        ...answers,
        corpRevenue: revenue ? Number(String(revenue).replace(/[^\d]/g, '')) : answers.corpRevenue || '',
        corpExpense: expense ? Number(String(expense).replace(/[^\d]/g, '')) : answers.corpExpense || '',
        corpCredit: credit ? Number(String(credit).replace(/[^\d]/g, '')) : answers.corpCredit || '',
      };
      setAnswers(nextAnswers);
      pushBot(
        `입력값 확인: 매출 ${formatKRW(revenue || answers.corpRevenue)} / 비용 ${formatKRW(expense || answers.corpExpense)} / 세액공제 ${formatKRW(credit || answers.corpCredit)}`,
      );
      pushBot(calcCorporateEstimate(nextAnswers));
      pushBot('추가로 수정할 항목이 있으면 알려주세요. 보다 정밀한 계산은 원본 계산기 열기로 이동할 수 있어요.');
      setStep('review');
      return;
    }

    if (step === 'review') {
      if (lower.includes('열기')) {
        const name = calculators.find((c) => c.id === calculator)?.name ?? '계산기';
        pushBot('브라우저 전체 화면에서 열 수 있는 링크를 준비했어요.', { links: [{ label: `${name} 계산기 열기`, href: `/${calculator ?? ''}` }] });
        return;
      }
      if (lower.includes('조언') || lower.includes('비교')) {
        pushBot(financialAdvice(answers));
        return;
      }
      if (lower.includes('다시')) {
        resetFlow();
        return;
      }
      pushBot('추가로 궁금한 계산이나 자료가 있으면 알려주세요. 필요한 값을 더 알려주시면 대화 안에서 계속 업데이트해 드릴게요.');
      return;
    }

    pushBot('연말정산/법인세/금융소득 중 하나를 적어 주세요.');
  };

  const quickReplies = () => {
    if (step === 'select') return ['연말정산', '법인세', '금융소득'];
    if (step === 'docs') return ['준비 완료', '간소화 PDF 있음', '배당 원천징수내역 준비'];
    if (step === 'financialIncome') return ['금융 24000000 기타 40000000 gross 0.1', '조언'];
    if (step === 'input' && calculator === 'yearend') return ['총급여 50000000 보험료 1200000 교육비 500000 기부금 300000'];
    if (step === 'input' && calculator === 'corporate') return ['매출 300000000 비용 220000000 세액공제 5000000'];
    if (step === 'input') return ['금액을 알려주세요'];
    if (step === 'review') return ['계산기 열기', '조언', '다시 시작'];
    return [];
  };

  const stepLabels = {
    select: '계산기 선택',
    docs: '자료 확인',
    input: '금액 입력',
    financialIncome: '금액 입력',
    review: '검토/조언',
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

        <div className="messages">
          {messages.map((m, idx) => (
            <ChatBubble key={idx} role={m.role} text={m.text} links={m.links} />
          ))}
        </div>
        <CoupangAd />
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
