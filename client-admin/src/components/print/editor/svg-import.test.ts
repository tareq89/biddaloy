import { DocumentKind } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { importSvg, SvgImportError, toHex, type Measure, type StyleOf } from './svg-import';

const PAGE = { widthMm: 85.6, heightMm: 54, sides: ['front'] } as never;
const FONTS = ['Biddaloy Sans', 'Hind Siliguri'];

/** 856 x 540 user units = 85.6 x 54 mm, so 10 units per mm. */
const illustrator = (extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 856 540">
  <style>.cls-1{fill:#1a2b3c;font-family:'Hind Siliguri';font-size:60px}.cls-2{fill:#ff0000;font-family:Arial;font-size:40px}</style>
  <rect width="856" height="540" fill="#eee"/>
  <g transform="translate(100 50)">
    <g transform="translate(0 150)">
      <text class="cls-1" transform="translate(0 40)"><tspan x="0" y="0">{{student.name}}</tspan></text>
    </g>
  </g>
  <text class="cls-2" x="10" y="10">{{ student.class }}</text>
  <text class="cls-1" x="10" y="10" text-anchor="middle">{{school.name}}</text>
  ${extra}
</svg>`;

/** Boxes an Illustrator export would measure, in user units (after every transform). */
const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
  '{{student.name}}': { x: 100, y: 200, width: 400, height: 60 },
  '{{ student.class }}': { x: 100, y: 300, width: 150, height: 40 },
  '{{school.name}}': { x: 428, y: 20, width: 300, height: 60 },
  '{{nope.key}}': { x: 0, y: 0, width: 10, height: 10 },
};
const measure: Measure = (node) =>
  boxes[(node.textContent ?? '').replace(/\s+/g, ' ').trim()] ?? boxes['{{nope.key}}']!;

/**
 * jsdom does not apply an SVG `<style>` sheet, so this stands in for the browser's computed
 * style: it resolves the two classes the fixture uses. (Real-browser resolution is covered by
 * the print e2e.)
 */
const CLASSES: Record<string, ReturnType<StyleOf>> = {
  'cls-1': {
    fill: 'rgb(26, 43, 60)',
    fontSize: '60px',
    fontFamily: "'Hind Siliguri'",
    fontWeight: '400',
    textAnchor: 'start',
  },
  'cls-2': {
    fill: 'rgb(255, 0, 0)',
    fontSize: '40px',
    fontFamily: 'Arial',
    fontWeight: '400',
    textAnchor: 'start',
  },
};
const styleOf: StyleOf = (node) => ({
  ...CLASSES[node.getAttribute('class') ?? '']!,
  ...(node.getAttribute('text-anchor') ? { textAnchor: node.getAttribute('text-anchor')! } : {}),
});

const run = (svg: string) =>
  importSvg(svg, PAGE, DocumentKind.STUDENT_ID_CARD, FONTS, measure, styleOf);
const field = (r: ReturnType<typeof run>, key: string) =>
  r.elements.find((e) => 'field' in e && e.field === key);

describe('importSvg', () => {
  it('turns three placeholders into three elements at the right millimetres', () => {
    const r = run(illustrator());
    expect(r.elements).toHaveLength(3);
    // 400 units = 40 mm; positions within 0.5 mm of the artboard.
    expect(field(r, 'student.name')).toMatchObject({ x: 10, y: 20, w: 40, h: 6, align: 'left' });
    expect(field(r, 'student.class')).toMatchObject({ x: 10, y: 30, w: 15, h: 4 });
    expect(field(r, 'school.name')).toMatchObject({ x: 42.8, y: 2, align: 'center' });
  });

  it('reads colour, font and size (60 units = 6 mm = 17 pt)', () => {
    const name = field(run(illustrator()), 'student.name');
    expect(name).toMatchObject({
      color: '#1a2b3c',
      fontFamily: 'Hind Siliguri',
      overflow: 'SHRINK',
    });
    expect((name as { sizePt: number }).sizePt).toBeCloseTo(17, 0);
  });

  it('falls back to Biddaloy Sans for a font that is not available, and says so', () => {
    const r = run(illustrator());
    expect(field(r, 'student.class')).toMatchObject({
      fontFamily: 'Biddaloy Sans',
      color: '#ff0000',
    });
    expect(r.warnings.fontFallback).toEqual([{ field: 'student.class', family: 'Arial' }]);
  });

  it('keeps an unknown key in the artwork and warns', () => {
    const r = run(illustrator('<text x="1" y="1">{{nope.key}}</text>'));
    expect(r.warnings.unknown).toEqual(['nope.key']);
    expect(r.elements).toHaveLength(3);
    expect(r.cleanedSvg).toContain('{{nope.key}}');
  });

  it('warns about a placeholder mixed with other words and leaves it alone', () => {
    const r = run(illustrator('<text x="1" y="1">Name: {{student.name}}</text>'));
    expect(r.warnings.mixed).toEqual(['Name: {{student.name}}']);
    expect(r.cleanedSvg).toContain('Name: {{student.name}}');
  });

  it('removes every imported placeholder from the cleaned SVG', () => {
    const r = run(illustrator());
    expect(r.cleanedSvg).not.toContain('{{');
    expect(r.cleanedSvg).toContain('<rect');
  });

  it('warns when the artboard shape differs from the page', () => {
    const tall = illustrator().replace('0 0 856 540', '0 0 540 856');
    expect(run(tall).warnings.aspect).toEqual({ svgWidth: 85.6, svgHeight: 135.7 });
    expect(run(illustrator()).warnings.aspect).toBeUndefined();
  });

  it('rejects a file that is not an SVG', () => {
    expect(() => run('<html/>')).toThrow(SvgImportError);
    expect(() => run('not xml <<')).toThrow(SvgImportError);
  });
});

describe('toHex', () => {
  it('normalises rgb() and short hex; anything else is black', () => {
    expect(toHex('rgb(255, 0, 16)')).toBe('#ff0010');
    expect(toHex('#ABC')).toBe('#aabbcc');
    expect(toHex('none')).toBe('#000000');
  });
});
