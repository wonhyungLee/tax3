import { useMemo, useState } from 'react';
import { Link, Routes, Route, useNavigate } from 'react-router-dom';

const calculators = [
  { id: 'yearend', name: '연말정산', blurb: '근로소득 환급/추납', route: '/yearend', href: '/yearend/index.html' },
  { id: 'corporate', name: '법인세', blurb: 'TaxCore 2025 시뮬레이터', route: '/corporate', href: '/corporate/index.html' },
  { id: 'financial', name: '금융소득 종합과세', blurb: '비교과세 · Gross-up · 해외소득', route: '/financial', href: '/financial/index.html' },
];

const docChecklist = [
  '홈택스 간소화 PDF',
  '배당/이자 원천징수내역',
  '해외 금융소득/외국납부세액',
  '배당 Gross-up 대상 여부',
  '기타 종합소득/소득공제 합계',
];

const formatKRW = (n) => Number(n || 0).toLocaleString('ko-KR');

const ChatBubble = ({ role, children }) => (
  <div className={`bubble-row ${role === 'user' ? 'me' : ''}`}>
    <div className={`bubble ${role}`}>
      <div className="bubble-body">{children}</div>
    </div>
  </div>
);

function useProgress(calculator, step) {
  const steps = useMemo(() => {
    if (calculator === 'financial') {
      return ['select', 'docs', 'financialIncome', 'otherIncome', 'review'];
    }
    if (calculator === 'yearend' || calculator === 'corporate') {
      return ['select', 'docs', 'basic', 'review'];
    }
    return ['select'];
  }, [calculator]);

  const index = Math.max(0, steps.indexOf(step));
  const pct = ((index + 1) / steps.length) * 100;
  return { steps, index, pct };
}

const FinancialSummary = ({ data }) => {
  const { financialIncome, otherIncome, grossUpRate } = data;
  const fin = Number(financialIncome) || 0;
  const other = Number(otherIncome) || 0;
  const grossUp = Number(grossUpRate || 0);
  const threshold = 20_000_000;
  const separateTax = fin * 0.14;
  const progressive = (income) => {
    if (income <= 14_000_000) return income * 0.06;
    if (income <= 50_000_000) return 840000 + (income - 14_000_000) * 0.15;
    if (income <= 88_000_000) return 6240000 + (income - 50_000_000) * 0.24;
    return 15440000 + (income - 88_000_000) * 0.35;
  };
  const grossUpAdd = fin > threshold ? (fin - threshold) * grossUp : 0;
  const comprehensiveTax = progressive(Math.max(other + Math.max(fin - threshold, 0) + grossUpAdd, 0));
  const methodA = comprehensiveTax + threshold * 0.14;
  const methodB = separateTax;
  const chosen = methodA >= methodB ? '종합과세 적용(더 큰 세액)' : '분리과세 유지';
  const note = fin > threshold ? chosen : '2천만원 이하 → 전액 분리과세';

  return (
    <div className="card">
      <p className="pill">비교과세 요약</p>
      <p className="mono">금융소득 {formatKRW(fin)} / 기타소득 {formatKRW(other)}</p>
      <p className="mono">종합 방식(초과분+누진세): ₩ {formatKRW(Math.round(methodA))}</p>
      <p className="mono">전액 분리과세(14%): ₩ {formatKRW(Math.round(methodB))}</p>
      <p className="muted">{note}</p>
    </div>
  );
};

function ChatWizard() {
  const [calculator, setCalculator] = useState(null);
  const [messages, setMessages] = useState([
    { role: 'bot', text: '어떤 계산기를 사용하시나요? 연말정산 · 법인세 · 금융소득 중 하나를 선택해 주세요.' },
  ]);
  const [docReady, setDocReady] = useState([]);
  const [answers, setAnswers] = useState({ financialIncome: '', otherIncome: '', grossUpRate: 0.1 });
  const [step, setStep] = useState('select');
  const { steps, index, pct } = useProgress(calculator, step);
  const navigate = useNavigate();
  const [inputText, setInputText] = useState('');

  const pushMessage = (role, text) => setMessages((prev) => [...prev, { role, text }]);

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

  const handleSelectCalculator = (id) => {
    setCalculator(id);
    setStep('docs');
    pushMessage('user', `${calculators.find((c) => c.id === id)?.name} 계산기를 선택했어요.`);
    pushMessage(
      'bot',
      id === 'financial'
        ? '자료 준비 후 금융소득/기타소득을 입력하면 종합 vs 분리 비교 결과를 바로 알려드릴게요.'
        : '자료 준비 여부를 체크하고 다음 단계로 이동해 주세요.',
    );
  };

  const toggleDoc = (item) => {
    setDocReady((prev) => (prev.includes(item) ? prev.filter((d) => d !== item) : [...prev, item]));
  };

  const goNext = (nextStep, userText) => {
    if (userText) pushMessage('user', userText);
    setStep(nextStep);
  };

  const handleDocsNext = () => {
    pushMessage('user', `준비한 자료: ${docReady.length ? docReady.join(', ') : '없음'}`);
    const next = calculator === 'financial' ? 'financialIncome' : 'basic';
    const helper =
      calculator === 'financial'
        ? '금융소득/기타소득 금액을 입력해 비교과세 결과를 보여드릴게요.'
        : '간단 입력 후 상세 계산기는 별도 페이지에서 이어집니다.';
    pushMessage('bot', helper);
    setStep(next);
  };

  const handleFieldChange = (key, value) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const handleFinancialNext = () => {
    pushMessage(
      'user',
      `금융소득: ${formatKRW(answers.financialIncome)} / 기타소득: ${formatKRW(answers.otherIncome)} / Gross-up 비율: ${answers.grossUpRate}`,
    );
    setStep('review');
    pushMessage('bot', financialAdvice({ ...answers, ...{ financialIncome: answers.financialIncome, otherIncome: answers.otherIncome, grossUpRate: answers.grossUpRate } }));
  };

  const handleBasicNext = () => {
    const name = calculators.find((c) => c.id === calculator)?.name || '계산기';
    pushMessage('bot', `${name} 페이지를 열어 세부 항목을 입력하세요. 자료가 준비되지 않아도 저장 없이 브라우저에서만 처리됩니다.`);
    setStep('review');
  };

  const openCalculator = (id) => {
    const target = calculators.find((c) => c.id === id);
    if (target) navigate(target.route);
  };

  const parseNumeric = (text) => {
    if (!text) return [];
    return (text.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(String(n).replace(/[^\d.]/g, '')));
  };

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    pushMessage('user', text);
    setInputText('');

    const lower = text.toLowerCase();
    if (step === 'select') {
      if (lower.includes('연말') || lower.includes('year')) return handleSelectCalculator('yearend');
      if (lower.includes('법인') || lower.includes('corp')) return handleSelectCalculator('corporate');
      if (lower.includes('금융') || lower.includes('financial')) return handleSelectCalculator('financial');
      return pushMessage('bot', '연말정산/법인세/금융소득 중 하나를 말씀해 주세요. 예: "금융소득 계산"');
    }

    if (step === 'docs') {
      if (lower.includes('준비') || lower.includes('완료') || lower.includes('ok')) return handleDocsNext();
      const found = docChecklist.filter((d) => lower.includes(d.split(' ')[0].toLowerCase()));
      if (found.length) {
        setDocReady((prev) => Array.from(new Set([...prev, ...found])));
        return pushMessage('bot', `${found.join(', ')} 체크되었습니다. "준비 완료"라고 보내면 다음 단계로 이동합니다.`);
      }
      return pushMessage('bot', '자료 준비 여부를 말씀해 주세요. 예: "간소화 PDF 준비", "준비 완료".');
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
        pushMessage(
          'bot',
          `금융소득 ${formatKRW(fin)} / 기타소득 ${formatKRW(other ?? prev.otherIncome)} / Gross-up ${grossRate ?? prev.grossUpRate}`,
        );
        setStep('review');
        return;
      }
      return pushMessage('bot', '숫자를 인식하지 못했어요. 예: "금융 24000000 기타 40000000 gross 0.1"');
    }

    if (step === 'basic') {
      pushMessage('bot', '선택한 계산기로 이동합니다.');
      setStep('review');
      return;
    }

    pushMessage('bot', '선택한 계산기 카드에서 이어서 진행해 주세요.');
  };

  const quickReplies = () => {
    if (step === 'select') return ['연말정산', '법인세', '금융소득'];
    if (step === 'docs') return ['준비 완료', '간소화 PDF 있음', '배당 원천징수내역 준비'];
    if (step === 'financialIncome') return ['금융 24000000 기타 40000000 gross 0.1', '조언'];
    if (step === 'review') return calculators.map((c) => `${c.name} 열기`);
    return [];
  };

  return (
    <section className="shell">
      <div className="wizard-grid">
        <div>
          <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
          <div className="stepper">
            {steps.map((s, i) => (
              <div key={s} className={`step ${i === index ? 'active' : ''} ${i < index ? 'completed' : ''}`}>
                {i + 1}단계 · {s}
              </div>
            ))}
          </div>
          <div className="messages">
            {messages.map((m, idx) => (
              <ChatBubble key={idx} role={m.role}>
                {m.text}
              </ChatBubble>
            ))}
          </div>

          {step === 'select' && (
            <div className="card options">
              <p className="pill">계산기 선택</p>
              <div className="option-grid">
                {calculators.map((c) => (
                  <button key={c.id} className="btn primary" onClick={() => handleSelectCalculator(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 'docs' && (
            <div className="card">
              <p className="pill">자료 준비</p>
              <div className="checks">
                {docChecklist.map((item) => (
                  <label key={item} className="check-row">
                    <input type="checkbox" checked={docReady.includes(item)} onChange={() => toggleDoc(item)} />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
              <button className="btn primary" onClick={handleDocsNext}>다음 단계</button>
            </div>
          )}

          {step === 'financialIncome' && (
            <div className="card">
              <p className="pill">금융소득 입력</p>
              <div className="grid">
                <label className="floating">
                  <input
                    type="number"
                    value={answers.financialIncome}
                    onChange={(e) => handleFieldChange('financialIncome', e.target.value)}
                    placeholder=" "
                  />
                  <span>금융소득 합계 (이자/배당)</span>
                </label>
                <label className="floating">
                  <input
                    type="number"
                    value={answers.otherIncome}
                    onChange={(e) => handleFieldChange('otherIncome', e.target.value)}
                    placeholder=" "
                  />
                  <span>기타 종합소득(근로/사업 등)</span>
                </label>
                <label className="floating">
                  <input
                    type="number"
                    step="0.01"
                    value={answers.grossUpRate}
                    onChange={(e) => handleFieldChange('grossUpRate', e.target.value)}
                    placeholder=" "
                  />
                  <span>배당 Gross-up 비율 (예: 0.1 또는 10)</span>
                </label>
              </div>
              <div className="actions">
                <button className="btn primary" onClick={handleFinancialNext}>비교과세 결과 보기</button>
              </div>
            </div>
          )}

          {step === 'basic' && (
            <div className="card">
              <p className="pill">간단 안내</p>
              <p className="muted">선택한 계산기를 열어 세부 항목을 채워 주세요. 입력 자료는 브라우저에만 저장됩니다.</p>
              <div className="actions">
                <button className="btn primary" onClick={() => openCalculator(calculator)}>계산기 열기</button>
              </div>
            </div>
          )}

          {step === 'review' && calculator === 'financial' && (
            <FinancialSummary data={answers} />
          )}

          {step === 'review' && (
            <div className="card">
              <p className="pill">다음 단계</p>
              <p className="muted">아래 버튼을 눌러 선택한 계산기로 이동해 상세 입력을 완료하세요.</p>
              <div className="actions">
                {calculators.map((c) => (
                  <Link key={c.id} className="btn ghost" to={c.route}>
                    {c.name} 열기
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="side">
          <div className="card">
            <p className="pill">계산기 바로가기</p>
            <ul className="list">
              {calculators.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong> — {c.blurb}{' '}
                  <a href={c.href} target="_blank" rel="noreferrer" className="link">원본 열기</a>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <p className="pill">진행률 안내</p>
            <p className="muted">단계를 나눠 부담을 줄였고, 각 단계에서 필요한 자료와 예상 결과를 바로 보여줍니다.</p>
            <p className="muted">비교과세: 종합 세액과 분리 과세 세액을 나란히 표기해 어떤 방식이 적용되는지 쉽게 알 수 있습니다.</p>
          </div>
        </aside>
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
      <p className="muted">원본 엔진을 React 라우트에서 그대로 불러옵니다. 새 창으로 열어 전 화면에서도 사용할 수 있습니다.</p>
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
            많은 입력을 한 번에 요구하지 않습니다. 필요한 자료 확인 → 소득/공제 입력 → 비교과세 결과를 메시지로 안내하고,
            각 계산기는 별도 페이지에서 가볍게 실행합니다.
          </p>
          <div className="hero-badges">
            <span className="pill">Progressive Disclosure</span>
            <span className="pill">비교과세 강조</span>
            <span className="pill">접근성 준수</span>
          </div>
        </div>
        <div className="actions">
          {calculators.map((c) => (
            <Link key={c.id} className="btn primary" to={c.route}>
              {c.name} 열기
            </Link>
          ))}
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
      <Route path="/yearend" element={<IframePage title="연말정산" src="/yearend/index.html" />} />
      <Route path="/corporate" element={<IframePage title="법인세" src="/corporate/index.html" />} />
      <Route path="/financial" element={<IframePage title="금융소득 종합과세" src="/financial/index.html" />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

export default App;
