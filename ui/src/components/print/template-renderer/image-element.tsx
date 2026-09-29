import { ImageFit, type PrintElement } from '@biddaloy/shared';

type ImageEl = Extract<PrintElement, { type: 'IMAGE' }>;

export function ImageElement({ el, src }: { el: ImageEl; src: string }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        objectFit: el.fit === ImageFit.COVER ? 'cover' : 'contain',
        objectPosition: `center ${el.alignY}`,
      }}
    />
  );
}
