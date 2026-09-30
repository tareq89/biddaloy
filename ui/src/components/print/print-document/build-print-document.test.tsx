import { DuplexOrder, PrinterType, type TemplateDefinition } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { layoutPages } from '../template-renderer';

import {
  buildPrintDocument,
  printShell,
  type BuildPrintDocumentInput,
} from './build-print-document';

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

  it('shows the copy label from copy 2 on, and not on the original (D23)', async () => {
    const withLabel = {
      ...definition,
      copyLabel: { text: 'Copy {n}' },
      front: {
        elements: [
          ...(definition.front.elements as object[]),
          text('c', { field: 'print.copyLabel' }),
        ],
      },
    } as unknown as TemplateDefinition;
    const printCards = [
      { 'student.name': 'Alice', 'print.verify_qr': 'https://example.com/v/1' }, // no number = the original
      {
        'student.name': 'Alice',
        'print.verify_qr': 'https://example.com/v/2',
        'print.copyNumber': '3',
      },
    ];
    const printer = { type: PrinterType.CARD, offsetXMm: 0, offsetYMm: 0, scale: 1 };
    const html = await buildPrintDocument({
      ...make(),
      definition: withLabel,
      cards: printCards,
      printer,
      sheets: layoutPages(withLabel.page, { type: PrinterType.CARD }, 2, ['front']),
    });

    expect(html).toContain('Copy 3');
    expect(html.match(/Copy \d/g)).toHaveLength(1); // only the reprint carries it
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

describe('printShell hardening', () => {
  const opts = {
    printer: { type: PrinterType.CARD, offsetXMm: 0, offsetYMm: 0, scale: 1 } as never,
    pageMm: { widthMm: 85.6, heightMm: 54 },
    fonts: [],
    title: 'T',
    body: '<p>x</p>',
  };

  it('a bad language tag never reaches the attribute', () => {
    const html = printShell({ ...opts, lang: 'en"><script>alert(1)</script>' });
    expect(html).toContain('<html lang="en">');
    expect(html).not.toMatch(/<script/i);
  });

  it('non-finite numbers become 0 in the CSS', () => {
    const html = printShell({
      ...opts,
      lang: 'bn',
      printer: {
        type: PrinterType.CARD,
        offsetXMm: Number.NaN,
        offsetYMm: 1,
        scale: Infinity,
      },
    });
    expect(html).toContain('translate(0mm,1mm) scale(0)');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
