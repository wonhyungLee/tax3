const rootEl = document.documentElement;
const bodyEl = document.body;
const themeToggleBtn = document.getElementById('theme-toggle');
const contrastSlider = document.getElementById('contrast-slider');
const a11yModal = document.getElementById('a11y-modal');
const openA11yBtn = document.getElementById('open-a11y');
const SESSION_KEY = 'tax-session';

const logEvent = (type, detail = {}) => {
  console.debug(`[log:${type}]`, detail);
  try {
    const raw = localStorage.getItem('tax-logs');
    const list = raw ? JSON.parse(raw) : [];
    list.push({ type, detail, ts: Date.now() });
    while (list.length > 50) list.shift();
    localStorage.setItem('tax-logs', JSON.stringify(list));
  } catch (_) {
    /* ignore logging failures */
  }
};

window.addEventListener('error', (e) =>
  logEvent('error', { message: e.message, source: e.filename || '', line: e.lineno })
);

const initSentry = () => {
  const dsn = window.SENTRY_DSN || document.querySelector('meta[name="sentry-dsn"]')?.content;
  if (!dsn) return;
  const script = document.createElement('script');
  script.src = 'https://browser.sentry-cdn.com/7.103.0/bundle.tracing.min.js';
  script.crossOrigin = 'anonymous';
  script.referrerPolicy = 'origin';
  script.onload = () => {
    if (!window.Sentry) return;
    const integrations = window.Sentry.BrowserTracing ? [new window.Sentry.BrowserTracing()] : [];
    window.Sentry.init({
      dsn,
      integrations,
      tracesSampleRate: 0.2,
    });
    logEvent('sentry_init');
  };
  document.head.appendChild(script);
};
initSentry();

const setTheme = (mode) => {
  const next = mode === 'dark' ? 'dark' : 'light';
  rootEl?.setAttribute('data-theme', next);
  bodyEl?.setAttribute('data-theme', next);
  if (themeToggleBtn) {
    themeToggleBtn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
  }
  try {
    localStorage.setItem('tax-theme', next);
  } catch (_) {
    /* localStorage unavailable */
  }
  logEvent('theme', { theme: next });
};

const savedTheme = (() => {
  try {
    return localStorage.getItem('tax-theme');
  } catch (_) {
    return null;
  }
})();
setTheme(savedTheme || bodyEl?.dataset.theme || 'light');

themeToggleBtn?.addEventListener('click', () => {
  const current = rootEl?.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  setTheme(current === 'dark' ? 'light' : 'dark');
});

const setContrast = (value) => {
  const ratio = Math.max(0.8, Math.min(1.3, value));
  rootEl?.style.setProperty('--contrast-filter', ratio.toString());
  try {
    localStorage.setItem('tax-contrast', ratio.toString());
  } catch (_) {
    /* ignore */
  }
  logEvent('contrast', { ratio });
};

const savedContrast = (() => {
  try {
    return parseFloat(localStorage.getItem('tax-contrast'));
  } catch (_) {
    return null;
  }
})();
if (savedContrast && contrastSlider) {
  contrastSlider.value = Math.round(savedContrast * 100);
  setContrast(savedContrast);
}

contrastSlider?.addEventListener('input', () => {
  const val = Number(contrastSlider.value || 100) / 100;
  setContrast(val);
});

const modal = document.getElementById('info-modal');
const openModalBtn = document.getElementById('open-modal');
const closeModal = () => modal?.classList.remove('open');
const openModal = () => modal?.classList.add('open');

openModalBtn?.addEventListener('click', openModal);
modal?.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});
document.querySelectorAll('[data-close-modal]').forEach((btn) =>
  btn.addEventListener('click', closeModal)
);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

const closeA11y = () => a11yModal?.classList.remove('open');
const openA11y = () => a11yModal?.classList.add('open');
openA11yBtn?.addEventListener('click', openA11y);
a11yModal?.addEventListener('click', (e) => {
  if (e.target === a11yModal) closeA11y();
});
document.querySelectorAll('[data-close-a11y]').forEach((btn) => btn.addEventListener('click', closeA11y));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeA11y();
});
// 탭 전환: 각 탭은 원본 엔진을 포함한 iframe을 보여줍니다.
const switchTab = (tab) => {
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!targetBtn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === targetBtn));
  document.querySelectorAll('.tab-panel').forEach((panel) =>
    panel.classList.toggle('active', panel.id === `tab-${tab}`)
  );
  document.querySelectorAll('[data-tab-accordion]').forEach((btn) => {
    const isActive = btn.dataset.tabAccordion === tab;
    btn.setAttribute('aria-expanded', isActive ? 'true' : 'false');
  });
  ensureFrameLoaded(tab);
  logEvent('tab_switch', { tab });
};

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('[data-tab-jump]').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tabJump));
});

document.querySelectorAll('[data-tab-accordion]').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tabAccordion));
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
const frameLoaded = { yearend: false, corporate: false, financial: false };
const frameSources = {};
const summarySidebar = document.querySelector('.summary-sidebar');
const summaryToggle = document.getElementById('toggle-summary');
const chartBars = document.getElementById('chart-bars');
const chartTooltip = document.getElementById('chart-tooltip');

Object.entries(frames).forEach(([engine, frame]) => {
  if (!frame) return;
  const src = frame.getAttribute('src');
  if (src) {
    frameSources[engine] = src;
    if (engine !== 'yearend') {
      frame.removeAttribute('src'); // lazy load for secondary engines
    }
  }
});

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

const ensureFrameLoaded = (engine) => {
  const frame = frames[engine];
  if (!frame || frameLoaded[engine]) return;
  const src = frameSources[engine];
  if (src) {
    setStatus(engine, 'warn');
    frame.setAttribute('src', src);
    frameLoaded[engine] = true;
  }
};

const setSummaryCollapsed = (collapsed, manual = true) => {
  if (!summarySidebar) return;
  summarySidebar.classList.toggle('collapsed', collapsed);
  summaryToggle?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  summaryToggle && (summaryToggle.textContent = collapsed ? '펼치기' : '접기');
  if (manual) logEvent('summary_toggle', { collapsed });
};

const handleAutoCollapse = () => {
  const shouldCollapse = window.innerWidth < 1200;
  if (summarySidebar) {
    summarySidebar.dataset.autoCollapse = shouldCollapse ? 'true' : 'false';
  }
  if (shouldCollapse) {
    setSummaryCollapsed(true, false);
  } else {
    setSummaryCollapsed(false, false);
  }
};

summaryToggle?.addEventListener('click', () => setSummaryCollapsed(!summarySidebar?.classList.contains('collapsed')));
window.addEventListener('resize', handleAutoCollapse);
handleAutoCollapse();

Object.entries(frames).forEach(([engine, frame]) => {
  if (!frame) return;
  frame.addEventListener('load', () => {
    frameLoaded[engine] = true;
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

const collapsibleCards = document.querySelectorAll('.control-card[data-collapsible="true"]');
const applyCardCollapse = () => {
  const collapse = window.innerWidth < 720;
  collapsibleCards.forEach((card) => {
    card.dataset.collapsed = collapse ? 'true' : 'false';
  });
};

collapsibleCards.forEach((card) => {
  const head = card.querySelector('.control-card-head');
  if (!head) return;
  head.addEventListener('click', () => {
    const next = card.dataset.collapsed !== 'true';
    card.dataset.collapsed = next ? 'true' : 'false';
  });
});

window.addEventListener('resize', applyCardCollapse);
applyCardCollapse();

const autoSync = document.getElementById('live-sync');
const quickInputs = document.querySelectorAll('[data-sync-target]');
const advancedPanel = document.getElementById('advanced-panel');
const advancedInputs = document.querySelectorAll('[data-advanced]');
const toggleAdvancedBtn = document.getElementById('toggle-advanced');
const saveSessionBtn = document.getElementById('save-session');
const loadSessionBtn = document.getElementById('load-session');
const clearSessionBtn = document.getElementById('clear-session');

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
  advancedInputs.forEach((input) => {
    input.value = '';
  });
  refreshLive();
});

const toggleAdvanced = () => {
  if (!advancedPanel || !toggleAdvancedBtn) return;
  const isHidden = advancedPanel.hasAttribute('hidden');
  if (isHidden) {
    advancedPanel.removeAttribute('hidden');
  } else {
    advancedPanel.setAttribute('hidden', 'true');
  }
  toggleAdvancedBtn.textContent = isHidden ? '고급 입력 닫기' : '고급 입력 열기';
  logEvent('advanced_toggle', { open: isHidden });
};

toggleAdvancedBtn?.addEventListener('click', toggleAdvanced);

const readSession = () => {
  const quick = {};
  quickInputs.forEach((input) => {
    quick[input.dataset.syncTarget] = input.value;
  });
  const advanced = {};
  advancedInputs.forEach((input) => {
    advanced[input.dataset.advanced] = input.value;
  });
  return {
    quick,
    advanced,
    theme: rootEl?.getAttribute('data-theme') || 'light',
    contrast: rootEl?.style.getPropertyValue('--contrast-filter') || getComputedStyle(rootEl).getPropertyValue('--contrast-filter'),
    ts: Date.now(),
  };
};

const applySession = (data) => {
  if (!data) return;
  Object.entries(data.quick || {}).forEach(([target, value]) => {
    const input = document.querySelector(`[data-sync-target="${target}"]`);
    if (input) {
      input.value = value;
      if (!autoSync || autoSync.checked) {
        syncQuickInput(input);
      }
    }
  });
  Object.entries(data.advanced || {}).forEach(([key, value]) => {
    const input = document.querySelector(`[data-advanced="${key}"]`);
    if (input) input.value = value;
  });
  if (data.advanced && Object.keys(data.advanced).length && advancedPanel?.hasAttribute('hidden')) {
    toggleAdvanced();
  }
  if (data.theme) setTheme(data.theme);
  if (data.contrast) setContrast(parseFloat(data.contrast));
  refreshLive();
};

const saveSession = () => {
  try {
    const payload = readSession();
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    logEvent('session_save', { ts: payload.ts });
    alert('계산이 저장되었습니다.');
  } catch (err) {
    console.error(err);
  }
};

const loadSession = () => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return alert('저장된 계산이 없습니다.');
    const data = JSON.parse(raw);
    applySession(data);
    logEvent('session_load', { ts: data.ts });
  } catch (err) {
    console.error(err);
  }
};

const clearSession = () => {
  try {
    localStorage.removeItem(SESSION_KEY);
    alert('저장 데이터를 삭제했습니다.');
    logEvent('session_clear');
  } catch (err) {
    console.error(err);
  }
};

saveSessionBtn?.addEventListener('click', saveSession);
loadSessionBtn?.addEventListener('click', loadSession);
clearSessionBtn?.addEventListener('click', clearSession);

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

const updateSummary = (snap) => {
  const setValue = (key, value) => {
    const el = document.querySelector(`[data-summary="${key}"]`);
    if (el) el.textContent = value || '—';
  };
  const setNote = (key, value) => {
    const el = document.querySelector(`[data-summary-note="${key}"]`);
    if (el && value) el.textContent = value;
  };

  setValue('yearend-refund', snap.yearend?.refund || '대기');
  setNote(
    'yearend',
    snap.yearend?.refundLabel
      ? `${snap.yearend.refundLabel} · 카드 추가 ${snap.yearend.cardNeed || '-'}`
      : '환급/추납 추적'
  );

  setValue('corporate-payable', snap.corporate?.payable || '-');
  setNote(
    'corporate',
    snap.corporate?.taxBase ? `과세표준 ${snap.corporate.taxBase}` : '납부/환급, 과표 흐름'
  );

  setValue('financial-primary', snap.financial?.primary || '-');
  setNote('financial', snap.financial?.warnings || '비교과세 결과/경고');
};

const updateChart = (snap) => {
  if (!chartBars) return;
  const values = {
    yearend: Math.abs(parseNumber(snap.yearend?.refund || '')),
    corporate: Math.abs(parseNumber(snap.corporate?.payable || '')),
    financial: Math.abs(
      parseNumber(snap.financial?.other || '') || parseNumber(snap.financial?.primary || '')
    ),
  };
  const max = Math.max(values.yearend, values.corporate, values.financial, 1);
  chartBars.querySelectorAll('.chart-bar').forEach((bar) => {
    const kind = bar.dataset.kind;
    const val = values[kind] || 0;
    const percent = Math.max(6, Math.min(100, (val / max) * 100));
    const fill = bar.querySelector('.chart-bar-fill');
    if (fill) {
      fill.style.height = `${percent}%`;
      fill.style.opacity = val === 0 ? '0.35' : '0.9';
    }
    bar.dataset.value = val.toString();
    bar.dataset.percent = Math.round(percent).toString();
  });
};

const showChartTooltip = (bar, event) => {
  if (!chartTooltip) return;
  const value = Number(bar.dataset.value || 0);
  const percent = bar.dataset.percent || '0';
  chartTooltip.textContent = `${value.toLocaleString('ko-KR')}원 · ${percent}%`;
  const parentRect = chartBars.getBoundingClientRect();
  chartTooltip.style.opacity = '1';
  chartTooltip.style.left = `${event.clientX - parentRect.left - 30}px`;
  chartTooltip.style.top = `${event.clientY - parentRect.top - 40}px`;
};

const hideChartTooltip = () => {
  if (chartTooltip) chartTooltip.style.opacity = '0';
};

chartBars?.querySelectorAll('.chart-bar').forEach((bar) => {
  bar.addEventListener('mousemove', (e) => showChartTooltip(bar, e));
  bar.addEventListener('mouseenter', (e) => showChartTooltip(bar, e));
  bar.addEventListener('mouseleave', hideChartTooltip);
});

const flowOrder = ['input', 'deduction', 'taxbase', 'tax', 'result'];
const setFlowStage = (stage) => {
  const idx = flowOrder.indexOf(stage);
  document.querySelectorAll('[data-step]').forEach((step) => {
    const stepIdx = flowOrder.indexOf(step.dataset.step);
    step.classList.toggle('active', step.dataset.step === stage);
    step.classList.toggle('complete', stepIdx > -1 && stepIdx < idx);
  });
};

const deriveFlowStage = (snap) => {
  const hasInput = Array.from(document.querySelectorAll('[data-sync-target]')).some(
    (el) => el.value !== ''
  );
  if (!hasInput) return 'input';

  const hasDeduction =
    parseNumber(snap.yearend?.cardNeed || '') > 0 ||
    parseNumber(snap.corporate?.taxBase || '') > 0 ||
    parseNumber(snap.financial?.other || '') > 0;
  if (!hasDeduction) return 'deduction';

  const hasTaxBase =
    (snap.yearend?.taxable && snap.yearend.taxable !== '-') ||
    (snap.corporate?.taxBase && snap.corporate.taxBase !== '-') ||
    (snap.financial?.other && snap.financial.other !== '-');
  if (!hasTaxBase) return 'taxbase';

  const hasTax =
    (snap.yearend?.refund && snap.yearend.refund !== '대기') ||
    (snap.corporate?.payable && snap.corporate.payable !== '-') ||
    (snap.financial?.primary && snap.financial.primary !== '대기');
  if (!hasTax) return 'tax';

  return 'result';
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
  updateSummary(snap);
  updateChart(snap);
  setFlowStage(deriveFlowStage(snap));
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
    logEvent('share_copy', { url: shareUrl.value });
  } catch (err) {
    console.error(err);
  }
});

const downloadButton = document.getElementById('download-result');
const webShareButton = document.getElementById('web-share');

downloadButton?.addEventListener('click', () => {
  buildShareLink();
  logEvent('download', { url: shareUrl?.value });
  window.print();
});

webShareButton?.addEventListener('click', async () => {
  buildShareLink();
  const url = shareUrl?.value || window.location.href;
  const text = `세금 계산 결과를 공유합니다: ${url}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: '통합 세금 플랫폼', text, url });
      logEvent('web_share', { url });
    } catch (err) {
      console.error(err);
    }
  } else {
    try {
      await navigator.clipboard.writeText(url);
      alert('공유 링크를 클립보드에 복사했습니다.');
      logEvent('web_share_copy', { url });
    } catch (err) {
      console.error(err);
    }
  }
});

// 파트너스 링크 초기화 (필요 시 코드만 교체)
document.querySelectorAll('[data-partner-url]').forEach((link) => {
  const href = link.getAttribute('data-partner-url');
  if (href) link.setAttribute('href', href);
});

// 초반 상태 업데이트
refreshLive();
