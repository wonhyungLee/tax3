import { useMemo, useState } from 'react';
import { Link, Routes, Route } from 'react-router-dom';

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

const partnerId = import.meta.env.VITE_COUPANG_PARTNER_ID || 'AF7397099';
const buildAdLink = (keyword) => `https://link.coupang.com/a/${partnerId}?search=${encodeURIComponent(keyword)}`;
const coupangProxy = import.meta.env.VITE_COUPANG_PROXY_URL || '';
const bestCategoryId = 1016; // 가전디지털
const adInjectChance = 0.22;
const placeholderImage = 'https://via.placeholder.com/480x300.png?text=%EA%B0%80%EC%A0%84%EB%94%94%EC%A7%80%ED%84%B8+Best';

const adProducts = [
  {
    title: '연말정산 준비 파일 세트',
    desc: '서류 정리를 위한 라벨/바인더 구성',
    price: 12900,
    keyword: '연말정산',
    image: 'https://via.placeholder.com/320x200.png?text=%EC%97%B0%EB%A7%90%EC%A0%95%EC%82%B0+%EB%B0%94%EC%9D%B4%EB%8D%94',
  },
  {
    title: '세무 기초 가이드',
    desc: '비교과세와 공제를 쉽게 풀어쓴 도서',
    price: 15800,
    keyword: '가이드',
    image: 'https://via.placeholder.com/320x200.png?text=%EC%84%B8%EB%AC%B4+%EA%B0%80%EC%9D%B4%EB%93%9C',
  },
  {
    title: '문서 스캐너 앱 구독',
    desc: '모바일로 영수증/증빙을 빠르게 저장',
    price: 9900,
    keyword: '스캐너',
    image: 'https://via.placeholder.com/320x200.png?text=%EB%AC%B8%EC%84%9C+%EC%8A%A4%EC%BA%90%EB%84%88',
  },
];

const ChatBubble = ({ role, text, links = [], ads = [] }) => (
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
      {ads && ads.length > 0 && (
        <div className="ads">
          {ads.map((ad) => (
            <a key={ad.title} href={ad.link} target="_blank" rel="noreferrer" className="ad-card">
              {ad.image && <img className="ad-img" src={ad.image} alt={ad.title} />}
              <div className="ad-title">{ad.title}</div>
              <div className="ad-desc">{ad.desc}</div>
              <div className="ad-price">₩ {formatKRW(ad.price)}</div>
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
    if (calculator === 'yearend' || calculator === 'corporate') return ['select', 'docs', 'review'];
    return ['select', 'docs', 'review'];
  }, [calculator]);

  const index = Math.max(0, steps.indexOf(step));
  const pct = ((index + 1) / steps.length) * 100;
  return { steps, index, pct };
}

function ChatWizard() {
  const [calculator, setCalculator] = useState(null);
  const [messages, setMessages] = useState([
    { role: 'bot', text: '메신저처럼 대화하며 계산을 안내합니다. 자료 준비 → 금액 입력 → 결과/링크 순서로 진행해요.' },
    { role: 'bot', text: '연말정산 · 법인세 · 금융소득 중 무엇을 계산할까요?' },
  ]);
  const [docReady, setDocReady] = useState([]);
  const [answers, setAnswers] = useState({ financialIncome: '', otherIncome: '', grossUpRate: 0.1 });
  const [step, setStep] = useState('select');
  const [consent, setConsent] = useState(false);
  const [awaitingConsent, setAwaitingConsent] = useState(false);
  const [pendingAdContext, setPendingAdContext] = useState(null);
  const [messageCount, setMessageCount] = useState(0);
  const { steps, index, pct } = useProgress(calculator, step);
  const [inputText, setInputText] = useState('');
  const calculatorLinks = calculators.map((c) => ({ label: `${c.name} 열기`, href: c.route }));
  const calcKeyword = (ctx) => {
    if (ctx === 'yearend') return '연말정산';
    if (ctx === 'corporate') return '법인';
    if (ctx === 'financial') return '금융소득';
    return ctx || '';
  };

  const pushMessage = (payload) => {
    setMessages((prev) => [...prev, payload]);
    setMessageCount((n) => n + 1);
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

  const fallbackAds = () => adProducts.map((ad) => ({ ...ad, link: buildAdLink(ad.keyword) }));

const normalizeAd = (item) => ({
  title: item.title || item.productName || item.name,
  desc: item.desc || item.description || item.productDescription || '가전디지털 인기 상품',
  price: item.price || item.salePrice || item.salesPrice,
  image: item.image || item.imageUrl || item.productImage || item.productImageUrl || adProducts[0].image,
  link: item.deeplink || item.link || item.url || item.productUrl || buildAdLink('가전디지털'),
});

  const fetchDeeplink = async (url) => {
    if (!coupangProxy || !url) return null;
    try {
      const res = await fetch(`${coupangProxy}/deeplink`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coupangUrl: url }),
      });
      if (!res.ok) throw new Error(`deeplink HTTP ${res.status}`);
      const data = await res.json();
      const list = data?.data?.deeplinks || data?.data?.links || data?.data || [];
      const first = Array.isArray(list) ? list[0] : data?.data;
      return first?.shortenUrl || first?.shortUrl || first?.link || first?.url || null;
    } catch (err) {
      console.error('deeplink error', err);
      return null;
    }
  };

  const fetchCoupangAds = async (categoryId = bestCategoryId) => {
    if (!coupangProxy) return fallbackAds();
    try {
      const res = await fetch(`${coupangProxy}/products/bestcategories/${categoryId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items =
        (Array.isArray(data) && data) ||
        data?.data?.productData ||
        data?.data?.bestProducts ||
        data?.data?.contentData ||
        data?.data?.products ||
        data?.data?.content ||
        data?.data ||
        data?.rData?.productData ||
        data?.products ||
        [];
      const rawAds = items.slice(0, 4).map(normalizeAd).filter((a) => a.title);
      const ads = await Promise.all(
        rawAds.map(async (ad) => {
          const deeplink = await fetchDeeplink(ad.link);
          return { ...ad, link: deeplink || ad.link, image: ad.image || placeholderImage };
        }),
      );
      if (ads.length) return ads;
    } catch (err) {
      console.error('coupang fetch error', err);
    }
    return fallbackAds();
  };

  const showAds = (contextMessage) => {
    fetchCoupangAds().then((ads) => {
      pushBot(contextMessage || '쿠팡 파트너스 추천 상품입니다. 필요한 경우 새 창에서 열립니다.', { ads });
    });
  };

  const showContextAds = (context) => {
    const keyword = calcKeyword(context || calculator);
    fetchCoupangAds(bestCategoryId).then((ads) => {
      const filtered = ads.filter((ad) => keyword ? (ad.title?.includes(keyword) || ad.desc?.includes(keyword)) : true);
      pushBot('동의해 주셔서 감사해요. 대화 내용을 참고한 추천 상품입니다.', { ads: filtered.length ? filtered : ads });
    });
  };

  const requestConsent = (context) => {
    setAwaitingConsent(true);
    setPendingAdContext(context || null);
    pushBot('대화 기록을 참고해 상품을 추천해도 될까요? "동의" 또는 "거부"라고 답해주세요.');
  };

  const resetFlow = () => {
    setCalculator(null);
    setDocReady([]);
    setAnswers({ financialIncome: '', otherIncome: '', grossUpRate: 0.1 });
    setStep('select');
    setConsent(false);
    setAwaitingConsent(false);
    setPendingAdContext(null);
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
    pushBot('필요한 자료를 체크한 뒤, 준비 완료라고 입력하면 다음 단계로 넘어갑니다.');
    pushBot(`준비 예시: ${docChecklist.join(' · ')}`);
  };

  const handleDocsNext = () => {
    pushUser(`준비한 자료: ${docReady.length ? docReady.join(', ') : '없음'}`);
    const next = calculator === 'financial' ? 'financialIncome' : 'review';
    if (calculator === 'financial') {
      pushBot('금융소득/기타소득 금액을 메시지로 알려주세요. 예: "금융 24000000 기타 40000000 gross 0.1"');
      setStep(next);
      return;
    }
    const selected = calculators.find((c) => c.id === calculator);
    const links = selected ? [{ label: `${selected.name} 열기`, href: selected.route }, ...calculatorLinks] : calculatorLinks;
    pushBot('바로 계산기를 열 수 있어요. 필요한 페이지를 선택해 주세요.', { links });
    setStep(next);
    if (consent) showContextAds(selected?.id);
    else requestConsent(selected?.id);
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

    if (awaitingConsent && (lower.includes('동의') || lower.includes('허용'))) {
      setConsent(true);
      setAwaitingConsent(false);
      pushBot('동의해 주셔서 감사합니다. 맞춤 추천을 준비할게요.');
      showContextAds(pendingAdContext);
      setPendingAdContext(null);
      return;
    }
    if (awaitingConsent && (lower.includes('거부') || lower.includes('안 해') || lower.includes('싫'))) {
      setConsent(false);
      setAwaitingConsent(false);
      setPendingAdContext(null);
      pushBot('네, 동의 없이 기록은 사용하지 않고 일반 추천만 제공합니다.');
      showAds();
      return;
    }

    if (lower.includes('광고') || lower.includes('추천') || lower.includes('쇼핑') || lower.includes('로그')) {
      if (consent) showContextAds(calculator);
      else requestConsent(calculator);
      return;
    }

    if (consent && Math.random() < adInjectChance && messageCount > 3) {
      showContextAds(calculator);
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
        pushBot('필요한 계산기를 바로 열 수 있습니다.', { links: calculatorLinks });
        showAds();
        return;
      }
      if (lower.includes('조언')) {
        pushBot(financialAdvice(answers));
        return;
      }
      return pushBot('숫자를 인식하지 못했어요. 예: "금융 24000000 기타 40000000 gross 0.1"');
    }

    if (step === 'review') {
      if (lower.includes('열기')) {
        pushBot('아래 링크에서 계산기를 바로 열 수 있습니다.', { links: calculatorLinks });
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
      pushBot('추가로 궁금한 계산이나 자료가 있으면 알려주세요. "열기"라고 입력하면 계산기 링크를 다시 보여드려요.');
      return;
    }

    pushBot('연말정산/법인세/금융소득 중 하나를 적어 주세요.');
  };

  const quickReplies = () => {
    if (awaitingConsent) return ['동의', '거부'];
    if (step === 'select') return ['연말정산', '법인세', '금융소득', '광고 추천'];
    if (step === 'docs') return ['준비 완료', '간소화 PDF 있음', '배당 원천징수내역 준비', '광고 추천'];
    if (step === 'financialIncome') return ['금융 24000000 기타 40000000 gross 0.1', '조언', '광고 추천'];
    if (step === 'review') return ['계산기 열기', '조언', '다시 시작', '광고 추천'];
    return [];
  };

  const stepLabels = {
    select: '계산기 선택',
    docs: '자료 확인',
    financialIncome: '금액 입력',
    review: '검토/열기',
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
            <ChatBubble key={idx} role={m.role} text={m.text} links={m.links} ads={m.ads} />
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
