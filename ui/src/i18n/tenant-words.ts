import type { LabelKey, SchoolLabels } from '@biddaloy/shared';
import type { i18n as I18nInstance } from 'i18next';

import { COMMON_NAMESPACE } from './i18n';

const KEYS: LabelKey[] = ['class', 'section', 'student', 'guardian', 'teacher'];

// Stock words, captured the first time a key is overridden so removal can
// restore them. Keyed per instance (tests build their own).
const stock = new WeakMap<I18nInstance, Map<string, string | undefined>>();

function setWord(
  i18n: I18nInstance,
  lang: string,
  path: string,
  word: string | undefined,
): boolean {
  const memo = stock.get(i18n) ?? new Map<string, string | undefined>();
  stock.set(i18n, memo);
  const id = `${lang}.${path}`;
  if (!memo.has(id)) {
    memo.set(id, i18n.getResource(lang, COMMON_NAMESPACE, path) as string | undefined);
  }
  const value = word?.trim() ? word.trim() : memo.get(id);
  if (value === undefined || value === i18n.getResource(lang, COMMON_NAMESPACE, path)) return false;
  i18n.addResource(lang, COMMON_NAMESPACE, path, value);
  return true;
}

/**
 * Tenant label overrides win over stock `entities.*` words (D18, D49).
 * bn has one word for both plural forms; blank or missing = stock word.
 * shift/version/group are not here: they stay on `settings.organisation`.
 */
export function applyTenantWords(i18n: I18nInstance, labels: SchoolLabels | undefined): void {
  let changed = false;
  for (const key of KEYS) {
    const entry = labels?.[key];
    changed = setWord(i18n, 'en', `entities.${key}_one`, entry?.en?.one) || changed;
    changed = setWord(i18n, 'en', `entities.${key}_other`, entry?.en?.other) || changed;
    changed = setWord(i18n, 'bn', `entities.${key}_one`, entry?.bn) || changed;
    changed = setWord(i18n, 'bn', `entities.${key}_other`, entry?.bn) || changed;
  }
  // Stock words and no change: nothing to re-render (the shell loads the profile on every page).
  if (!changed) return;
  // Resource edits alone do not re-render `useTranslation` consumers. The
  // emit also re-runs the locale-persist listener with the current language:
  // accepted, it is idempotent.
  i18n.emit('languageChanged', i18n.language);
}

/**
 * Loads the en + bn `common` bundles first, then applies. Capturing stock words from a bundle
 * that is still loading would store `undefined`, and `addResource` on a missing bundle makes
 * i18next treat a partial one as loaded. A failed load applies nothing (returns false).
 */
export async function applyTenantWordsWhenLoaded(
  i18n: I18nInstance,
  labels: SchoolLabels | undefined,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  try {
    await Promise.all([i18n.loadLanguages('en'), i18n.loadLanguages('bn')]);
  } catch {
    return false;
  }
  if (!isCurrent()) return false;
  applyTenantWords(i18n, labels);
  return true;
}
