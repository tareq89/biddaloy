import { toString as qrToString } from 'qrcode';
import * as React from 'react';

const cache = new Map<string, Promise<string>>();
// Settled svgs, readable synchronously (static markup runs no effects).
const ready = new Map<string, string>();

function qrSvg(value: string): Promise<string> {
  let hit = cache.get(value);
  if (!hit) {
    hit = qrToString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then((svg) =>
      // Drop fixed sizing so the SVG scales to the element box.
      svg.replace('<svg ', '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" '),
    );
    hit.then(
      (svg) => ready.set(value, svg),
      () => undefined,
    );
    cache.set(value, hit);
  }
  return hit;
}

/** Await before `renderToStaticMarkup` so `QrElement` renders its svg on the first pass. */
export async function prepareQr(values: readonly string[]): Promise<void> {
  await Promise.all(
    values.filter(Boolean).map((v) =>
      qrSvg(v).then(
        () => undefined,
        () => undefined,
      ),
    ),
  );
}

export function QrElement({ value }: { value: string }) {
  const [svg, setSvg] = React.useState(() => ready.get(value) ?? '');
  React.useEffect(() => {
    let live = true;
    if (!value) {
      setSvg('');
      return;
    }
    qrSvg(value).then(
      (s) => live && setSvg(s),
      () => live && setSvg(''),
    );
    return () => {
      live = false;
    };
  }, [value]);
  if (!svg) return null;
  return (
    <div
      role="img"
      aria-label="QR code"
      style={{ width: '100%', height: '100%' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
