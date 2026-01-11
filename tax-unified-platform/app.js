// 탭 전환: 각 탭은 원본 엔진을 포함한 iframe을 보여줍니다.
const switchTab = (tab) => {
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!targetBtn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === targetBtn));
  document.querySelectorAll('.tab-panel').forEach((panel) =>
    panel.classList.toggle('active', panel.id === `tab-${tab}`)
  );
};

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('[data-tab-jump]').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tabJump));
});

// --------------- 실시간 제어/요약 -----------------
const fmtKRW = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toLocaleString('ko-KR')}원`;
};

const parseNumber = (text) => {
  if (!text) return 0;
  const num = Number(String(text).replace(/[^\d-]/g, ''));
  return Number.isFinite(num) ? num : 0;
};

const frames = {
  yearend: document.getElementById('frame-yearend'),
  corporate: document.getElementById('frame-corporate'),
  financial: document.getElementById('frame-financial'),
};

const frameReady = { yearend: false, corporate: false, financial: false };
const calcTimers = {};

const setStatus = (engine, state = '') => {
  document.querySelectorAll(`[data-engine-status="${engine}"]`).forEach((el) => {
    el.classList.remove('ready', 'warn', 'error');
    if (state) el.classList.add(state);
    const label =
      state === 'ready' ? '연결됨' : state === 'warn' ? '동기화 중' : state === 'error' ? '오류' : '대기';
    el.textContent = label;
  });
};

Object.entries(frames).forEach(([engine, frame]) => {
  if (!frame) return;
  frame.addEventListener('load', () => {
    frameReady[engine] = true;
    setStatus(engine, 'ready');
    if (document.getElementById('live-sync')?.checked) {
      syncAll(engine);
    }
    refreshLive();
  });
});

const triggerCalc = (engine) => {
  if (!frameReady[engine]) return;
  clearTimeout(calcTimers[engine]);
  calcTimers[engine] = setTimeout(() => {
    const frame = frames[engine];
    if (!frame) return;
    try {
      if (engine === 'yearend') {
        frame.contentWindow?.calculate?.();
      } else if (engine === 'corporate') {
        frame.contentWindow?.runCalculation?.() || frame.contentDocument?.getElementById('runCalc')?.click();
      } else if (engine === 'financial') {
        frame.contentDocument?.getElementById('calcBtn')?.click();
      }
      setStatus(engine, 'ready');
    } catch (err) {
      console.error(err);
      setStatus(engine, 'error');
    }
  }, 160);
};

const syncQuickInput = (input) => {
  const rawTarget = input.dataset.syncTarget;
  if (!rawTarget) return;
  if (input.value === '' && input.type !== 'checkbox') return;

  // 특별 처리: 금융소득 표 행
  if (rawTarget.startsWith('financial:')) {
    handleFinancialSpecial(rawTarget, input.value);
    return;
  }

  const [engine, field] = rawTarget.split('#');
  const frame = frames[engine];
  if (!frameReady[engine] || !frame?.contentDocument) return;

  const doc = frame.contentDocument;
  const el = doc.getElementById(field);
  if (!el) return;

  if (el.type === 'checkbox') {
    el.checked = input.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.value = input.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  triggerCalc(engine);
};

const handleFinancialSpecial = (rawTarget, value) => {
  if (value === '' || value == null) return;
  const frame = frames.financial;
  if (!frameReady.financial || !frame?.contentDocument) return;
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  const rowsNeeded = rawTarget.includes('dividend') ? 2 : 1;
  while (doc.querySelectorAll('#financialTable tbody tr').length < rowsNeeded) {
    win?.addFinancialRow?.();
  }
  const rows = Array.from(doc.querySelectorAll('#financialTable tbody tr'));
  const row = rawTarget.includes('dividend') ? rows[1] : rows[0];
  if (!row) return;

  const [typeSel, sourceSel] = row.querySelectorAll('select');
  const [amtInput, rateInput, grossChk, prepaidInput] = row.querySelectorAll('input');

  if (typeSel) typeSel.value = rawTarget.includes('dividend') ? 'dividend' : 'interest';
  if (sourceSel) sourceSel.value = 'domestic';

  const numeric = Number(value);
  if (Number.isFinite(numeric) && amtInput) {
    amtInput.value = numeric;
    amtInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (rateInput) {
    rateInput.value = rawTarget.includes('dividend') ? 15 : 14;
    rateInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (grossChk) {
    grossChk.checked = rawTarget.includes('dividend');
    grossChk.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (prepaidInput && Number.isFinite(numeric)) {
    prepaidInput.value = Math.floor(numeric * 0.15);
    prepaidInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  triggerCalc('financial');
};

const syncAll = (engine) => {
  const inputs = document.querySelectorAll(engine ? `[data-sync-target^="${engine}"]` : '[data-sync-target]');
  inputs.forEach((input) => syncQuickInput(input));
};

const autoSync = document.getElementById('live-sync');
const quickInputs = document.querySelectorAll('[data-sync-target]');
quickInputs.forEach((input) => {
  input.addEventListener('input', () => {
    if (!autoSync || autoSync.checked) {
      syncQuickInput(input);
    }
  });
});

document.getElementById('reset-quick')?.addEventListener('click', () => {
  quickInputs.forEach((input) => {
    input.value = '';
  });
  refreshLive();
});

const readYearendSnapshot = () => {
  const doc = frames.yearend?.contentDocument;
  if (!doc) return null;
  const pick = (attr) => doc.querySelector(`[data-output="${attr}"]`)?.textContent?.trim() || '';
  return {
    refund: pick('refundAmount'),
    refundLabel: pick('refundLabel'),
    taxable: pick('taxableIncome'),
    cardNeed: pick('cardAdditionalNeeded'),
  };
};

const readCorporateSnapshot = () => {
  const doc = frames.corporate?.contentDocument;
  if (!doc) return null;
  const cards = Array.from(doc.querySelectorAll('#results .result-card'));
  const byTitle = (title) =>
    cards.find((c) => c.querySelector('.result-title')?.textContent?.includes(title)) ||
    cards.find((c) => c.querySelector('.result-title')?.textContent === title);
  const valueOf = (title) => byTitle(title)?.querySelector('.result-value')?.textContent?.trim() || '';
  return {
    finalTax: valueOf('최종 납부세액'),
    payable: valueOf('차감 납부/환급'),
    taxBase: valueOf('과세표준'),
  };
};

const readFinancialSnapshot = () => {
  const doc = frames.financial?.contentDocument;
  if (!doc) return null;
  const primary = doc.getElementById('resultPrimary');
  const warnings = doc.getElementById('resultWarnings');
  const other = doc.getElementById('otherIncomeGross');
  return {
    primary: primary ? primary.textContent.trim().replace(/\s+/g, ' ') : '',
    warnings: warnings ? warnings.textContent.trim().replace(/\s+/g, ' ') : '',
    other: other ? other.value : '',
  };
};

const updateLiveUI = (snap) => {
  const setText = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = value || '—';
  };

  setText('[data-live-yearend="refund"]', snap.yearend?.refund || '대기');
  setText('[data-live-yearend="taxable"]', snap.yearend?.taxable || '-');
  setText('[data-live-yearend="cardNeed"]', snap.yearend?.cardNeed || '-');

  setText('[data-live-corporate="finalTax"]', snap.corporate?.finalTax || '대기');
  setText('[data-live-corporate="payable"]', snap.corporate?.payable || '-');
  setText('[data-live-corporate="taxBase"]', snap.corporate?.taxBase || '-');

  setText('[data-live-financial="primary"]', snap.financial?.primary || '대기');
  setText('[data-live-financial="warnings"]', snap.financial?.warnings || '-');
  setText('[data-live-financial="other"]', snap.financial?.other || '-');
};

const buildStrategies = (snap) => {
  const tips = [];
  const additional = parseNumber(snap.yearend?.cardNeed || '');
  if (additional > 0) {
    tips.push(`카드 공제 추가 여유 약 ${fmtKRW(additional)}: 체크·시장/교통 비중을 늘려 한도 도달을 확인하세요.`);
  }

  const refund = parseNumber(snap.yearend?.refund || '');
  if (refund <= 0 && snap.yearend?.refund) {
    tips.push('연말정산 환급이 적거나 추납이라면 연금계좌·보험료 세액공제 입력을 재확인하세요.');
  }

  const corpPayable = parseNumber(snap.corporate?.payable || '');
  if (corpPayable > 0) {
    tips.push('법인세 납부가 발생하면 R&D/투자 세액공제, 접대비 문화·전통시장 한도 여유를 확인하세요.');
  } else if (corpPayable < 0) {
    tips.push('법인세 환급 시에도 최저한세 카드에서 공제 적용 범위를 확인하세요.');
  }

  const finWarn = snap.financial?.warnings || '';
  if (finWarn.toLowerCase().includes('초과') || finWarn.toLowerCase().includes('한도')) {
    tips.push('금융소득 한도 초과 경고가 있으면 배당 Gross-up 비율·외국납부세액 공제 한도를 조정하세요.');
  }

  if (!tips.length) {
    tips.push('엔진을 불러오고 입력을 채우면 자동으로 전략을 제안합니다.');
  }

  const list = document.getElementById('strategy-list');
  if (list) {
    list.innerHTML = tips.map((tip) => `<li>${tip}</li>`).join('');
  }
};

const updateShareFields = (snap) => {
  const yearend = document.getElementById('share-yearend');
  const corporate = document.getElementById('share-corporate');
  const financial = document.getElementById('share-financial');
  if (yearend) yearend.value = snap.yearend?.refund || '';
  if (corporate) corporate.value = snap.corporate?.payable || '';
  if (financial) financial.value = snap.financial?.primary || '';
};

const refreshLive = () => {
  const snap = {
    yearend: readYearendSnapshot(),
    corporate: readCorporateSnapshot(),
    financial: readFinancialSnapshot(),
  };
  updateLiveUI(snap);
  buildStrategies(snap);
  updateShareFields(snap);
};

document.getElementById('refresh-live')?.addEventListener('click', refreshLive);
setInterval(refreshLive, 2000);

const shareUrl = document.getElementById('share-url');
const buildShareButton = document.getElementById('build-share');
const copyShareButton = document.getElementById('copy-share');

const buildShareLink = () => {
  const params = new URLSearchParams();
  const yearend = document.getElementById('share-yearend')?.value || '';
  const corp = document.getElementById('share-corporate')?.value || '';
  const fin = document.getElementById('share-financial')?.value || '';
  const note = document.getElementById('share-note')?.value || '';
  if (yearend) params.set('yearend', yearend);
  if (corp) params.set('corporate', corp);
  if (fin) params.set('financial', fin);
  if (note) params.set('note', note);
  const url = new URL('share.html', window.location.href);
  url.search = params.toString();
  if (shareUrl) shareUrl.value = url.toString();
};

buildShareButton?.addEventListener('click', () => {
  buildShareLink();
  shareUrl?.focus();
});

copyShareButton?.addEventListener('click', async () => {
  if (!shareUrl?.value) {
    buildShareLink();
  }
  if (!shareUrl?.value) return;
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    copyShareButton.textContent = '복사 완료';
    setTimeout(() => (copyShareButton.textContent = '복사'), 1500);
  } catch (err) {
    console.error(err);
  }
});

// 파트너스 링크 초기화 (필요 시 코드만 교체)
document.querySelectorAll('[data-partner-url]').forEach((link) => {
  const href = link.getAttribute('data-partner-url');
  if (href) link.setAttribute('href', href);
});

// 초반 상태 업데이트
refreshLive();
