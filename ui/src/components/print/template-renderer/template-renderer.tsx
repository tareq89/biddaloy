/**
 * One template side at true physical size: the root is `{w}mm x {h}mm`,
 * elements are positioned in mm and text is sized in pt. No px anywhere, so
 * the editor canvas, the preview and the print tab all show what prints.
 */
import { fillPlaceholders, textPlaceholders, type TemplateDefinition } from '@biddaloy/shared';
import { useTranslation } from 'react-i18next';

import { renderDigits } from '../../../utils/digits';

import type { PrintFont } from './bundled-fonts';
import { ImageElement } from './image-element';
import { QrElement } from './qr-element';
import { ShapeElement } from './shape-element';
import { TextElement } from './text-element';

export type TemplateRendererMode = 'editor' | 'preview' | 'print';

export interface TemplateRendererProps {
  definition: TemplateDefinition;
  side: 'front' | 'back';
  /** Field key -> text, or URL / data URL for image fields, or the verify URL for `print.verify_qr`. */
  values: Record<string, string>;
  assetUrl: (assetId: string) => string;
  fonts?: PrintFont[];
  mode: TemplateRendererMode;
  /** Defaults to the side's `background.print`; always shown in editor and preview (D8/D37). */
  showBackground?: boolean;
  /** Copy number of this card; the `print.copyLabel` field is empty on copy 1 (D23). */
  copy?: number;
  onOverflow?: (elementId: string, overflowed: boolean) => void;
  selectedId?: string;
  /** Editor only. */
  onSelect?: (id: string) => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when some TEXT element shows `print.copyLabel`, as its field or as a `{{placeholder}}`. */
const placesCopyLabel = (def: TemplateDefinition) =>
  [def.front, def.back].some((s) =>
    s?.elements.some(
      (el) =>
        el.type === 'TEXT' &&
        (el.field === 'print.copyLabel' ||
          textPlaceholders(el.text ?? '').includes('print.copyLabel')),
    ),
  );

const fontFaces = (fonts: PrintFont[]) =>
  fonts
    .map(
      (f) =>
        `@font-face{font-family:"${f.family.replace(/["\\]/g, '')}";src:url("${encodeURI(f.url).replace(/["()\\]/g, encodeURIComponent)}");` +
        `font-weight:400 700;font-display:block;` +
        `${f.unicodeRange ? `unicode-range:${f.unicodeRange};` : ''}}`,
    )
    .join('');

export function TemplateRenderer({
  definition,
  side,
  values,
  assetUrl,
  fonts = [],
  mode,
  showBackground,
  copy = 1,
  onOverflow,
  selectedId,
  onSelect,
}: TemplateRendererProps) {
  const { i18n } = useTranslation();
  const numerals = i18n.language?.startsWith('bn') ? 'bengali' : 'latin';
  const sideDef = definition[side];
  if (!sideDef) return null;

  const { widthMm, heightMm } = definition.page;
  const bg = sideDef.background;
  const drawBackground = bg && (mode !== 'print' || (showBackground ?? bg.print));
  const decorate = mode !== 'print';

  const valueFor = (field: string): string => {
    if (field === 'print.copyLabel') {
      if (copy <= 1) return '';
      // D44: a template without its own label (or a blank one) shows the one the server chose.
      const own = definition.copyLabel?.text?.trim();
      if (!own) return values['print.copyLabel'] ?? '';
      // The label's own script picks the digits: "কপি ২", but "Copy 2".
      const digits = /[\u0980-\u09FF]/.test(own) ? 'bengali' : 'latin';
      return own.replaceAll('{n}', renderDigits(String(copy), digits));
    }
    const v = values[field] ?? '';
    return ISO_DATE.test(v) ? renderDigits(v, numerals) : v;
  };

  const textFor = (field: string | undefined, literal: string | undefined): string => {
    if (field !== undefined) return valueFor(field);
    const keys = textPlaceholders(literal ?? '');
    // A sentence whose every {{field}} is blank (e.g. no public exam yet) prints nothing,
    // not a sentence full of gaps. The editor keeps showing it so it can still be edited.
    if (mode !== 'editor' && keys.length > 0 && keys.every((k) => valueFor(k) === '')) return '';
    return fillPlaceholders(literal ?? '', valueFor);
  };

  // D8: a serial copy after the first must say DUPLICATE even if the template never placed the
  // label. Serial documents are the ones with `print.serial_no`; the text is the server's label.
  const stamp =
    side === 'front' &&
    copy > 1 &&
    !!values['print.serial_no'] &&
    !placesCopyLabel(definition) &&
    valueFor('print.copyLabel');

  return (
    <div
      data-mode={mode}
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
      }}
    >
      {fonts.length > 0 && <style>{fontFaces(fonts)}</style>}
      {drawBackground && (
        <img
          src={assetUrl(bg.assetId)}
          alt=""
          data-testid="template-background"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            objectFit: 'fill',
          }}
        />
      )}
      {sideDef.elements.map((el) => {
        const selected = mode === 'editor' && el.id === selectedId;
        return (
          // Pointer hit-target on the editor canvas only; keyboard selection lives in the editor's element list.
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <div
            key={el.id}
            data-element-id={el.id}
            onClick={mode === 'editor' && onSelect ? () => onSelect(el.id) : undefined}
            style={{
              position: 'absolute',
              left: `${el.x}mm`,
              top: `${el.y}mm`,
              width: `${el.w}mm`,
              height: `${el.h}mm`,
              outline: selected ? '0.3mm solid var(--color-ring)' : undefined,
            }}
          >
            {el.type === 'TEXT' && (
              <TextElement
                el={el}
                text={textFor(el.field, el.text)}
                showOverflow={decorate}
                onOverflow={onOverflow}
              />
            )}
            {el.type === 'IMAGE' && (
              <ImageElement
                el={el}
                src={el.assetId ? assetUrl(el.assetId) : (values[el.field ?? ''] ?? '')}
              />
            )}
            {el.type === 'QR' && <QrElement value={values['print.verify_qr'] ?? ''} />}
            {el.type === 'SHAPE' && <ShapeElement el={el} />}
          </div>
        );
      })}
      {stamp && (
        <div
          data-testid="duplicate-stamp"
          style={{
            position: 'absolute',
            top: '4mm',
            right: '4mm',
            padding: '1mm 2mm',
            border: '0.4mm solid #b91c1c',
            color: '#b91c1c',
            fontSize: '10pt',
            fontWeight: 700,
            background: '#ffffff',
          }}
        >
          {stamp}
        </div>
      )}
    </div>
  );
}
