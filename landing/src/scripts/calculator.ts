// Progressive: the table is server-rendered; this only un-hides and drives the sliders.
declare global {
  interface Window { umami?: { track?: (e: string, d?: Record<string, number>) => void } }
}
const bn = '০১২৩৪৫৬৭৮৯';
const isBn = document.documentElement.lang === 'bn';
const fmt = (n: number) => {
  const s = n.toLocaleString('en-IN');
  return isBn ? s.replace(/\d/g, (d) => bn[+d]) : s;
};
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const wrap = document.querySelector<HTMLElement>('[data-calc]');
const s = $('students') as HTMLInputElement, m = $('months') as HTMLInputElement;
if (wrap && s && m) {
  const price = +(wrap.dataset.price || 10), tpl = $('pm').dataset.tpl || '{n}';
  let timer = 0;
  const calc = () => {
    const st = +s.value, mo = +m.value;
    $('sOut').textContent = fmt(st);
    $('mOut').textContent = fmt(mo);
    $('tOut').textContent = '৳' + fmt(st * mo * price);
    $('pm').textContent = tpl.replace('{n}', '৳' + fmt(st * price));
  };
  const on = () => {
    calc();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      try { window.umami?.track?.(wrap.dataset.ev || 'pricing_slider', { students: +s.value, months: +m.value }); } catch { /* opt-out */ }
    }, 300);
  };
  s.addEventListener('input', on);
  m.addEventListener('input', on);
  calc();
  wrap.hidden = false;
}
export {};
