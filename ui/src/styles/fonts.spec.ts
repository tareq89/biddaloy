import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { typography } from '../../tailwind.preset';

/**
 * The webfonts are committed build artifacts (`ui/scripts/fonts/build-fonts.mjs`
 * produces them; CI never runs it), so nothing but this spec stands between a
 * careless re-subset and a 400 KB font landing on a 700 kbps connection.
 *
 * The byte budgets come from the design contract §2 and are the same numbers
 * the LCP budget in `lighthouserc.cjs` was reasoned against. Raising one is a
 * deliberate decision that belongs in the contract first, not here.
 *
 * The measured Bangla subset (135,952 B) sits 2.2 KB under its 135 KB
 * budget — the contract's §10 item 1 closed on that basis (design
 * contract §10).
 */
const stylesDir = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(stylesDir, 'globals.css'), 'utf8');

const FACES = [
  {
    file: 'anek-latin.woff2',
    budgetBytes: 45 * 1024,
    weights: '400 800',
    unicodeRange: /U\+0000-00FF/,
  },
  {
    file: 'anek-bangla.woff2',
    budgetBytes: 135 * 1024,
    // 400-700, not 400-800: §2's sanctioned relief valve, used because the
    // Bangla subset measured 141,116 B at 400-800. See globals.css.
    weights: '400 700',
    unicodeRange: /U\+0980-09FF/,
  },
];

describe('self-hosted webfonts', () => {
  it.each(FACES)('$file stays inside its byte budget', ({ file, budgetBytes }) => {
    const bytes = statSync(join(stylesDir, 'fonts', file)).size;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(budgetBytes);
  });

  it('stays inside the 180 KB total webfont budget', () => {
    const total = FACES.reduce(
      (sum, { file }) => sum + statSync(join(stylesDir, 'fonts', file)).size,
      0,
    );
    expect(total).toBeLessThanOrEqual(180 * 1024);
  });

  it.each(FACES)('$file ships its OFL licence alongside it', ({ file }) => {
    const licence = file.replace('anek-', 'OFL-anek-').replace('.woff2', '.txt');
    expect(readFileSync(join(stylesDir, 'fonts', licence), 'utf8')).toContain(
      'SIL OPEN FONT LICENSE',
    );
  });
});

describe('globals.css @font-face wiring', () => {
  it.each(FACES)('serves $file from our own origin, split by unicode-range', (face) => {
    const block = css.split('@font-face').find((chunk) => chunk.includes(`./fonts/${face.file}`));
    expect(block, `no @font-face references ./fonts/${face.file}`).toBeDefined();
    expect(block).toMatch(/font-family:\s*"Biddaloy Sans"/);
    expect(block).toMatch(/font-display:\s*swap/);
    expect(block).toMatch(new RegExp(`font-weight:\\s*${face.weights}`));
    expect(block).toMatch(face.unicodeRange);
  });

  it('never contacts a third-party font origin', () => {
    // Self-hosting is the whole point: a Google Fonts URL here would put a
    // third-party connection on the critical path and leak every page view.
    expect(css).not.toMatch(/url\(\s*["']?https?:/i);
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic|bunny)\b/i);
  });

  it('metric-matches the fallback family on both scripts so the swap cannot reflow', () => {
    const fallbacks = css
      .split('@font-face')
      .filter((chunk) => chunk.includes('"Biddaloy Sans Fallback"'));
    expect(fallbacks).toHaveLength(2);
    for (const block of fallbacks) {
      expect(block).toMatch(/size-adjust:\s*\d+(\.\d+)?%/);
      expect(block).toMatch(/ascent-override:\s*\d+(\.\d+)?%/);
      expect(block).toMatch(/descent-override:\s*\d+(\.\d+)?%/);
      expect(block).toMatch(/line-gap-override:\s*\d+(\.\d+)?%/);
      expect(block).toMatch(/src:\s*local\(/);
    }
  });
});

describe('type ramp mirror', () => {
  const theme = css.slice(css.indexOf('@theme {'));

  it('puts the fallback family between the webfont and system-ui', () => {
    // Order matters: system-ui first would mean the metric overrides never
    // apply, and the swap would move layout after all.
    expect(typography.fontSans).toBe(
      '"Biddaloy Sans", "Biddaloy Sans Fallback", system-ui, "Segoe UI", sans-serif',
    );
    expect(theme).toContain(`--font-sans: ${typography.fontSans};`);
  });

  it.each(Object.entries(typography.ramp))(
    'mirrors every sub-property of the %s step into @theme',
    (step, values) => {
      expect(theme).toContain(`--text-${step}: ${values.size};`);
      expect(theme).toContain(`--text-${step}--line-height: ${values.lineHeight};`);
      expect(theme).toContain(`--text-${step}--font-weight: ${values.weight};`);
      expect(theme).toContain(`--text-${step}--letter-spacing: ${values.tracking};`);
    },
  );

  it('keeps every ramp weight inside the shipped variable axes', () => {
    // Latin is subset to wght 400-800 and Bangla to 400-700; a step outside
    // that range would silently synthesise a fake bold on one script only.
    for (const { weight } of Object.values(typography.ramp)) {
      expect(Number(weight)).toBeGreaterThanOrEqual(400);
      expect(Number(weight)).toBeLessThanOrEqual(700);
    }
  });
});
