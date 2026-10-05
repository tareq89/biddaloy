/**
 * Client-side mirror of `reminder-template.util.ts`'s placeholder
 * allowlist. The server answers 400 `Unsupported template placeholder(s)`
 * for anything else; validating here means the composer learns about a
 * typo (`{{studnet_name}}`) while typing, not after a round trip.
 *
 * Staff never see the server tokens: the composer holds a display form
 * (`{শিক্ষার্থীর নাম}`) that `toServerTemplate` converts to `{{student_name}}`
 * right before preview / send.
 */
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export const PLACEHOLDER_NAMES = [
  'student_name',
  'guardian_name',
  'due_amount',
  'due_month',
] as const;
export type PlaceholderName = (typeof PLACEHOLDER_NAMES)[number];
export type PlaceholderLabels = Record<PlaceholderName, string>;

/** The server-token form of each supported placeholder, used by the bulk wizard's own buttons. */
export const SUPPORTED_PLACEHOLDERS = PLACEHOLDER_NAMES.map((name) => `{{${name}}}`);

const SUPPORTED_NAMES = new Set<string>(PLACEHOLDER_NAMES);

// Same semantics as the server's PLACEHOLDER_PATTERN
// (`/\{\{([^{}]*)\}\}/` in reminder-template.util.ts): one unambiguous
// capture, with the padding trimmed in code, so `{{ guardian_name }}` is as
// valid here as it is server-side. Padding is deliberately not matched by
// the pattern itself — `\s` is a subset of `[^{}]`, and that overlap is
// what made the earlier `\s*([^{}]*?)\s*` form backtrack polynomially.
const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;

/** Every `{{…}}` token in the template that the server would reject,
 * reported in normalized `{{name}}` form (padding stripped, matching how
 * the server's own 400 lists them). */
export function findUnsupportedPlaceholders(template: string): string[] {
  const unsupported: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = (match[1] ?? '').trim();
    const normalized = `{{${name}}}`;
    if (!SUPPORTED_NAMES.has(name) && !unsupported.includes(normalized)) {
      unsupported.push(normalized);
    }
  }
  return unsupported;
}

/** Translated placeholder words, memoised per language. */
export function usePlaceholderLabels(): PlaceholderLabels {
  const { t } = useTranslation('communications');
  return React.useMemo(
    () =>
      Object.fromEntries(
        PLACEHOLDER_NAMES.map((name) => [name, t(`placeholders.${name}`)]),
      ) as PlaceholderLabels,
    [t],
  );
}

/** `{শিক্ষার্থীর নাম}` → `{{student_name}}`; existing `{{…}}` tokens pass through. */
export function toServerTemplate(display: string, labels: PlaceholderLabels): string {
  let result = display;
  for (const name of PLACEHOLDER_NAMES) {
    const word = labels[name].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(?<!\\{)\\{${word}\\}(?!\\})`, 'g'), `{{${name}}}`);
  }
  return result;
}

/** `{{ student_name }}` → `{শিক্ষার্থীর নাম}` for the four supported names; anything else unchanged. */
export function toDisplayTemplate(server: string, labels: PlaceholderLabels): string {
  return server.replace(PLACEHOLDER_PATTERN, (whole, inner: string) =>
    SUPPORTED_NAMES.has(inner.trim()) ? `{${labels[inner.trim() as PlaceholderName]}}` : whole,
  );
}

/** Single-brace `{…}` left after conversion = a word we do not know. */
export function findUnknownLabels(display: string, labels: PlaceholderLabels): string[] {
  const unknown: string[] = [];
  for (const match of toServerTemplate(display, labels).matchAll(/(?<!\{)\{([^{}]+)\}(?!\})/g)) {
    const word = match[1] ?? '';
    if (!unknown.includes(word)) unknown.push(word);
  }
  return unknown;
}

/** A `{` or `}` left over once every complete `{{token}}` / `{word}` is removed — a half-typed token that would otherwise be sent literally. */
export function hasStrayBraces(display: string, labels: PlaceholderLabels): boolean {
  const rest = toServerTemplate(display, labels)
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\{[^{}]*\}/g, '');
  return /[{}]/.test(rest);
}
