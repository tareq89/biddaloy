/**
 * All copy comes from the `common` namespace (`fileUpload.*`), so it follows
 * the active locale. A polite live region announces selection count, per-file progress and
 * per-file errors — the three states the issue calls out. Progress and
 * errors are per-`FileUploadItem`, driven by the caller (the actual
 * upload happens outside this component, in whatever hook/mutation the
 * consuming SPA wires up); this owns presentation and announcement, not
 * the upload itself.
 */
import { UploadIcon, XIcon } from 'lucide-react';
import * as React from 'react';

import { useRegionConfig, useTranslation } from '../i18n';
import { formatNumber } from '../utils/number';

import { Button } from './button';

export interface FileUploadItem {
  /** Caller-generated (e.g. `crypto.randomUUID()`), not derived from the
   * `File` — `name`/`lastModified`/`size` can genuinely collide (two
   * copies of the same file, two files a batch process stamped with the
   * same mtime), so nothing about the file itself is a safe React key. */
  id: string;
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
  /** Blocks choosing and removing files. Use while an upload is in flight:
   * a replacement pick cannot cancel the request already on the wire, so
   * without this a second submission can duplicate the first one's work. */
  disabled?: boolean;
}

export function FileUpload({
  items,
  onFilesSelected,
  onRemove,
  accept,
  multiple = true,
  chooseLabel,
  disabled = false,
  ...props
}: FileUploadProps) {
  const { t } = useTranslation('common');
  const config = useRegionConfig();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = React.useState('');

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    onFilesSelected(files);
    setAnnouncement(t('fileUpload.selected', { count: files.length }));
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
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files);
          // Reset so selecting the exact same file again still fires
          // `onChange` — the browser only fires it on a *change*, and an
          // unreset input's value already equals what a repeat pick would
          // set it to.
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        className="w-full md:w-auto"
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon aria-hidden="true" />
        {chooseLabel ?? (multiple ? t('fileUpload.chooseFiles') : t('fileUpload.chooseFile'))}
      </Button>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {items.length > 0 && (
        <ul className="mt-2 divide-y divide-border-subtle">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-1">
              <span className="flex-1 truncate">{item.file.name}</span>
              {item.error ? (
                <span role="alert" className="text-caption text-destructive">
                  {item.error}
                </span>
              ) : item.progress !== undefined && item.progress < 100 ? (
                <span aria-live="polite">{formatNumber(item.progress, config)}%</span>
              ) : (
                <span className="text-text-secondary">{t('fileUpload.done')}</span>
              )}
              {onRemove && (
                <Button
                  type="button"
                  iconOnly
                  aria-label={t('fileUpload.remove', { name: item.file.name })}
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  onClick={() => onRemove(item.file)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
