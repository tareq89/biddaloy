/**
 * [32.3.3] Smart SVG import (D6, D29, D52). A designer writes `{{student.name_bn}}` as
 * live text in Illustrator / Inkscape. We turn each such text into a positioned TEXT
 * element and take the text OUT of the artwork, so the field is not printed twice.
 *
 *   <text>{{student.name}}</text>  ──▶  TEXT element { field: 'student.name', x, y, w, h, … }
 *                                       + the same SVG with that <text> removed
 *
 * Positions come from the browser (`getBBox` + `getCTM`), so nested `<g transform>`,
 * CSS-class fills and tspans all resolve the way the designer saw them. jsdom has no
 * `getBBox`, hence the injectable `measure`.
 */
import {
  FIELD_CATALOG,
  OverflowPolicy,
  type DocumentKind,
  type PrintElement,
  type TemplateDefinition,
} from '@biddaloy/shared';

/** A box in the SVG's own user units, after every parent transform. */
export interface UserBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Measure = (node: SVGGraphicsElement) => UserBox;

export interface SvgImportWarnings {
  /** `{{keys}}` that are not fields of this document type. The text is kept in the artwork. */
  unknown: string[];
  /** Fields whose font is not available; they use Biddaloy Sans. */
  fontFallback: Array<{ field: string; family: string }>;
  /** Texts that mix a placeholder with other words. */
  mixed: string[];
  /** Set when the artboard's shape differs from the page's. */
  aspect?: { svgWidth: number; svgHeight: number };
}

export interface SvgImportResult {
  cleanedSvg: string;
  elements: PrintElement[];
  warnings: SvgImportWarnings;
}

export class SvgImportError extends Error {}

const FULL = /^\{\{\s*([a-z_.]+)\s*\}\}$/;
const ANY = /\{\{[^}]*\}\}/;
const FALLBACK_FONT = 'Biddaloy Sans';
const ASPECT_TOLERANCE = 0.01;

/** Real-browser measure: bbox of the node mapped through its CTM into the root's user space. */
/** What the designer saw for one text: the browser's computed style, with attributes as a fallback. */
export interface TextStyle {
  fill: string;
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
  textAnchor: string;
}
export type StyleOf = (node: SVGGraphicsElement) => TextStyle;

export const domStyleOf: StyleOf = (node) => {
  const s = getComputedStyle(node);
  return {
    fill: s.fill || node.getAttribute('fill') || '',
    fontSize: s.fontSize || node.getAttribute('font-size') || '',
    fontFamily: s.fontFamily || node.getAttribute('font-family') || '',
    fontWeight: s.fontWeight || node.getAttribute('font-weight') || '400',
    textAnchor: s.getPropertyValue('text-anchor') || node.getAttribute('text-anchor') || 'start',
  };
};

export const domMeasure: Measure = (node) => {
  const box = node.getBBox();
  const m = node.getCTM();
  if (!m) return { x: box.x, y: box.y, width: box.width, height: box.height };
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ] as const) {
    xs.push(m.a * px + m.c * py + m.e);
    ys.push(m.b * px + m.d * py + m.f);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** `rgb(1, 2, 3)` / `#abc` / `#aabbcc` -> `#rrggbb`. Anything else (none, url()) -> black. */
export function toHex(value: string): string {
  const v = value.trim().toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(v);
  if (rgb)
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`;
  return '#000000';
}

function firstFamily(value: string): string {
  const first = value.split(',')[0] ?? '';
  return first.trim().replace(/^['"]|['"]$/g, '');
}

function weightOf(value: string): 400 | 500 | 600 | 700 {
  if (value === 'bold') return 700;
  const n = Number(value);
  if (n >= 700) return 700;
  if (n >= 600) return 600;
  if (n >= 500) return 500;
  return 400;
}

const ACTIVE_ELEMENTS = 'script, foreignObject, iframe, object, embed, audio, video, animate, set';
const LOCAL_OR_DATA_IMAGE = /^(#|data:image\/(png|jpeg|webp);base64,)/i;

/**
 * The file is a designer's, so before it is mounted in the live page (to measure it) it is
 * stripped of anything active: scripts and embedded documents, `on*` handlers, any link that
 * is not `#id` or an embedded image, and CSS `@import` / external `url()`. The server
 * sanitises the upload again (32.2.2); this keeps the measuring step itself inert.
 */
export function stripActiveContent(root: Element): void {
  for (const el of Array.from(root.querySelectorAll(ACTIVE_ELEMENTS))) el.remove();
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const isLink = name === 'href' || name === 'xlink:href' || name.endsWith(':href');
      if (name.startsWith('on') || (isLink && !LOCAL_OR_DATA_IMAGE.test(attr.value.trim()))) {
        el.removeAttribute(attr.name);
      } else if (name === 'style') {
        el.setAttribute(attr.name, scrubCss(attr.value));
      }
    }
  }
  for (const style of Array.from(root.querySelectorAll('style'))) {
    style.textContent = scrubCss(style.textContent ?? '');
  }
}

/** Removes `@import` rules and every `url()` that is not a `#fragment`. */
function scrubCss(css: string): string {
  return css.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(?!['"]?\s*#)[^)]*\)/gi, 'none');
}

export function importSvg(
  svgText: string,
  page: TemplateDefinition['page'],
  kind: DocumentKind,
  availableFonts: string[],
  measure: Measure = domMeasure,
  styleOf: StyleOf = domStyleOf,
): SvgImportResult {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) {
    throw new SvgImportError('not-svg');
  }
  stripActiveContent(root);

  // The artboard: viewBox if present, else width/height.
  const vb = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const [minX, minY, vbW, vbH] =
    vb && vb.length === 4 && vb.every(Number.isFinite)
      ? (vb as [number, number, number, number])
      : [
          0,
          0,
          parseFloat(root.getAttribute('width') ?? ''),
          parseFloat(root.getAttribute('height') ?? ''),
        ];
  if (!(vbW > 0) || !(vbH > 0)) throw new SvgImportError('no-artboard');
  const mmPerUnit = page.widthMm / vbW;

  const warnings: SvgImportWarnings = { unknown: [], fontFallback: [], mixed: [] };
  const svgRatio = vbW / vbH;
  const pageRatio = page.widthMm / page.heightMm;
  if (Math.abs(svgRatio / pageRatio - 1) > ASPECT_TOLERANCE) {
    warnings.aspect = {
      svgWidth: r1(vbW * mmPerUnit),
      svgHeight: r1(vbH * mmPerUnit),
    };
  }

  // Mount off-screen so computed style and layout exist.
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none';
  const svg = document.adoptNode(root) as unknown as SVGSVGElement;
  host.appendChild(svg);
  document.body.appendChild(host);

  try {
    const known = new Map(FIELD_CATALOG[kind].map((f) => [f.key, f]));
    const fontSet = new Set(availableFonts.map((f) => f.toLowerCase()));
    const elements: PrintElement[] = [];
    const used = new Set<string>();
    const nextId = () => {
      let n = elements.length + 1;
      while (used.has(`svg-${n}`)) n += 1;
      used.add(`svg-${n}`);
      return `svg-${n}`;
    };

    for (const node of Array.from(svg.querySelectorAll<SVGTextElement>('text'))) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      const match = FULL.exec(text);
      if (!match) {
        if (ANY.test(text)) warnings.mixed.push(text);
        continue;
      }
      const key = match[1] as string;
      const def = known.get(key);
      if (!def || def.type !== 'text') {
        warnings.unknown.push(key);
        continue; // kept in the artwork so the designer sees it
      }

      const box = measure(node);
      const style = styleOf(node);
      const family = firstFamily(style.fontFamily);
      const known_ = family !== '' && fontSet.has(family.toLowerCase());
      if (!known_) warnings.fontFallback.push({ field: key, family: family || '—' });

      const sizeUnits = parseFloat(style.fontSize);
      const sizePt = Number.isFinite(sizeUnits) ? (sizeUnits * mmPerUnit * 72) / 25.4 : 10;
      const anchor = style.textAnchor;

      elements.push({
        id: nextId(),
        type: 'TEXT',
        x: r1((box.x - minX) * mmPerUnit),
        y: r1((box.y - minY) * mmPerUnit),
        w: Math.max(r1(box.width * mmPerUnit), 1),
        h: Math.max(r1(box.height * mmPerUnit), 1),
        field: key,
        fontFamily: known_ ? family : FALLBACK_FONT,
        sizePt: Math.min(Math.max(r1(sizePt), 4), 96),
        weight: weightOf(style.fontWeight),
        color: toHex(style.fill),
        align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
        overflow: OverflowPolicy.SHRINK,
      });
      node.remove();
    }

    return { cleanedSvg: new XMLSerializer().serializeToString(svg), elements, warnings };
  } finally {
    host.remove();
  }
}
