import { toString as qrToString } from 'qrcode';
import * as React from 'react';

const cache = new Map<string, Promise<string>>();

function qrSvg(value: string): Promise<string> {
  let hit = cache.get(value);
  if (!hit) {
    hit = qrToString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then((svg) =>
      // Drop fixed sizing so the SVG scales to the element box.
      svg.replace('<svg ', '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" '),
    );
    cache.set(value, hit);
  }
  return hit;
}

export function QrElement({ value }: { value: string }) {
  const [svg, setSvg] = React.useState('');
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
