import { useEffect, useMemo, useRef, useState } from 'react';

// 6h cooldown (stored on OPEN)
const STORAGE_KEY_NEXT_AT = 'cp_auto_promo_next_at_v1';
const COOLDOWN_MS = 6 * 60 * 60 * 1000;

const PROMO_LINKS = [
  'https://link.coupang.com/a/dPJvzF',
  'https://link.coupang.com/a/dPJzZu',
  'https://link.coupang.com/a/dPJC4g',
  'https://link.coupang.com/a/dPJQFz',
  'https://link.coupang.com/a/dPJVxr',
  'https://link.coupang.com/a/dPJ2jt',
  'https://link.coupang.com/a/dPKcZs',
  'https://link.coupang.com/a/dPKgU0',
  'https://link.coupang.com/a/dPKjlp',
  'https://link.coupang.com/a/dPKIZ9',
  'https://link.coupang.com/a/dPKoN6',
  'https://link.coupang.com/a/dPKr4O',
  'https://link.coupang.com/a/dPKvE3',
  'https://link.coupang.com/a/dPKzjf',
  'https://link.coupang.com/a/dPKFV8',
  'https://link.coupang.com/a/dPKI7T',
];

const clampInt = (value, fallback) => {
  const num = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(num) ? num : fallback;
};

const readNextAt = () => {
  try {
    return clampInt(localStorage.getItem(STORAGE_KEY_NEXT_AT), 0);
  } catch {
    return 0;
  }
};

const writeNextAt = (ts) => {
  try {
    localStorage.setItem(STORAGE_KEY_NEXT_AT, String(ts));
  } catch {
    // ignore
  }
};

const pickRandomLink = () => {
  if (!PROMO_LINKS.length) return '';
  return PROMO_LINKS[Math.floor(Math.random() * PROMO_LINKS.length)];
};

const isEligibleClick = (target) => {
  if (!target || !(target instanceof Element)) return false;

  // ignore when clicking inside any modal
  if (target.closest('.modal-backdrop')) return false;

  // any button-like element
  const el = target.closest('button, [role="button"], a.btn');
  if (!el) return false;
  if (el.closest('[data-cp-ignore]')) return false;

  return true;
};

export default function CoupangAutoPopup() {
  const [open, setOpen] = useState(false);
  const [activeLink, setActiveLink] = useState('');
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const close = () => setOpen(false);

  const openIfAllowed = () => {
    if (openRef.current) return;

    // If any other modal is open, skip (avoid stacking overlays)
    if (document.querySelector('.modal-backdrop')) return;

    const now = Date.now();
    const nextAt = readNextAt();
    if (nextAt && now < nextAt) return;

    writeNextAt(now + COOLDOWN_MS);
    setActiveLink(pickRandomLink());
    setOpen(true);
  };

  useEffect(() => {
    const handler = (event) => {
      if (openRef.current) return;
      if (!isEligibleClick(event.target)) return;

      // Defer opening to avoid interfering with the original click handler.
      setTimeout(() => openIfAllowed(), 0);
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const link = String(activeLink || '').trim();
  const hasLink = Boolean(link);

  const modal = useMemo(() => {
    if (!open) return null;

    return (
      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="쿠팡 프로모션 (광고)"
        onClick={close}
      >
        <div className="modal" role="document" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div>
              <div className="modal-title">
                쿠팡 프로모션 <span className="pill" style={{ marginLeft: 8 }}>AD</span>
              </div>
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                진행 중인 쿠팡 이벤트/프로모션을 확인해 보세요.
              </div>
            </div>
            <button type="button" className="btn ghost sm" onClick={close} aria-label="닫기">
              닫기
            </button>
          </div>
          <div className="modal-body">
            {hasLink ? (
              <a className="btn primary" href={link} target="_blank" rel="noopener" onClick={close}>
                쿠팡에서 프로모션 확인
              </a>
            ) : (
              <div className="muted">프로모션 링크를 불러오지 못했습니다.</div>
            )}

            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              쿠팡파트너스 활동으로 수수료를 제공받을 수 있습니다.
            </div>
          </div>
        </div>
      </div>
    );
  }, [open, hasLink, link]);

  return modal;
}
