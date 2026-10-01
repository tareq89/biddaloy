import { ShapeKind, type PrintElement } from '@biddaloy/shared';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ShapeElement } from './shape-element';

type Shape = Extract<PrintElement, { type: 'SHAPE' }>;
const shape = (over: Partial<Shape>): Shape =>
  ({
    id: 's',
    type: 'SHAPE',
    x: 0,
    y: 0,
    w: 40,
    h: 10,
    shape: ShapeKind.RECT,
    strokeWidthMm: 0.3,
    radiusMm: 0,
    ...over,
  });

const box = (el: Shape) =>
  render(<ShapeElement el={el} />).container.firstElementChild as HTMLElement;

describe('ShapeElement', () => {
  it('a wide line runs across the box, centred vertically', () => {
    const line = box(shape({ shape: ShapeKind.LINE, w: 40, h: 2, stroke: '#ff0000' }));
    expect(line.style.width).toBe('100%');
    expect(line.style.height).toBe('0.3mm');
    expect(line.style.top).toBe('50%');
    expect(line.style.background).toContain('rgb(255, 0, 0)');
  });

  it('a tall line runs down the box, centred horizontally', () => {
    const line = box(shape({ shape: ShapeKind.LINE, w: 2, h: 40 }));
    expect(line.style.height).toBe('100%');
    expect(line.style.width).toBe('0.3mm');
    expect(line.style.left).toBe('50%');
    expect(line.style.background).toContain('currentcolor'); // no stroke set
  });

  it('a rectangle has a border only when it has a stroke, and rounds by radius', () => {
    const outlined = box(shape({ stroke: '#000000', fill: '#eeeeee', radiusMm: 2 }));
    expect(outlined.style.border).toContain('0.3mm solid');
    expect(outlined.style.borderRadius).toBe('2mm');
    const plain = box(shape({}));
    expect(plain.style.border).toBe('');
  });
});
