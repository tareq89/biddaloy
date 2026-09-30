import { DocumentKind, FIELD_CATALOG } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { buildDesignKit } from './design-kit';

const PAGE = { widthMm: 85.6, heightMm: 54, sides: ['front'] } as never;

describe('buildDesignKit', () => {
  const { svg, readme } = buildDesignKit(PAGE, DocumentKind.STUDENT_ID_CARD);

  it('is an SVG at the exact paper size in millimetres', () => {
    expect(svg).toContain('width="85.6mm"');
    expect(svg).toContain('height="54mm"');
    expect(svg).toContain('viewBox="0 0 85.6 54"');
  });

  it('has the guides, artwork and fields layers', () => {
    for (const id of ['guides', 'artwork', 'fields']) expect(svg).toContain(`<g id="${id}"`);
  });

  it('lists every text field of the document type as {{key}}', () => {
    for (const f of FIELD_CATALOG[DocumentKind.STUDENT_ID_CARD].filter((x) => x.type === 'text')) {
      expect(svg).toContain(`{{${f.key}}}`);
    }
  });

  it('parses as XML', () => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });

  it('README states the size, the safe zone and outlining', () => {
    expect(readme).toContain('85.6 x 54 mm (landscape)');
    expect(readme).toContain('3 mm');
    expect(readme).toMatch(/Outline/);
  });
});
