const rootEl = document.documentElement;
const bodyEl = document.body;
const themeToggleBtn = document.getElementById('theme-toggle');
const contrastSlider = document.getElementById('contrast-slider');
const infoModal = document.getElementById('info-modal');
const a11yModal = document.getElementById('a11y-modal');
const openInfoBtn = document.getElementById('open-modal');
const openA11yBtn = document.getElementById('open-a11y');

const setTheme = (mode) => {
  const next = mode === 'dark' ? 'dark' : 'light';
  rootEl?.setAttribute('data-theme', next);
  bodyEl?.setAttribute('data-theme', next);
  themeToggleBtn?.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
  try {
    localStorage.setItem('tax-theme', next);
  } catch (_) {
    /* ignore */
  }
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
  const ratio = Math.max(0.9, Math.min(1.2, value));
  rootEl?.style.setProperty('--contrast-filter', ratio.toString());
  try {
    localStorage.setItem('tax-contrast', ratio.toString());
  } catch (_) {
    /* ignore */
  }
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

const bindModal = (modal, openBtn, closeSelectors) => {
  if (!modal) return;
  const closeModal = () => modal.classList.remove('open');
  openBtn?.addEventListener('click', () => modal.classList.add('open'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  closeSelectors.forEach((sel) => {
    modal.querySelectorAll(sel).forEach((btn) => btn.addEventListener('click', closeModal));
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
};

bindModal(infoModal, openInfoBtn, ['[data-close-modal]']);
bindModal(a11yModal, openA11yBtn, ['[data-close-a11y]']);

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
  };
  document.head.appendChild(script);
};

initSentry();
