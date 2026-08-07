/**
 * A polite live region announces selection count, per-file progress and
 * per-file errors — the three states the issue calls out. Progress and
 * errors are per-`FileUploadItem`, driven by the caller (the actual
 * upload happens outside this component, in whatever hook/mutation the
 * consuming SPA wires up); this owns presentation and announcement, not
 * the upload itself.
 */
import * as React from 'react';

import { Button } from './button';

export interface FileUploadItem {
  file: File;
  /** 0-100. `undefined` means not yet started; `100` means done. */
  progress?: number;
  error?: string;
}

export interface FileUploadProps {
  items: FileUploadItem[];
  onFilesSelected: (files: File[]) => void;
  onRemove?: (file: File) => void;
  accept?: string;
  multiple?: boolean;
  'aria-label': string;
  chooseLabel?: string;
}

export function FileUpload({
  items,
  onFilesSelected,
  onRemove,
  accept,
  multiple = true,
  chooseLabel,
  ...props
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = React.useState('');

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    onFilesSelected(files);
    setAnnouncement(`${files.length} file${files.length === 1 ? '' : 's'} selected`);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        aria-label={props['aria-label']}
        onChange={(event) => {
          handleFiles(event.target.files);
          // Reset so selecting the exact same file again still fires
          // `onChange` — the browser only fires it on a *change*, and an
          // unreset input's value already equals what a repeat pick would
          // set it to.
          event.target.value = '';
        }}
      />
      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
        {chooseLabel ?? (multiple ? 'Choose files' : 'Choose file')}
      </Button>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            // `name` alone isn't unique — two picked files can share a
            // filename (e.g. "photo.jpg" from two different folders).
            // `lastModified`+`size` disambiguates without requiring
            // `FileUploadItem` to carry a caller-generated id.
            <li
              key={`${item.file.name}-${item.file.lastModified}-${item.file.size}`}
              className="flex items-center gap-2 text-sm"
            >
              <span className="flex-1 truncate">{item.file.name}</span>
              {item.error ? (
                <span role="alert" className="text-destructive">
                  {item.error}
                </span>
              ) : item.progress !== undefined && item.progress < 100 ? (
                <span aria-live="polite">{item.progress}%</span>
              ) : (
                <span className="text-muted-foreground">Done</span>
              )}
              {onRemove && (
                <Button
                  type="button"
                  iconOnly
                  aria-label={`Remove ${item.file.name}`}
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onRemove(item.file)}
                >
                  <span aria-hidden="true">×</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
