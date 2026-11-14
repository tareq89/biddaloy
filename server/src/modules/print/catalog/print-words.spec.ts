import { describe, it, expect } from 'vitest';
import type { TemplateDefinition } from '@biddaloy/shared';
import { PRINT_SUGGESTIONS } from '../suggestions/suggestions';
import { applyPrintWords, suggestionLang } from './print-words';

const texts = (d: TemplateDefinition) =>
  [...d.front.elements, ...(d.back?.elements ?? [])].flatMap((e) =>
    e.type === 'TEXT' && !e.field ? [e.text as string] : [],
  );
const fresh = (key: string) =>
  structuredClone(PRINT_SUGGESTIONS.find((s) => s.key === key)!.definition);

describe('applyPrintWords', () => {
  it('admit card en: section becomes Batch, class untouched when unset', () => {
    const d = applyPrintWords(fresh('admit-card-en'), { section: { en: { one: 'Batch' } } }, 'en');
    expect(texts(d)).toContain('Batch:');
    expect(texts(d)).toContain('Class:');
    expect(texts(d)).not.toContain('Section:');
  });

  it('admit card bn: one word, used as is', () => {
    const d = applyPrintWords(fresh('admit-card-bn'), { section: { bn: 'ব্যাচ' } }, 'bn');
    expect(texts(d)).toContain('ব্যাচ:');
  });

  it('en uses the singular form; en word does not leak into bn doc', () => {
    const labels = { section: { en: { one: 'Batch', other: 'Batches' } } };
    expect(texts(applyPrintWords(fresh('admit-card-bn'), labels, 'bn'))).toContain('শাখা:');
  });

  it('blank or whitespace word keeps the stock word', () => {
    const d = applyPrintWords(fresh('admit-card-en'), { section: { en: { one: '  ' } } }, 'en');
    expect(texts(d)).toContain('Section:');
  });

  it('no labels: definition is byte-identical to stock', () => {
    const stock = fresh('admit-card-en');
    expect(JSON.stringify(applyPrintWords(fresh('admit-card-en'), {}, 'en'))).toBe(
      JSON.stringify(stock),
    );
  });

  it('bn sentence: word before its placeholder swaps, other prose stays', () => {
    const key = PRINT_SUGGESTIONS.find(
      (s) =>
        s.key.endsWith('-bn') && JSON.stringify(s.definition).includes('শাখা {{student.section}}'),
    )!.key;
    const all = texts(applyPrintWords(fresh(key), { section: { bn: 'ব্যাচ' } }, 'bn')).join('\n');
    expect(all).toContain('ব্যাচ {{student.section}}');
    expect(all).not.toContain('শাখা {{student.section}}');
  });

  it('keeps the word as plain text (no regex/replacement expansion)', () => {
    const d = applyPrintWords(
      fresh('admit-card-en'),
      { section: { en: { one: '$& & "x"' } } },
      'en',
    );
    expect(texts(d)).toContain('$& & "x":');
  });

  it('a word containing {{ is ignored (stock word kept)', () => {
    const d = applyPrintWords(
      fresh('admit-card-en'),
      { section: { en: { one: '{{student.name}}' } } },
      'en',
    );
    expect(texts(d)).toContain('Section:');
  });

  it('suggestion with no language is left alone', () => {
    expect(suggestionLang('acr-a4-standard')).toBeNull();
    expect(suggestionLang('admit-card-bn')).toBe('bn');
  });
});
