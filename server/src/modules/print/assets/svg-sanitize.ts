import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sanitizeHtml from 'sanitize-html';

export const SVG_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_TAGS = [
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'image',
  'use',
  'symbol',
  'title',
  'desc',
  'style',
];

// No `on*`, no `style` attribute (Illustrator styling goes in <style> classes).
const ALLOWED_ATTRS = [
  'xmlns',
  'xmlns:xlink',
  'version',
  'd',
  'x',
  'y',
  'width',
  'height',
  'viewBox',
  'transform',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'letter-spacing',
  'points',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x1',
  'y1',
  'x2',
  'y2',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'patternUnits',
  'patternTransform',
  'clipPathUnits',
  'clip-path',
  'clip-rule',
  'mask',
  'id',
  'class',
  'preserveAspectRatio',
  'href',
  'xlink:href',
  'xml:space',
];

const ROOT_RE = /^\s*(?:<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i;
const LOCAL_OR_DATA_HREF = /^(#.*|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]*)$/;
// Any url( that is not url(#id) — external fetches and data exfiltration.
const NON_LOCAL_URL = /url\(\s*(?!['"]?\s*#)/i;

// sanitize-html emits <style> text verbatim, so we own it. Reject anything
// that can hide a tag, an entity or an escaped keyword (`\75rl(`, `@\69mport`).
const BAD_CSS = /[<&\\]|image-set\(|expression\(/i;

function cleanCss(css: string): string {
  if (BAD_CSS.test(css)) throw new BadRequestException('SVG <style> has unsupported content');
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(?!['"]?\s*#)[^)]*\)/gi, '')
    .replace(/>/g, '&gt;');
}

function toPx(value: string | undefined): number | undefined {
  const m = value?.trim().match(/^(\d+(?:\.\d+)?)(px)?$/);
  return m ? Math.round(Number(m[1])) : undefined;
}

/**
 * [32.2.2] D24/D52 — allowlist-sanitizes an uploaded SVG. Throws
 * BadRequestException for a non-svg root, a missing size, or > 10 MB.
 */
export function sanitizePrintSvg(buffer: Buffer): {
  svg: string;
  widthPx?: number;
  heightPx?: number;
} {
  if (buffer.length > SVG_MAX_BYTES) {
    throw new BadRequestException('SVG must be at most 10MB');
  }
  const input = buffer.toString('utf8');
  if (!ROOT_RE.test(input)) throw new BadRequestException('File is not an SVG document');

  // <style> bodies are cleaned by us and re-inserted after sanitizing, so the
  // parser never sees CSS text that could smuggle markup (CDATA / entities).
  const token = `__CSS_${randomUUID()}_`;
  const styles: string[] = [];
  const stashed = input.replace(
    /(<style\b[^>]*(?<!\/)>)([\s\S]*?)(<\/style>)/g,
    (_m, open, css, close) => `${open}${token}${styles.push(cleanCss(css)) - 1}__${close}`,
  );

  const svg = sanitizeHtml(stashed, {
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false },
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { '*': ALLOWED_ATTRS },
    // sanitize-html drops <style> text by default; we keep it, cleaned below.
    nonTextTags: ['script', 'textarea', 'option', 'noscript'],
    allowVulnerableTags: true,
    transformTags: {
      '*': (tagName, attribs) => {
        const out: Record<string, string> = {};
        for (const [name, value] of Object.entries(attribs)) {
          if (
            (name === 'href' || name === 'xlink:href') &&
            !LOCAL_OR_DATA_HREF.test(value.trim())
          ) {
            continue;
          }
          if (/javascript:|image-set\(|\\/i.test(value) || NON_LOCAL_URL.test(value)) continue;
          out[name] = value;
        }
        return { tagName, attribs: out };
      },
    },
    // The href allowlist above is the real gate; this only stops sanitize-html
    // from rejecting the `data:` scheme a second time.
    allowedSchemes: ['data'],
  }).replace(new RegExp(`${token}(\\d+)__`, 'g'), (_m, i) => styles[Number(i)] ?? '');

  // Defense in depth: no tag outside the allowlist may survive in the output.
  for (const m of svg.matchAll(/<\/?([A-Za-z][\w:.-]*)/g)) {
    if (!ALLOWED_TAGS.includes(m[1]!)) {
      throw new BadRequestException('SVG contains unsupported markup');
    }
  }

  const root = svg.match(/<svg\b[^>]*>/);
  if (!root) throw new BadRequestException('File is not an SVG document');
  const attr = (n: string) => root[0].match(new RegExp(`\\s${n}="([^"]*)"`))?.[1];

  let widthPx = toPx(attr('width'));
  let heightPx = toPx(attr('height'));
  const vb = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (vb?.length === 4 && vb.every(Number.isFinite)) {
    widthPx ??= Math.round(vb[2]!);
    heightPx ??= Math.round(vb[3]!);
  } else if (widthPx === undefined || heightPx === undefined) {
    throw new BadRequestException('SVG needs a viewBox or width and height');
  }
  return { svg, widthPx, heightPx };
}
