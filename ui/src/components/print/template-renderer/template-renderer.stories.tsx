import type { TemplateDefinition } from '@biddaloy/shared';
import { CR80, PrinterType } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { BUNDLED_PRINT_FONTS } from './bundled-fonts';
import { layoutPages } from './imposition';
import { TemplateRenderer } from './template-renderer';

const meta: Meta<typeof TemplateRenderer> = {
  title: 'Print/TemplateRenderer',
  component: TemplateRenderer,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof TemplateRenderer>;

const text = (
  id: string,
  field: string,
  x: number,
  y: number,
  w: number,
  h: number,
  overflow: 'SHRINK' | 'WRAP' | 'CLIP' | 'FLAG' = 'SHRINK',
  fontFamily = 'Biddaloy Sans',
) => ({
  id,
  type: 'TEXT' as const,
  field,
  x,
  y,
  w,
  h,
  fontFamily,
  sizePt: 11,
  minSizePt: 7,
  weight: 700 as const,
  color: '#1f2937',
  align: 'left' as const,
  overflow,
});

const card = (widthMm: number, heightMm: number, fields: TemplateDefinition['front']['elements']) =>
  ({
    page: { widthMm, heightMm, sides: ['front'] },
    front: {
      elements: [
        {
          id: 'frame',
          type: 'SHAPE',
          shape: 'RECT',
          x: 1,
          y: 1,
          w: widthMm - 2,
          h: heightMm - 2,
          stroke: '#94a3b8',
          strokeWidthMm: 0.3,
          radiusMm: 2,
        },
        ...fields,
        { id: 'qr', type: 'QR', x: widthMm - 21, y: heightMm - 21, w: 18, h: 18 },
      ],
    },
  }) satisfies TemplateDefinition;

const VALUES = {
  'student.name': 'Rahim Uddin',
  'student.class': 'Class 8',
  'print.verify_qr': 'https://example.com/verify/abc123',
};

const common = {
  side: 'front' as const,
  values: VALUES,
  assetUrl: (id: string) => id,
  fonts: BUNDLED_PRINT_FONTS,
  mode: 'preview' as const,
};

export const Landscape: Story = {
  args: {
    ...common,
    definition: card(CR80.widthMm, CR80.heightMm, [
      text('n', 'student.name', 5, 6, 50, 6),
      text('c', 'student.class', 5, 14, 40, 5, 'CLIP'),
    ]),
  },
};

export const Portrait: Story = {
  args: {
    ...common,
    definition: card(CR80.heightMm, CR80.widthMm, [
      text('n', 'student.name', 4, 8, 46, 6),
      text('c', 'student.class', 4, 16, 40, 5, 'CLIP'),
    ]),
  },
};

export const Overflow: Story = {
  args: {
    ...common,
    values: { ...VALUES, 'student.name': 'Muhammad Abdur Rahman Al-Mahmudur Rashid Chowdhury' },
    definition: card(CR80.widthMm, CR80.heightMm, [
      text('n', 'student.name', 5, 6, 40, 6, 'FLAG'),
      text('c', 'student.class', 5, 16, 40, 5, 'SHRINK'),
    ]),
  },
};

export const Bangla: Story = {
  args: {
    ...common,
    values: { ...VALUES, 'student.name': 'রহিম উদ্দিন' },
    definition: card(CR80.widthMm, CR80.heightMm, [
      text('n', 'student.name', 5, 6, 50, 7, 'SHRINK', 'Noto Serif Bengali'),
    ]),
  },
};

/** 10 CR80 cards on one A4 sheet with crop marks. */
export const A4Imposition: Story = {
  render: () => {
    const definition = card(CR80.widthMm, CR80.heightMm, [text('n', 'student.name', 5, 6, 50, 6)]);
    const [sheet] = layoutPages(CR80, { type: PrinterType.OFFICE }, 10, ['front']);
    return (
      <div
        style={{
          position: 'relative',
          width: `${sheet!.widthMm}mm`,
          height: `${sheet!.heightMm}mm`,
          background: 'var(--color-neutral-0)',
          boxShadow: '0 0 0 0.3mm var(--color-border)',
        }}
      >
        {sheet!.cards.map((c) => (
          <div
            key={c.index}
            style={{ position: 'absolute', left: `${c.xMm}mm`, top: `${c.yMm}mm` }}
          >
            <TemplateRenderer {...common} definition={definition} />
          </div>
        ))}
        <svg
          viewBox={`0 0 ${sheet!.widthMm} ${sheet!.heightMm}`}
          width={`${sheet!.widthMm}mm`}
          height={`${sheet!.heightMm}mm`}
          style={{ position: 'absolute', inset: 0 }}
          aria-hidden="true"
        >
          {sheet!.cropMarks.map((m, i) => (
            <line key={i} {...m} stroke="currentColor" strokeWidth={0.15} />
          ))}
        </svg>
      </div>
    );
  },
};
