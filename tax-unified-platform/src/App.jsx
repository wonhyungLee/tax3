import { useMemo, useState } from 'react';
import { Routes, Route } from 'react-router-dom';

const calculators = [
  { id: 'yearend', name: '연말정산', blurb: '근로소득 환급/추납' },
  { id: 'corporate', name: '법인세', blurb: 'TaxCore 2025 시뮬레이터' },
  { id: 'financial', name: '금융소득 종합과세', blurb: '비교과세 · Gross-up · 해외소득' },
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
    if (calculator === 'financial') {
      pushBot('금융소득/기타소득 금액을 메시지로 알려주세요. 예: "금융 24000000 기타 40000000 gross 0.1"');
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
      setAnswers((prev) => ({
        ...prev,
        salary: salary ? Number(String(salary).replace(/[^\d]/g, '')) : prev.salary || '',
        insurance: insurance ? Number(String(insurance).replace(/[^\d]/g, '')) : prev.insurance || '',
        education: education ? Number(String(education).replace(/[^\d]/g, '')) : prev.education || '',
        donation: donation ? Number(String(donation).replace(/[^\d]/g, '')) : prev.donation || '',
      }));
      pushBot(
        `입력값 확인: 총급여 ${formatKRW(salary || answers.salary)} / 보험료 ${formatKRW(insurance || answers.insurance)} / 교육비 ${formatKRW(education || answers.education)} / 기부금 ${formatKRW(donation || answers.donation)}`,
      );
      pushBot('간단 계산은 브라우저에서만 처리됩니다. 추가로 수정할 항목이 있으면 알려주세요.');
      setStep('review');
      return;
    }

    if (step === 'input' && calculator === 'corporate') {
      const revenue = text.match(/(매출|수익)\s*([\d,\.]+)/i)?.[2];
      const expense = text.match(/(비용|지출)\s*([\d,\.]+)/i)?.[2];
      const credit = text.match(/(세액공제|공제)\s*([\d,\.]+)/i)?.[2];
      setAnswers((prev) => ({
        ...prev,
        corpRevenue: revenue ? Number(String(revenue).replace(/[^\d]/g, '')) : prev.corpRevenue || '',
        corpExpense: expense ? Number(String(expense).replace(/[^\d]/g, '')) : prev.corpExpense || '',
        corpCredit: credit ? Number(String(credit).replace(/[^\d]/g, '')) : prev.corpCredit || '',
      }));
      pushBot(
        `입력값 확인: 매출 ${formatKRW(revenue || answers.corpRevenue)} / 비용 ${formatKRW(expense || answers.corpExpense)} / 세액공제 ${formatKRW(credit || answers.corpCredit)}`,
      );
      pushBot('간단 계산은 브라우저에서만 처리됩니다. 추가로 수정할 항목이 있으면 알려주세요.');
      setStep('review');
      return;
    }

    if (step === 'review') {
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
    if (step === 'review') return ['조언', '다시 시작'];
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
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

export default App;
