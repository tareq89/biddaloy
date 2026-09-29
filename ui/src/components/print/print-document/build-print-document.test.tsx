import { DuplexOrder, PrinterType, type TemplateDefinition } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { layoutPages } from '../template-renderer';

import { buildPrintDocument, type BuildPrintDocumentInput } from './build-print-document';

const text = (id: string, extra: object) => ({
  id,
  type: 'TEXT' as const,
  x: 1,
  y: 1,
  w: 30,
  h: 6,
  fontFamily: 'Biddaloy Sans',
  sizePt: 10,
  weight: 400,
  color: '#000000',
  align: 'left' as const,
  overflow: 'CLIP' as const,
  ...extra,
});

const definition = {
  page: { widthMm: 85.6, heightMm: 54, sides: ['front', 'back'] },
  front: {
    elements: [
      text('n', { field: 'student.name' }),
      { id: 'qr', type: 'QR', x: 40, y: 5, w: 20, h: 20 },
    ],
  },
  back: { elements: [text('b', { text: 'BACKSIDE' })] },
} as unknown as TemplateDefinition;

const cards = [
  { 'student.name': 'Alice', 'print.verify_qr': 'https://example.com/v/1' },
  { 'student.name': 'Bob', 'print.verify_qr': 'https://example.com/v/2' },
];

const make = (over: Partial<BuildPrintDocumentInput> = {}): BuildPrintDocumentInput => {
  const printer = { type: PrinterType.CARD, offsetXMm: 1.5, offsetYMm: -2, scale: 1.02 };
  return {
    definition,
    cards,
    printer,
    sheets: layoutPages(definition.page, { type: printer.type }, 2, ['front', 'back']),
    fonts: [],
    lang: 'en',
    title: 'Cards',
    assetUrl: () => 'data:image/png;base64,AAAA',
    ...over,
  };
};

describe('buildPrintDocument', () => {
  it('sizes @page to the card for CARD and A4 for OFFICE', async () => {
    expect(await buildPrintDocument(make())).toContain('@page{size:85.6mm 54mm;margin:0}');
    const printer = { type: PrinterType.OFFICE, offsetXMm: 0, offsetYMm: 0, scale: 1 };
    const office = await buildPrintDocument(
      make({ printer, sheets: layoutPages(definition.page, { type: printer.type }, 2, ['front']) }),
    );
    expect(office).toContain('@page{size:210mm 297mm;margin:0}');
  });

  it('puts offset and scale in the transform', async () => {
    expect(await buildPrintDocument(make())).toContain(
      'translate(1.5mm,-2mm) scale(1.02);transform-origin:0 0',
    );
  });

  it('has no script and contains the QR svg in the static html', async () => {
    const html = await buildPrintDocument(make());
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('aria-label="QR code"');
    expect(html).toMatch(/aria-label="QR code"[^>]*><svg /);
  });

  it('throws on a non-data image url', async () => {
    const withBg = {
      ...definition,
      front: { ...definition.front, background: { assetId: 'a', print: true } },
    } as unknown as TemplateDefinition;
    await expect(
      buildPrintDocument(make({ definition: withBg, assetUrl: () => '/assets/a' })),
    ).rejects.toThrow('non-data image URL');
  });

  it('throws on a non-data font url', async () => {
    await expect(
      buildPrintDocument(make({ fonts: [{ family: 'F', url: '/f.woff2' }] })),
    ).rejects.toThrow('font');
  });

  it('GROUPED puts all fronts before backs, INTERLEAVED alternates', async () => {
    const sides = ['front', 'back'] as const;
    const grouped = await buildPrintDocument(
      make({
        sheets: layoutPages(
          definition.page,
          { type: PrinterType.CARD, duplex: DuplexOrder.GROUPED },
          2,
          sides,
        ),
      }),
    );
    expect(grouped.indexOf('Bob')).toBeLessThan(grouped.indexOf('BACKSIDE'));
    const inter = await buildPrintDocument(make());
    expect(inter.indexOf('BACKSIDE')).toBeLessThan(inter.indexOf('Bob'));
  });
});
