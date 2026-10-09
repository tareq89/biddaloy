/**
 * [22.4.2] Shared attachment picker for homework: teacher assignment
 * material (a sibling lane's assign-form) and student submission upload
 * (another sibling lane's portal upload) both consume this. Deliberately
 * not coupled to either use site — it only picks files, validates them
 * client-side, and hands the caller a `File[]`; the caller owns the
 * actual `StorageService` upload call and its own success/error wiring.
 *
 * D27: 10 files max, 5MB each, PDF/jpg/png/webp only. This is UX only —
 * the server re-validates and remains authoritative (do not treat a pass
 * here as a substitute for server-side checks).
 *
 * Adds drag-and-drop on top of `@biddaloy/ui`'s `FileUpload`, which only
 * offers a hidden-input + button picker — a native `dragover`/`drop`
 * listener is the smallest way to add it, no new dependency.
 */
import { Button, FileUpload, type FileUploadItem } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const ACCEPTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

/** D23's jsonb attachment shape — an already-uploaded file, not a `File`. */
export interface ExistingAttachment {
  storage_key: string;
  filename: string;
  size: number;
}

export interface FileUploadWidgetProps {
  /** Attachments already saved server-side (e.g. editing an existing
   * homework/submission). Counted against the 10-file cap. */
  existingFiles?: ExistingAttachment[];
  /** Called with the full set of currently-valid, newly-picked files
   * whenever the selection changes. Does not include `existingFiles` —
   * those are already uploaded, not `File` objects. */
  onFilesSelected: (files: File[]) => void;
  /** Removes one already-uploaded attachment. Omit to make existing
   * attachments read-only (e.g. a closed submission). */
  onRemoveExisting?: (file: ExistingAttachment) => void;
  disabled?: boolean;
}

function isAcceptedType(file: File): boolean {
  if (ACCEPTED_MIME_TYPES.includes(file.type)) return true;
  // Some browsers/OSes leave `file.type` empty for certain uploads — fall
  // back to the extension so a valid file isn't rejected on a technicality.
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function FileUploadWidget({
  existingFiles = [],
  onFilesSelected,
  onRemoveExisting,
  disabled = false,
}: FileUploadWidgetProps) {
  const { t } = useTranslation('homework');
  const [items, setItems] = React.useState<FileUploadItem[]>([]);
  const [dragActive, setDragActive] = React.useState(false);

  function handleFiles(fileList: File[]) {
    if (fileList.length === 0) return;

    const validCount = items.filter((item) => !item.error).length;
    let remainingSlots = Math.max(0, MAX_FILES - existingFiles.length - validCount);
    const nextItems: FileUploadItem[] = [];

    fileList.forEach((file) => {
      let error: string | undefined;
      if (!isAcceptedType(file)) {
        error = t('upload.wrongType');
      } else if (file.size > MAX_FILE_BYTES) {
        error = t('upload.tooLarge');
      } else if (remainingSlots <= 0) {
        error = t('upload.tooMany', { maxFiles: MAX_FILES });
      } else {
        remainingSlots -= 1;
      }
      nextItems.push(
        error !== undefined
          ? { id: crypto.randomUUID(), file, error }
          : { id: crypto.randomUUID(), file },
      );
    });

    const combined = [...items, ...nextItems];
    setItems(combined);
    onFilesSelected(combined.filter((item) => !item.error).map((item) => item.file));
  }

  function handleRemove(file: File) {
    const combined = items.filter((item) => item.file !== file);
    setItems(combined);
    onFilesSelected(combined.filter((item) => !item.error).map((item) => item.file));
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (disabled) return;
    handleFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      data-drag-active={dragActive || undefined}
      className="rounded-lg border border-dashed border-border-subtle p-4 data-[drag-active]:border-primary data-[drag-active]:bg-accent"
    >
      <p className="mb-2 text-sm text-muted-foreground">
        {t('upload.dropHint', { maxFiles: MAX_FILES })}
      </p>

      {existingFiles.length > 0 && (
        <ul className="mb-2 space-y-1">
          {existingFiles.map((file) => (
            <li key={file.storage_key} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{file.filename}</span>
              {onRemoveExisting && (
                <Button
                  type="button"
                  iconOnly
                  aria-label={t('upload.removeFile', { filename: file.filename })}
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  onClick={() => onRemoveExisting(file)}
                >
                  <span aria-hidden="true">×</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <FileUpload
        items={items}
        onFilesSelected={handleFiles}
        onRemove={handleRemove}
        accept={ACCEPT_ATTR}
        multiple
        aria-label={t('upload.chooseFilesLabel')}
        chooseLabel={t('upload.chooseFiles')}
        disabled={disabled}
      />
    </div>
  );
}
