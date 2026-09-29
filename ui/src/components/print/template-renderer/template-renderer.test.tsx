import type { TemplateDefinition } from '@biddaloy/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
