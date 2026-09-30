import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { sanitizePrintSvg } from './svg-sanitize';

const run = (s: string) => sanitizePrintSvg(Buffer.from(s, 'utf8'));
const wrap = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${inner}</svg>`;

describe('sanitizePrintSvg — stripped', () => {
  it('removes <script> and its body', () => {
    const { svg } = run(wrap('<script>alert(1)</script><rect width="1" height="1"/>'));
    expect(svg).not.toMatch(/script|alert/i);
    expect(svg).toContain('<rect');
  });

  it('removes on* handlers', () => {
    const { svg } = run(wrap('<rect width="1" height="1" onload="alert(1)" onclick="x()"/>'));
    expect(svg).not.toMatch(/onload|onclick|alert/i);
  });

  it('removes <foreignObject> and its html', () => {
    const { svg } = run(wrap('<foreignObject><div>hi</div></foreignObject>'));
    expect(svg).not.toMatch(/foreignObject/i);
  });

  it('removes external and javascript hrefs', () => {
    const { svg } = run(
      wrap(
        '<image href="https://evil.test/a.png"/><use xlink:href="javascript:alert(1)"/><image href="data:text/html;base64,AAAA"/>',
      ),
    );
    expect(svg).not.toMatch(/evil\.test|javascript|text\/html/i);
  });

  it('removes @import and non-local url() inside <style>', () => {
    const { svg } = run(
      wrap(
        '<style>@import url(https://evil.test/x.css); .a{fill:url(https://evil.test/p);} .b{fill:url(#g)}</style>',
      ),
    );
    expect(svg).not.toMatch(/evil\.test|@import/);
    expect(svg).toContain('url(#g)');
  });

  it('removes non-local url() in attributes and the style attribute', () => {
    const { svg } = run(wrap('<rect fill="url(https://evil.test/x)" style="fill:red" width="1"/>'));
    expect(svg).not.toMatch(/evil\.test|style=/);
  });
});

describe('sanitizePrintSvg — regression: markup smuggled through <style>', () => {
  const noScript = (s: string) => expect(s).not.toMatch(/<script|alert\(1\)/i);

  it('rejects entity-encoded </style><script> in style text', () => {
    const input = wrap('<style>.a{}&lt;/style&gt;&lt;script&gt;alert(1)&lt;/script&gt;</style>');
    expect(() => run(input)).toThrow(BadRequestException);
  });

  it('rejects a CDATA section that closes <style> and opens <script>', () => {
    const input = wrap('<style><![CDATA[</style><script>alert(1)</script>]]></style>');
    let out = '';
    try {
      out = run(input).svg;
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
    }
    noScript(out);
  });

  it('never lets a raw < or & into style text', () => {
    const { svg } = run(wrap('<style>.a > .b{fill:red}</style>'));
    expect(svg).toContain('.a &gt; .b{fill:red}');
    expect(svg.match(/<style>([\s\S]*?)<\/style>/)![1]).not.toMatch(/[<&](?!gt;)/);
  });
});

describe('sanitizePrintSvg — regression: round 2 style bypasses', () => {
  const S = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';
  // Either rejected, or the OUTPUT must be inert. Never live markup.
  const inert = (input: string) => {
    let out = '';
    try {
      out = run(input).svg;
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return;
    }
    expect(out).not.toMatch(/<[^>]*\son\w+\s*=/i); // inside a real tag; escaped text is inert
    // Entity-escaped text like `&lt;svg onload=alert(1)&gt;` is inert; only a real `<script` matters.
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/url\(\s*(?!['"]?#)/i);
    expect(out).not.toMatch(/@import|evil|\/\/e\//i);
    expect(out).not.toMatch(/<(?!\/?(?:svg|style|rect|g|image)\b)/);
  };

  it.each([
    ['</style >', `${S}<style>&lt;/style&gt;&lt;svg onload=alert(1)&gt;</style ></svg>`],
    ['</style\\n>', `${S}<style>&lt;/style&gt;&lt;svg onload=alert(1)&gt;</style\n></svg>`],
    ['unclosed <style>', `${S}<style>&lt;/style&gt;&lt;svg onload=alert(1)&gt;</svg>`],
    [
      'entity <image onerror>',
      `${S}<style>&lt;/style&gt;&lt;image href=x onerror=alert(1)/&gt;</style ></svg>`,
    ],
    ['uppercase STYLE', `${S}<STYLE>&lt;/STYLE&gt;&lt;svg onload=alert(1)&gt;</STYLE></svg>`],
    [
      '@import + url with </style >',
      `${S}<style>@import url(//evil.x/a.css); .a{background:url(//evil.x/p)}</style ></svg>`,
    ],
    ['url with unclosed style', `${S}<style>.a{background:url(http://e/)}</svg>`],
  ])('%s is rejected or inert', (_n, input) => inert(input));

  it('the two external-ref cases are actually rejected or stripped, not kept', () => {
    for (const css of [
      '@import url(//evil.x/a.css); .a{fill:red}',
      '.a{background:url(http://e/)}',
    ]) {
      for (const close of ['</style >', '</style\n>', '</style>']) {
        inert(`${S}<style>${css}${close}</svg>`);
      }
    }
  });
});

describe('sanitizePrintSvg — regression: CSS escape bypasses', () => {
  it.each([
    ['escaped url(', '<style>.a{fill:\\75rl(https://evil.test/x)}</style>'],
    ['escaped @import', '<style>@\\69mport "https://evil.test/x.css";</style>'],
    ['image-set(', '<style>.a{background:image-set("https://evil.test/x.png" 1x)}</style>'],
  ])('rejects %s in style text', (_n, inner) => {
    expect(() => run(wrap(inner))).toThrow(BadRequestException);
  });

  it.each([
    'fill="\\75rl(https://evil.test/x)"',
    'fill="image-set(https://evil.test/x)"',
    'fill="url(https://evil.test/x)"',
  ])('drops the attribute %s', (attr) => {
    const { svg } = run(wrap(`<rect ${attr} width="1" height="1"/>`));
    expect(svg).not.toMatch(/evil\.test|fill=/);
  });
});

describe('sanitizePrintSvg — kept', () => {
  it('keeps a data:image/png image href', () => {
    const { svg } = run(wrap('<image href="data:image/png;base64,iVBORw0KGgo="/>'));
    expect(svg).toContain('data:image/png;base64,iVBORw0KGgo=');
  });

  it('keeps a #gradient fill and gradient definitions', () => {
    const { svg } = run(
      wrap(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)" width="1" height="1"/>',
      ),
    );
    expect(svg).toContain('<linearGradient id="g">');
    expect(svg).toContain('fill="url(#g)"');
  });

  it('keeps {{placeholder}} text', () => {
    const { svg } = run(wrap('<text x="1" y="2">{{student.name}}</text>'));
    expect(svg).toContain('{{student.name}}');
  });

  it('returns size from viewBox, and from width/height when present', () => {
    expect(run(wrap('')).widthPx).toBe(100);
    expect(run('<svg width="300px" height="200"></svg>')).toMatchObject({
      widthPx: 300,
      heightPx: 200,
    });
  });

  it('keeps an Illustrator export (xml decl, doctype, <style> classes)', () => {
    const ai = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 27.0 -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 856 540" xml:space="preserve">
<style type="text/css">.st0{fill:#1A237E;}.st1{font-family:'Noto Sans';font-size:24px;}</style>
<rect class="st0" width="856" height="540"/>
<text transform="matrix(1 0 0 1 40 60)" class="st1">Name</text>
</svg>`;
    const { svg, widthPx, heightPx } = run(ai);
    expect(svg).toContain('.st0{fill:#1A237E;}');
    expect(svg).toContain('class="st0"');
    expect(svg).toContain('>Name</text>');
    expect(svg).toContain('viewBox="0 0 856 540"');
    expect([widthPx, heightPx]).toEqual([856, 540]);
  });

  it('keeps an Inkscape export (namespaced sodipodi noise dropped, paths kept)', () => {
    const ink = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns="http://www.w3.org/2000/svg" width="85.6mm" height="54mm" viewBox="0 0 85.6 54" version="1.1" id="svg5">
<sodipodi:namedview id="namedview7" inkscape:zoom="1"/>
<g inkscape:label="Layer 1" id="layer1"><path d="M 0,0 H 85.6 V 54 H 0 Z" fill="#ffffff" stroke-width="0.26"/><circle cx="10" cy="10" r="5" fill="#f00"/></g>
</svg>`;
    const { svg, widthPx } = run(ink);
    expect(svg).toContain('<path d="M 0,0 H 85.6 V 54 H 0 Z"');
    expect(svg).toContain('<circle');
    expect(svg).not.toMatch(/sodipodi:namedview|inkscape:zoom/);
    expect(widthPx).toBe(86); // mm width ignored, viewBox used
  });
});

describe('sanitizePrintSvg — rejected', () => {
  it('rejects a non-svg root', () => {
    expect(() => run('<html><body><svg viewBox="0 0 1 1"/></body></html>')).toThrow(
      BadRequestException,
    );
    expect(() => run('not xml')).toThrow(BadRequestException);
  });

  it('rejects a missing size', () => {
    expect(() => run('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toThrow(
      /viewBox or width and height/,
    );
  });

  it('rejects over 10 MB', () => {
    expect(() => sanitizePrintSvg(Buffer.alloc(10 * 1024 * 1024 + 1, 32))).toThrow(/10MB/);
  });

  // A file made of thousands of unclosed comment / prolog starts used to backtrack
  // exponentially in the root check. It must be rejected quickly, not hang.
  it('rejects a pathological prolog in linear time', () => {
    const started = Date.now();
    for (const chunk of ['<!--', '<?xml ', '<!DOCTYPE ']) {
      expect(() => run(chunk.repeat(20_000))).toThrow(BadRequestException);
    }
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('still accepts an xml declaration, comment and doctype before <svg>', () => {
    const svg =
      '<?xml version="1.0"?>\n<!-- Generator: Illustrator -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="1" height="1"/></svg>';
    expect(() => run(svg)).not.toThrow();
  });
});
