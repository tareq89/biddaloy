import type { LabelKey, SchoolLabels } from '@biddaloy/shared';

/**
 * [77.5] The school's own word for an entity, for a plain-text SMS body.
 * Same rules as the UI's `applyTenantWords`: en `one`/`other` are separate,
 * bn has one word for both forms, a missing or blank part keeps the STOCK
 * word. Pure: the caller reads `getSchoolLabels(tenantId)` once per batch.
 *
 * A word is tenant-admin input, so control characters (newlines included)
 * are dropped and whitespace collapsed: a word stays one inline token and
 * can never start a new line in the message.
 */
export function smsWord(
  labels: SchoolLabels | undefined,
  key: LabelKey,
  locale: 'bn' | 'en',
  stock: string,
  plural = false,
): string {
  const entry = labels?.[key];
  const raw = locale === 'bn' ? entry?.bn : plural ? entry?.en?.other : entry?.en?.one;
  // Cc = control chars (incl. newlines), Zl/Zp = unicode line/paragraph separators.
  // Braces go too: the word is baked into the template, which is rendered later,
  // so `{{x}}` in a word must never become a live placeholder.
  const clean = (raw ?? '').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/[{}]/g, '');
  return clean.replace(/\s+/g, ' ').trim() || stock;
}
