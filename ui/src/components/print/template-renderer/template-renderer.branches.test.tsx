import type { TemplateDefinition } from '@biddaloy/shared';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TemplateRenderer } from './template-renderer';
import { TextElement } from './text-element';

const ASSET = '11111111-1111-4111-8111-111111111111';
const text = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'TEXT' as const,
  x: 1,
  y: 1,
  w: 30,
  h: 6,
  fontFamily: 'Biddaloy Sans',
  sizePt: 10,
  weight: 400 as const,
  color: '#000000',
  align: 'left' as const,
  overflow: 'SHRINK' as const,
  ...over,
});

const definition = (over: Partial<TemplateDefinition> = {}): TemplateDefinition => ({
  page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
  front: {
    background: { assetId: ASSET, print: true },
    elements: [
      text('lit', { text: 'Fixed' }),
      text('date', { field: 'card.valid_until', y: 10 }),
      {
        id: 'img',
        type: 'IMAGE' as const,
        x: 40,
        y: 1,
        w: 10,
        h: 10,
        assetId: ASSET,
        fit: 'CONTAIN' as const,
        alignY: 'center' as const,
      },
      {
        id: 'photo',
        type: 'IMAGE' as const,
        x: 52,
        y: 1,
        w: 10,
        h: 10,
        field: 'student.photo',
        fit: 'COVER' as const,
        alignY: 'top' as const,
      },
    ],
  },
  ...over,
});

const base = {
  definition: definition(),
  side: 'front' as const,
  values: { 'card.valid_until': '2027-12-31', 'student.photo': 'data:image/png;base64,AAAA' },
  assetUrl: (id: string) => `/assets/${id}`,
};

describe('TemplateRenderer branches', () => {
  it('renders nothing for a side the template does not have', () => {
    const { container } = render(<TemplateRenderer {...base} side="back" mode="preview" />);
    expect(container.firstChild).toBeNull();
  });

  it("follows the side's own print flag in print mode, and always shows it in the editor", () => {
    const noPrint = definition({
      front: { background: { assetId: ASSET, print: false }, elements: [] },
    });
    const bg = (props: { definition?: TemplateDefinition; mode: 'print' | 'preview' | 'editor' }) =>
      render(<TemplateRenderer {...base} {...props} />).container.querySelector(
        '[data-testid="template-background"]',
      );
    expect(bg({ definition: noPrint, mode: 'print' })).toBeNull();
    expect(bg({ mode: 'print' })).not.toBeNull();
    expect(bg({ definition: noPrint, mode: 'editor' })).not.toBeNull();
  });

  it('shows fixed text, and renders an ISO date through the numeral helper', () => {
    const { container } = render(<TemplateRenderer {...base} mode="print" />);
    expect(container.querySelector('[data-element-id="lit"]')!.textContent).toBe('Fixed');
    expect(container.querySelector('[data-element-id="date"]')!.textContent).toMatch(/2027|২০২৭/);
  });

  it('uses an asset for an image with an asset id, and the field value otherwise', () => {
    const { container } = render(<TemplateRenderer {...base} mode="print" />);
    const src = (id: string) =>
      container
        .querySelector<HTMLImageElement>(`[data-element-id="${id}"] img`)
        ?.getAttribute('src');
    expect(src('img')).toBe(`/assets/${ASSET}`);
    expect(src('photo')).toBe('data:image/png;base64,AAAA');
  });

  it('a copy label with no configured text stays empty on a reprint', () => {
    const d = definition({
      front: {
        elements: [text('copy', { field: 'print.copyLabel' })],
      },
    });
    const { container } = render(
      <TemplateRenderer {...base} definition={d} mode="print" copy={3} />,
    );
    expect(container.querySelector('[data-element-id="copy"]')!.textContent).toBe('');
  });

  it('in the editor, clicking an element selects it and the selected one is outlined', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <TemplateRenderer {...base} mode="editor" selectedId="lit" onSelect={onSelect} />,
    );
    const lit = container.querySelector<HTMLElement>('[data-element-id="lit"]')!;
    expect(lit.style.outline).toContain('solid');
    fireEvent.click(container.querySelector('[data-element-id="date"]')!);
    expect(onSelect).toHaveBeenCalledWith('date');
    // Outside the editor a click selects nothing.
    const preview = render(<TemplateRenderer {...base} mode="preview" onSelect={onSelect} />);
    fireEvent.click(preview.container.querySelector('[data-element-id="date"]')!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('inlines fonts, dropping quotes from the family name', () => {
    const { container } = render(
      <TemplateRenderer
        {...base}
        mode="preview"
        fonts={[
          { family: 'My"Font', url: 'data:font/woff2;base64,AAAA', unicodeRange: 'U+0980-09FF' },
        ]}
      />,
    );
    const css = container.querySelector('style')!.textContent;
    expect(css).toContain('font-family:"MyFont"');
    expect(css).toContain('unicode-range');
  });
});

describe('TextElement overflow', () => {
  const sizes = { scrollWidth: 0, clientWidth: 100 };
  const original = Object.getOwnPropertyDescriptors(Element.prototype);
  const setSizes = (scrollWidth: number, clientWidth: number) => {
    sizes.scrollWidth = scrollWidth;
    sizes.clientWidth = clientWidth;
    Object.defineProperty(Element.prototype, 'scrollWidth', {
      configurable: true,
      get: () => sizes.scrollWidth,
    });
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get: () => sizes.clientWidth,
    });
  };
  afterEach(() => {
    Object.defineProperty(Element.prototype, 'scrollWidth', original.scrollWidth);
    Object.defineProperty(Element.prototype, 'clientWidth', original.clientWidth);
  });

  it('reports overflow, marks it, and outlines it only when asked to show it', () => {
    setSizes(500, 100); // wider than its box at every size
    const onOverflow = vi.fn();
    const { container, rerender } = render(
      <TextElement
        el={text('t', { overflow: 'FLAG' }) as never}
        text="Long"
        showOverflow
        onOverflow={onOverflow}
      />,
    );
    expect(onOverflow).toHaveBeenCalledWith('t', true);
    const box = container.firstElementChild as HTMLElement;
    expect(box.getAttribute('data-overflow')).toBe('true');
    expect(box.style.outline).toContain('dashed');
    rerender(
      <TextElement
        el={text('t', { overflow: 'FLAG' })}
        text="Long"
        showOverflow={false}
      />,
    );
    expect((container.firstElementChild as HTMLElement).getAttribute('data-overflow')).toBeNull();
  });

  it('SHRINK reports overflow only when even the smallest size does not fit', () => {
    setSizes(500, 100);
    const onOverflow = vi.fn();
    render(
      <TextElement
        el={text('s', { minSizePt: 6 }) as never}
        text="Long"
        showOverflow
        onOverflow={onOverflow}
      />,
    );
    expect(onOverflow).toHaveBeenLastCalledWith('s', true);
    setSizes(50, 100);
    const ok = vi.fn();
    render(<TextElement el={text('s2') as never} text="Short" showOverflow onOverflow={ok} />);
    expect(ok).toHaveBeenLastCalledWith('s2', false);
  });

  it('WRAP wraps and CLIP clips', () => {
    setSizes(10, 100);
    const wrap = render(
      <TextElement el={text('w', { overflow: 'WRAP' }) as never} text="x" showOverflow />,
    );
    expect((wrap.container.firstElementChild as HTMLElement).style.whiteSpace).toBe('normal');
    const clip = render(
      <TextElement el={text('c', { overflow: 'CLIP' }) as never} text="x" showOverflow />,
    );
    expect((clip.container.firstElementChild as HTMLElement).style.overflow).toBe('hidden');
  });
});
