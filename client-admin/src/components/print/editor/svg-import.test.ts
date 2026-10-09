import { DocumentKind } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import {
  domMeasure,
  domStyleOf,
  importSvg,
  stripActiveContent,
  SvgImportError,
  toHex,
  type Measure,
  type StyleOf,
} from './svg-import';

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

describe('stripActiveContent', () => {
  const parse = (svg: string) =>
    new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;

  it('removes scripts, embedded documents and event handlers', () => {
    const root = parse(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script>' +
        '<foreignObject><div/></foreignObject><rect onclick="x()" width="1" height="1"/></svg>',
    );
    stripActiveContent(root);
    expect(root.querySelector('script, foreignObject')).toBeNull();
    expect(root.getAttribute('onload')).toBeNull();
    expect(root.querySelector('rect')?.getAttribute('onclick')).toBeNull();
    expect(root.querySelector('rect')).not.toBeNull(); // real artwork stays
  });

  it('drops external links but keeps #id and embedded images', () => {
    const root = parse(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<use href="#a"/><image href="https://evil.example/x.png"/>' +
        '<image xlink:href="data:image/png;base64,AAAA"/><a href="javascript:alert(1)"/></svg>',
    );
    stripActiveContent(root);
    expect(root.querySelector('use')?.getAttribute('href')).toBe('#a');
    expect(root.querySelectorAll('image')[0]?.getAttribute('href')).toBeNull();
    expect(root.querySelectorAll('image')[1]?.getAttribute('xlink:href')).toMatch(
      /^data:image\/png/,
    );
    expect(root.querySelector('a')?.getAttribute('href')).toBeNull();
  });

  it('scrubs @import and external url() from <style> and style attributes, keeping url(#id)', () => {
    const root = parse(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/a.css);' +
        '.c{fill:url(#g);background:url(https://evil.example/b.png)}</style>' +
        '<rect style="fill:url(https://evil.example/c);stroke:url(#g)"/></svg>',
    );
    stripActiveContent(root);
    const css = root.querySelector('style')?.textContent ?? '';
    expect(css).not.toMatch(/@import|evil\.example/);
    expect(css).toContain('url(#g)');
    const inline = root.querySelector('rect')?.getAttribute('style') ?? '';
    expect(inline).not.toMatch(/evil\.example/);
    expect(inline).toContain('url(#g)');
  });

  it('removes elements outside the SVG namespace, which would start their own fetch', () => {
    const root = parse(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/>' +
        '<img xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example/p.png"/></svg>',
    );
    stripActiveContent(root);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('rect')).not.toBeNull();
  });

  it('removes the motion and discard animation elements, like animate and set', () => {
    const root = parse(
      '<svg xmlns="http://www.w3.org/2000/svg"><animateMotion/><animateTransform/><discard/>' +
        '<rect width="1" height="1"/></svg>',
    );
    stripActiveContent(root);
    expect(root.querySelector('animateMotion, animateTransform, discard')).toBeNull();
    expect(root.querySelector('rect')).not.toBeNull();
  });

  it('drops CSS that hides a url( behind an escape, or uses image-set()', () => {
    const root = parse(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:u\\rl(https://evil.example/a)}</style>' +
        '<rect style="background:image-set(\'https://evil.example/b.png\' 1x)"/></svg>',
    );
    stripActiveContent(root);
    expect(root.querySelector('style')?.textContent).toBe('');
    expect(root.querySelector('rect')?.getAttribute('style')).toBe('');
  });

  it('importSvg never leaves a script in the cleaned SVG it returns', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 856 540"><script>alert(1)</script></svg>';
    const out = importSvg(
      svg,
      PAGE,
      DocumentKind.STUDENT_ID_CARD,
      FONTS,
      () => ({ x: 0, y: 0, width: 1, height: 1 }),
      () => ({ fill: '', fontSize: '', fontFamily: '', fontWeight: '400', textAnchor: 'start' }),
    );
    expect(out.cleanedSvg).not.toMatch(/<script/i);
  });
});

// ---- the parts the fixture above does not exercise -----------------------------------------

describe('importSvg: artboard, fonts, alignment and weight', () => {
  const flat: Measure = () => ({ x: 0, y: 0, width: 100, height: 50 });
  const style =
    (over: Partial<ReturnType<StyleOf>> = {}): StyleOf =>
    () => ({
      fill: 'rgb(0, 0, 0)',
      fontSize: '30px',
      fontFamily: 'Hind Siliguri',
      fontWeight: '400',
      textAnchor: 'start',
      ...over,
    });
  const svg = (inner: string, attrs = 'viewBox="0 0 856 540"') =>
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
  const one = (over: Partial<ReturnType<StyleOf>>, key = '{{student.name}}') =>
    importSvg(
      svg(`<text>${key}</text>`),
      PAGE,
      DocumentKind.STUDENT_ID_CARD,
      FONTS,
      flat,
      style(over),
    );

  it('falls back to width/height when there is no viewBox', () => {
    const r = importSvg(
      svg('', 'width="856" height="540"'),
      PAGE,
      DocumentKind.STUDENT_ID_CARD,
      FONTS,
      flat,
    );
    expect(r.warnings.aspect).toBeUndefined();
  });

  it('rejects an svg with no usable artboard', () => {
    expect(() =>
      importSvg(svg('', 'width="0" height="0"'), PAGE, DocumentKind.STUDENT_ID_CARD, FONTS, flat),
    ).toThrow(SvgImportError);
    expect(() =>
      importSvg(svg('', 'viewBox="0 0 x y"'), PAGE, DocumentKind.STUDENT_ID_CARD, FONTS, flat),
    ).toThrow(SvgImportError);
  });

  it('maps text-anchor to alignment', () => {
    expect(one({ textAnchor: 'middle' }).elements[0]).toMatchObject({ align: 'center' });
    expect(one({ textAnchor: 'end' }).elements[0]).toMatchObject({ align: 'right' });
    expect(one({ textAnchor: 'start' }).elements[0]).toMatchObject({ align: 'left' });
  });

  it('maps font weight to the four allowed weights', () => {
    expect(one({ fontWeight: 'bold' }).elements[0]).toMatchObject({ weight: 700 });
    expect(one({ fontWeight: '700' }).elements[0]).toMatchObject({ weight: 700 });
    expect(one({ fontWeight: '600' }).elements[0]).toMatchObject({ weight: 600 });
    expect(one({ fontWeight: '500' }).elements[0]).toMatchObject({ weight: 500 });
    expect(one({ fontWeight: 'normal' }).elements[0]).toMatchObject({ weight: 400 });
  });

  it('uses 10 pt when the size is unreadable, and clamps a huge or tiny size', () => {
    expect(one({ fontSize: '' }).elements[0]).toMatchObject({ sizePt: 10 });
    expect(one({ fontSize: '9000px' }).elements[0]).toMatchObject({ sizePt: 96 });
    expect(one({ fontSize: '0.1px' }).elements[0]).toMatchObject({ sizePt: 4 });
  });

  it('takes the first family, unquoted, and treats a missing family as a fallback', () => {
    expect(one({ fontFamily: `"Hind Siliguri", sans-serif` }).elements[0]).toMatchObject({
      fontFamily: 'Hind Siliguri',
    });
    const none = one({ fontFamily: '' });
    expect(none.elements[0]).toMatchObject({ fontFamily: 'Biddaloy Sans' });
    expect(none.warnings.fontFallback).toEqual([{ field: 'student.name', family: '—' }]);
  });

  it('warns about a known key that is not a text field (a photo), and keeps it', () => {
    const r = one({}, '{{student.photo}}');
    expect(r.elements).toHaveLength(0);
    expect(r.warnings.unknown).toEqual(['student.photo']);
  });

  it('never returns a zero-size element', () => {
    const tiny: Measure = () => ({ x: 0, y: 0, width: 0, height: 0 });
    const r = importSvg(
      svg('<text>{{student.name}}</text>'),
      PAGE,
      DocumentKind.STUDENT_ID_CARD,
      FONTS,
      tiny,
      style(),
    );
    expect(r.elements[0]).toMatchObject({ w: 1, h: 1 });
  });
});

describe('toHex', () => {
  it('handles rgba(), 6-digit hex and 3-digit hex', () => {
    expect(toHex('rgba(1, 2, 3, 0.5)')).toBe('#010203');
    expect(toHex('#A1B2C3')).toBe('#a1b2c3');
    expect(toHex('  #fff ')).toBe('#ffffff');
    expect(toHex('url(#g)')).toBe('#000000');
  });
});

describe('domMeasure', () => {
  const node = (ctm: object | null) =>
    ({
      getBBox: () => ({ x: 10, y: 20, width: 30, height: 40 }),
      getCTM: () => ctm,
    }) as unknown as SVGGraphicsElement;

  it('returns the box as-is when there is no transform', () => {
    expect(domMeasure(node(null))).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
  it('maps the box through the transform (scale 2, translate 5,6)', () => {
    expect(domMeasure(node({ a: 2, b: 0, c: 0, d: 2, e: 5, f: 6 }))).toEqual({
      x: 25,
      y: 46,
      width: 60,
      height: 80,
    });
  });
});

describe('domStyleOf', () => {
  it('reads style from the element, falling back to attributes', () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'text') as SVGGraphicsElement;
    el.setAttribute('text-anchor', 'end');
    document.body.appendChild(el);
    const s = domStyleOf(el);
    expect(typeof s.fontSize).toBe('string');
    expect(typeof s.fill).toBe('string');
    el.remove();
  });
});
