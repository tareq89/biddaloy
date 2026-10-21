// Umami event forwarding (D22) + consent state. `umami` is only present when Analytics.astro loaded it.
// D22 events: demo_click{role}, register_click, whatsapp_click, pricing_slider, chat_open, lang_switch, theme_toggle
// (plus login_click, docs_card, carousel_next). Most are emitted by `data-ev` on the element.
type Umami = { track: (name: string, data?: Record<string, string>) => void };
export type Consent = { stat: 0 | 1; ads: 0 | 1; chat: 0 | 1 };

export function track(name: string, data?: Record<string, string>) {
  const u = (globalThis as unknown as { umami?: Umami }).umami;
  if (!u) return;
  try { u.track(name, data); } catch { /* analytics must never break the page */ }
}

/** Stored `sm:consent` value -> consent, or null when nothing valid is stored (= essential only). */
export function parseConsent(raw: string | null): Consent | null {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || typeof v !== 'object') return null;
    return { stat: v.stat ? 1 : 0, ads: v.ads ? 1 : 0, chat: v.chat ? 1 : 0 };
  } catch { return null; }
}

/** Opening the chat counts as chat consent (D15); other choices are kept. */
export function withChat(raw: string | null): Consent {
  return { ...(parseConsent(raw) ?? { stat: 0, ads: 0, chat: 0 }), chat: 1 };
}

// Base.astro and some pages both import this module; bundle copies must not double-fire.
const w = globalThis as unknown as { __smEv?: boolean };
if (typeof document !== 'undefined' && !w.__smEv) {
  w.__smEv = true;
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('[data-ev]');
    // pricing_slider fires on `change` below, not on every click inside the calculator.
    if (!el?.dataset.ev || el.dataset.ev === 'pricing_slider') return;
    const data: Record<string, string> = {};
    if (el.dataset.evRole) data.role = el.dataset.evRole;
    if (el.dataset.evSlug) data.slug = el.dataset.evSlug;
    track(el.dataset.ev, data);
  });
  let slid = false;
  document.addEventListener('change', (e) => {
    if (slid || !(e.target as Element | null)?.closest('[data-ev="pricing_slider"]')) return;
    slid = true; // once per page view
    track('pricing_slider');
  });
}
