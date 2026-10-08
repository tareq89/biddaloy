import type { TemplateDefinition } from '@biddaloy/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { i18n } from '../../../i18n/i18n';

import { TemplateRenderer } from './template-renderer';

const ASSET = '11111111-1111-4111-8111-111111111111';

const definition: TemplateDefinition = {
  page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
  copyLabel: { text: 'Copy {n}' },
  front: {
    background: { assetId: ASSET, print: false },
    elements: [
      {
        id: 'name',
        type: 'TEXT',
        x: 4,
        y: 5,
        w: 40,
        h: 6,
        field: 'student.name',
        fontFamily: 'Biddaloy Sans',
        sizePt: 10,
        weight: 700,
        color: '#000000',
        align: 'left',
        overflow: 'SHRINK',
      },
      {
        id: 'copy',
        type: 'TEXT',
        x: 4,
        y: 12,
        w: 20,
        h: 5,
        field: 'print.copyLabel',
        fontFamily: 'Biddaloy Sans',
        sizePt: 8,
        weight: 400,
        color: '#000000',
        align: 'left',
        overflow: 'CLIP',
      },
      { id: 'qr', type: 'QR', x: 50, y: 5, w: 20, h: 20 },
    ],
  },
};

const base = {
  definition,
  side: 'front' as const,
  values: { 'student.name': 'Rahim', 'print.verify_qr': 'https://example.com/v/1' },
  assetUrl: (id: string) => `/assets/${id}`,
};

describe('TemplateRenderer', () => {
  it('positions elements in mm', () => {
    const { container } = render(<TemplateRenderer {...base} mode="preview" />);
    const el = container.querySelector<HTMLElement>('[data-element-id="name"]')!;
    expect(el.style.left).toBe('4mm');
    expect((container.firstChild as HTMLElement).style.width).toBe('85.6mm');
  });

  it('emits no px anywhere', () => {
    const { container } = render(<TemplateRenderer {...base} mode="preview" fonts={[]} />);
    // jsdom serialises a bare `0` as `0px`, so only non-zero px values count.
    expect(container.innerHTML).not.toMatch(/[1-9]\d*px|\.\d*[1-9]px/);
  });

  it('omits the background in print mode when showBackground is false', () => {
    render(<TemplateRenderer {...base} mode="print" showBackground={false} />);
    expect(screen.queryByTestId('template-background')).toBeNull();
  });

  it('always shows the background in preview mode', () => {
    render(<TemplateRenderer {...base} mode="preview" />);
    expect(screen.getByTestId('template-background')).toBeTruthy();
  });

  it('renders a missing field as empty text', () => {
    const { container } = render(<TemplateRenderer {...base} values={{}} mode="print" />);
    expect(container.querySelector('[data-element-id="name"]')!.textContent).toBe('');
  });

  it('leaves the copy label empty on copy 1 and fills it on copy 2', () => {
    const { container, rerender } = render(<TemplateRenderer {...base} mode="print" />);
    const label = () => container.querySelector('[data-element-id="copy"]')!.textContent;
    expect(label()).toBe('');
    rerender(<TemplateRenderer {...base} mode="print" copy={2} />);
    expect(label()).toBe('Copy 2');
  });

  it('renders the QR as an svg', async () => {
    const { container } = render(<TemplateRenderer {...base} mode="print" />);
    await screen.findByRole('img', { name: 'QR code' });
    expect(container.querySelector('svg')).toBeTruthy();
  });

  describe('placeholders in fixed text', () => {
    const sentence = (
      text: string,
      over: Partial<TemplateDefinition> = {},
    ): TemplateDefinition => ({
      page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
      ...over,
      front: {
        elements: [
          {
            id: 's',
            type: 'TEXT',
            x: 1,
            y: 1,
            w: 60,
            h: 20,
            text,
            fontFamily: 'Biddaloy Sans',
            sizePt: 10,
            weight: 400,
            color: '#000000',
            align: 'left',
            overflow: 'WRAP',
          },
        ],
      },
    });
    const draw = (text: string, values: Record<string, string>, over = {}) =>
      render(
        <TemplateRenderer
          {...base}
          definition={sentence(text, over)}
          values={values}
          mode="preview"
        />,
      ).container.querySelector('[data-element-id="s"]')!.textContent;

    it('fills fields inside the sentence', () => {
      expect(
        draw('{{student.name}} of {{student.class}}', {
          'student.name': 'Rahim',
          'student.class': 'Eight',
        }),
      ).toBe('Rahim of Eight');
    });

    it('renders an unknown placeholder as nothing', () => {
      expect(draw('a{{nope}}b', {})).toBe('ab');
    });

    it('uses Bangla digits for ISO dates when the language is bn', async () => {
      const prev = i18n.language;
      await i18n.changeLanguage('bn');
      try {
        expect(draw('{{student.date_of_birth}}', { 'student.date_of_birth': '2013-05-05' })).toBe(
          '২০১৩-০৫-০৫',
        );
      } finally {
        await i18n.changeLanguage(prev);
      }
    });

    it('leaves text without braces and single braces alone', () => {
      expect(draw('plain', {})).toBe('plain');
      expect(draw('Copy {n}', {})).toBe('Copy {n}');
    });
  });

  describe('copy label (D44)', () => {
    const label = (
      copy: number,
      over: Partial<TemplateDefinition>,
      values: Record<string, string>,
    ) =>
      render(
        <TemplateRenderer
          {...base}
          definition={{ ...definition, ...over }}
          values={values}
          copy={copy}
          mode="preview"
        />,
      ).container.querySelector('[data-element-id="copy"]')!.textContent;
    const server = { 'print.copyLabel': 'প্রতিলিপি / DUPLICATE (copy 2)' };

    it('falls back to the server label when the template has none', () => {
      expect(label(2, { copyLabel: undefined }, server)).toBe('প্রতিলিপি / DUPLICATE (copy 2)');
    });
    it('is empty on copy 1', () => {
      expect(label(1, { copyLabel: undefined }, server)).toBe('');
    });
    it('prefers the template label', () => {
      expect(label(2, {}, server)).toBe('Copy 2');
    });
  });
});
