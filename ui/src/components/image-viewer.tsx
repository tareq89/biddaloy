/**
 * [3.1.04] Proof-file viewer: image thumbnails that open in a large Dialog
 * (fit-to-width, zoom toggle, arrow keys move between files), PDFs as a plain
 * link. Focus trap and Esc are Radix's (see `dialog.tsx`); focus is returned
 * to the thumbnail by hand because the dialog has no `DialogTrigger`.
 * Strings come in as props: the `common` locale files are not this ticket's.
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { Button } from './button';
import { Dialog, DialogContent, DialogTitle, VisuallyHidden } from './dialog';

export type ImageViewerFile = { url: string; contentType: string; label: string };

export type ImageViewerProps = {
  files: ImageViewerFile[];
  labels: {
    openFile: string;
    zoomIn: string;
    zoomOut: string;
    previous: string;
    next: string;
  };
  className?: string;
};

const isImage = (f: ImageViewerFile) => f.contentType.startsWith('image/');

export function ImageViewer({ files, labels, className }: ImageViewerProps) {
  const images = files.filter(isImage);
  const [index, setIndex] = React.useState<number | null>(null);
  const [zoomed, setZoomed] = React.useState(false);
  const opener = React.useRef<HTMLElement | null>(null);
  const current = index === null ? null : images[index];

  const go = (i: number) => {
    setIndex(i);
    setZoomed(false);
  };

  return (
    <div className={cn('flex flex-wrap gap-3 max-sm:flex-col', className)}>
      {files.map((f) =>
        isImage(f) ? (
          <button
            key={f.url}
            type="button"
            aria-label={f.label}
            className="overflow-hidden rounded-md border border-border-subtle max-sm:w-full"
            onClick={(e) => {
              opener.current = e.currentTarget;
              go(images.indexOf(f));
            }}
          >
            <img src={f.url} alt="" className="h-24 w-full object-cover sm:w-32" />
          </button>
        ) : (
          <a
            key={f.url}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-body text-text-primary underline"
          >
            {labels.openFile}: {f.label}
          </a>
        ),
      )}
      <Dialog open={current != null} onOpenChange={(o) => !o && setIndex(null)}>
        <DialogContent
          size="lg"
          fullScreenOnPhone
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            opener.current?.focus();
          }}
          onKeyDown={(e) => {
            if (index === null) return;
            const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (delta && images[index + delta]) go(index + delta);
          }}
        >
          <VisuallyHidden.Root asChild>
            <DialogTitle>{current?.label}</DialogTitle>
          </VisuallyHidden.Root>
          {current && (
            <div className="min-h-0 flex-1 overflow-auto">
              <img
                src={current.url}
                alt={current.label}
                className={zoomed ? 'max-w-none' : 'w-full'}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" disabled={index === 0} onClick={() => go(index! - 1)}>
              {labels.previous}
            </Button>
            <Button variant="outline" onClick={() => setZoomed((z) => !z)}>
              {zoomed ? labels.zoomOut : labels.zoomIn}
            </Button>
            <Button
              variant="outline"
              disabled={index === images.length - 1}
              onClick={() => go(index! + 1)}
            >
              {labels.next}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
