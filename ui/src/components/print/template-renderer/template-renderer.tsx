/**
 * One template side at true physical size: the root is `{w}mm x {h}mm`,
 * elements are positioned in mm and text is sized in pt. No px anywhere, so
 * the editor canvas, the preview and the print tab all show what prints.
 */
import type { TemplateDefinition } from '@biddaloy/shared';
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

  const textFor = (field: string | undefined, literal: string | undefined): string => {
    if (field === undefined) return literal ?? '';
    if (field === 'print.copyLabel') {
      return copy > 1 ? (definition.copyLabel?.text ?? '').replace('{n}', String(copy)) : '';
    }
    const v = values[field] ?? '';
    return ISO_DATE.test(v) ? renderDigits(v, numerals) : v;
  };

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
    </div>
  );
}
