/** [59.2.06] The repo's legal Markdown, bundled raw, with its `<!-- version: x -->` first line split off. */
import type { LegalDocument } from '@biddaloy/shared';

export type LegalLang = 'bn' | 'en';

const files = import.meta.glob<string>('../../legal/*/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export function getLegalDoc(
  doc: LegalDocument,
  lang: LegalLang,
): { version: string; body: string } {
  const raw = files[`../../legal/${lang}/${doc}.md`];
  if (raw === undefined) throw new Error(`Legal text missing: ${lang}/${doc}`);
  const match = /^<!--\s*version:\s*(\S+?)\s*-->\r?\n?/.exec(raw);
  return { version: match?.[1] ?? '', body: match ? raw.slice(match[0].length) : raw };
}
