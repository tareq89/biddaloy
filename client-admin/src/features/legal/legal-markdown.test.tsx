import { LegalDocument } from '@biddaloy/shared';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { getLegalDoc } from './legal-docs';
import { isUnknownSyntax, LegalMarkdown, parseLegalMarkdown } from './legal-markdown';

const CASES = Object.values(LegalDocument).flatMap((d) =>
  (['bn', 'en'] as const).map((l) => [d, l] as const),
);

describe('LegalMarkdown', () => {
  it('renders the subset', () => {
    const { container } = render(
      <LegalMarkdown source={'# Title\n## Part\nHello **bold**\n1. one\n2. two\n- a\n- b'} />,
    );
    expect(container.querySelector('h2')?.textContent).toBe('Title');
    expect(container.querySelector('h3')?.textContent).toBe('Part');
    expect(container.querySelector('p strong')?.textContent).toBe('bold');
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('shows <script> as text, not a tag', () => {
    const { container } = render(<LegalMarkdown source={'<script>alert(1)</script>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it.each(CASES)('%s/%s has no unknown syntax', (doc, lang) => {
    const blocks = parseLegalMarkdown(getLegalDoc(doc, lang).body);
    const texts = blocks.flatMap((b) => ('items' in b ? b.items : [b.text]));
    expect(texts.filter(isUnknownSyntax)).toEqual([]);
  });
});
