// Umami event forwarding (D22). `umami` is only present when Analytics.astro loaded it.
type Umami = { track: (name: string, data?: Record<string, string>) => void };

export function track(name: string, data?: Record<string, string>) {
  const u = (window as unknown as { umami?: Umami }).umami;
  if (!u) return;
  try { u.track(name, data); } catch { /* analytics must never break the page */ }
}

document.addEventListener('click', (e) => {
  const el = (e.target as Element | null)?.closest<HTMLElement>('[data-ev]');
  if (!el?.dataset.ev) return;
  const data: Record<string, string> = {};
  if (el.dataset.evRole) data.role = el.dataset.evRole;
  if (el.dataset.evSlug) data.slug = el.dataset.evSlug;
  track(el.dataset.ev, data);
});
