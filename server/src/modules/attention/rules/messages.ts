import type { RuleMessage } from '@biddaloy/shared';

export type AttentionLocale = 'bn' | 'en';

export function resolveLocale(regionLocale?: string | null): AttentionLocale {
  return regionLocale?.toLowerCase().startsWith('bn') ? 'bn' : 'en';
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

export function toBanglaDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

export function render(
  messages: { bn: RuleMessage; en: RuleMessage },
  locale: AttentionLocale,
  params: Record<string, string | number>,
): RuleMessage {
  const sub = (s: string) =>
    s.replace(/\{(\w+)\}/g, (m, name: string) => {
      if (!Object.hasOwn(params, name)) return m;
      const v = String(params[name]);
      return locale === 'bn' ? toBanglaDigits(v) : v;
    });
  const m = messages[locale];
  return {
    title: sub(m.title),
    why: sub(m.why),
    steps: m.steps.map(sub),
    ...(m.action !== undefined ? { action: sub(m.action) } : {}),
  };
}
