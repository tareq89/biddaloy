import { PrinterType, type TemplateDefinition } from '@biddaloy/shared';
import { renderToStaticMarkup } from 'react-dom/server';

import { prepareQr, TemplateRenderer, type PrintFont, type Sheet } from '../template-renderer';

/** Calibration of one printer profile (D21). */
export interface PrintCalibration {
  type: PrinterType;
  offsetXMm: number;
  offsetYMm: number;
  scale: number;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Every font url must already be a data URL: the print tab makes no requests. */
function fontFaces(fonts: PrintFont[]): string {
  return fonts
    .map((f) => {
      if (!f.url.startsWith('data:')) throw new Error(`font is not a data URL: ${f.family}`);
      return (
        `@font-face{font-family:"${f.family.replace(/["\\<>;{}]/g, '')}";src:url("${f.url.replace(/["()\\<>\s]/g, encodeURIComponent)}");` +
        `font-weight:400 700;font-display:block;` +
        `${f.unicodeRange ? `unicode-range:${f.unicodeRange.replace(/[^0-9a-fA-F+,\s?U-]/g, '')};` : ''}}`
      );
    })
    .join('');
}

/** The shared document shell: `@page`, sheet + calibration CSS, inlined fonts. Body is already-built HTML. */
export function printShell(opts: {
  printer: PrintCalibration;
  pageMm: { widthMm: number; heightMm: number };
  fonts: PrintFont[];
  lang: string;
  title: string;
  body: string;
}): string {
  const { printer, fonts, lang, title, body } = opts;
  const { widthMm: w, heightMm: h } =
    printer.type === PrinterType.CARD ? opts.pageMm : { widthMm: 210, heightMm: 297 };
  const html =
    `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>` +
    `@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0}` +
    `.sheet{width:${w}mm;height:${h}mm;break-after:page;position:relative;overflow:hidden}` +
    `.sheet-inner{transform:translate(${printer.offsetXMm}mm,${printer.offsetYMm}mm) scale(${printer.scale});transform-origin:0 0}` +
    `${fontFaces(fonts)}</style></head><body>${body}</body></html>`;
  // Guard: no network fetches when opened (Acceptance 1). `url(data:` in fonts is fine.
  if (/<img\b[^>]*\bsrc="(?!data:)/i.test(html)) throw new Error('non-data image URL');
  return html;
}

export interface BuildPrintDocumentInput {
  definition: TemplateDefinition;
  /** Sheets from `layoutPages`, already in print order. */
  sheets: Sheet[];
  /** Field values per card; `Sheet.cards[].index` points into this. */
  cards: Record<string, string>[];
  printer: PrintCalibration;
  fonts: PrintFont[];
  lang: string;
  title: string;
  /** Must resolve to data URLs (see `fetchAsDataUrl`). */
  assetUrl: (assetId: string) => string;
}

/**
 * Async only because the QR svgs are generated asynchronously; they are
 * prepared first so the static markup below already contains them.
 */
export async function buildPrintDocument(input: BuildPrintDocumentInput): Promise<string> {
  const { definition, sheets, cards, printer, fonts, lang, title, assetUrl } = input;
  await prepareQr(cards.map((c) => c['print.verify_qr'] ?? ''));

  const body = sheets
    .map(
      (sheet) =>
        `<div class="sheet"><div class="sheet-inner">` +
        sheet.cards
          .map(
            (c) =>
              `<div style="position:absolute;left:${c.xMm}mm;top:${c.yMm}mm">` +
              renderToStaticMarkup(
                <TemplateRenderer
                  definition={definition}
                  side={sheet.side}
                  values={cards[c.index] ?? {}}
                  assetUrl={assetUrl}
                  mode="print"
                />,
              ) +
              `</div>`,
          )
          .join('') +
        sheet.cropMarks
          .map(
            (m) =>
              `<svg style="position:absolute;left:0;top:0;overflow:visible" width="1" height="1"><line x1="${m.x1}mm" y1="${m.y1}mm" x2="${m.x2}mm" y2="${m.y2}mm" stroke="#000" stroke-width="0.1mm"/></svg>`,
          )
          .join('') +
        `</div></div>`,
    )
    .join('');

  return printShell({ printer, pageMm: definition.page, fonts, lang, title, body });
}
