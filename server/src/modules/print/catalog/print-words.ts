import type { LabelKey, SchoolLabels, TemplateDefinition } from '@biddaloy/shared';

/**
 * [77.x D5/D19] The school's own words on a printed document. Printed captions are fixed
 * text inside the template (not field values), so they are swapped when a school makes
 * a template from a suggestion. Same semantics as the UI's `applyTenantWords`: en uses
 * the singular form (captions are singular), bn has one word, blank/missing = stock word.
 * shift/version/group are not renamable here. Only class and section have captions on the
 * stock cards today; student/guardian/teacher have none.
 */
export type PrintLang = 'en' | 'bn';

const CAPTIONED: { key: LabelKey; stock: Record<PrintLang, string>; fields: string }[] = [
  {
    key: 'class',
    stock: { en: 'Class', bn: 'শ্রেণি' },
    fields: '(?:student|leaving)\\.class',
  },
  { key: 'section', stock: { en: 'Section', bn: 'শাখা' }, fields: 'student\\.section' },
];

function wordFor(labels: SchoolLabels, key: LabelKey, lang: PrintLang): string | undefined {
  const entry = labels[key];
  const word = lang === 'en' ? entry?.en?.one : entry?.bn;
  const w = word?.trim();
  // Fixed text interpolates {{field}}; a word must never become a live field.
  return w && !w.includes('{{') ? w : undefined;
}

/**
 * Swaps the stock word when it is a whole caption ("Section:") or sits next to its own
 * placeholder ("শাখা {{student.section}}"). Other prose keeps its words. The word is
 * inserted as plain text; the renderer escapes fixed text like any other.
 */
function swap(text: string, stock: string, fields: string, word: string): string {
  const ph = `\\{\\{${fields}\\}\\}`;
  return text
    .replace(new RegExp(`^${stock}(:?)$`), (_m, colon: string) => `${word}${colon}`)
    .replace(new RegExp(`${stock}(\\s+)(${ph})`, 'g'), (_m, sp: string, p: string) => word + sp + p)
    .replace(
      new RegExp(`(${ph})(\\s+)${stock}`, 'g'),
      (_m, p: string, sp: string) => p + sp + word,
    );
}

/** Mutates and returns `def` (callers pass a clone). No words set = unchanged. */
export function applyPrintWords(
  def: TemplateDefinition,
  labels: SchoolLabels,
  lang: PrintLang | null,
): TemplateDefinition {
  if (!lang) return def;
  for (const c of CAPTIONED) {
    const word = wordFor(labels, c.key, lang);
    if (!word) continue;
    for (const side of [def.front, def.back]) {
      for (const el of side?.elements ?? []) {
        if (el.type === 'TEXT' && !el.field && typeof el.text === 'string') {
          el.text = swap(el.text, c.stock[lang], c.fields, word);
        }
      }
    }
  }
  return def;
}

/** `admit-card-bn` gives 'bn'; a suggestion with no language suffix (ACR) gives null. */
export function suggestionLang(key: string): PrintLang | null {
  const m = /-(bn|en)$/.exec(key);
  return m ? (m[1] as PrintLang) : null;
}
