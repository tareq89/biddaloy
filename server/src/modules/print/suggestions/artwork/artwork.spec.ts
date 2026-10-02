import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const DIR = __dirname;
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.svg'))
  .sort();

const BOX = {
  portrait: { width: '54mm', height: '85.6mm', viewBox: '0 0 54 85.6' },
  landscape: { width: '85.6mm', height: '54mm', viewBox: '0 0 85.6 54' },
  a4: { width: '210mm', height: '297mm', viewBox: '0 0 210 297' },
};
// The allowlist 32.2.2 enforces (Epic 32.0 #1134).
const ALLOWED = new Set(
  (
    'svg g path rect circle ellipse line polyline polygon defs linearGradient ' +
    'radialGradient stop clipPath mask pattern use symbol title desc style'
  ).split(' '),
);

describe('suggestion artwork', () => {
  it('ships all 17 files (8 card designs x front/back + 1 A4 ACR page)', () => {
    expect(FILES).toHaveLength(17);
  });

  it.each(FILES)('%s is clean, correctly sized background artwork', (file) => {
    const xml = readFileSync(join(DIR, file), 'utf8');
    // image/svg+xml makes jsdom parse strictly as XML and throw when malformed.
    const doc = new JSDOM(xml, { contentType: 'image/svg+xml' }).window.document;
    const root = doc.documentElement;

    expect(root.localName).toBe('svg');
    const box = file.startsWith('acr-')
      ? BOX.a4
      : file.includes('-landscape-')
        ? BOX.landscape
        : BOX.portrait;
    expect(root.getAttribute('viewBox')).toBe(box.viewBox);
    expect(root.getAttribute('width')).toBe(box.width);
    expect(root.getAttribute('height')).toBe(box.height);

    const all = [root, ...Array.from(root.querySelectorAll('*'))];
    for (const el of all) {
      expect(ALLOWED.has(el.localName)).toBe(true); // covers text/script/foreignObject
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
        if (attr.localName === 'href') expect(attr.value.startsWith('#')).toBe(true);
        if (attr.localName === 'style') {
          expect(attr.value).not.toMatch(/@import/i);
          expect(attr.value).not.toMatch(/url\(\s*['"]?(?!#)/i);
        }
      }
    }

    for (const style of Array.from(root.querySelectorAll('style'))) {
      const css = style.textContent ?? '';
      expect(css).not.toMatch(/@import/i);
      expect(css).not.toMatch(/url\(\s*['"]?(?!#)/i);
    }

    expect(xml).not.toContain('{{');
  });
});
