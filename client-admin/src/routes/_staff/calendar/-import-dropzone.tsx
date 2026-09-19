/**
 * [17.5.3] Step 1 of the import wizard: template download + file picker.
 * Wraps the shared `FileUpload` presentational component (no new dropzone
 * primitive) and enforces the 2 MB cap client-side before it ever reaches
 * `useValidateCalendarImport` — the server would reject an oversized file
 * too, but failing before the upload starts saves the round trip and
 * gives an immediate, specific error.
 */
import { Button, FileUpload, type FileUploadItem } from '@biddaloy/ui/components';
import { downloadCalendarImportTemplate } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.xlsx', '.csv'];

export interface ImportDropzoneProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  error?: string;
}

export function ImportDropzone({ onFileSelected, disabled = false, error }: ImportDropzoneProps) {
  const { t } = useTranslation('calendarImport');
  const [items, setItems] = React.useState<FileUploadItem[]>([]);

  function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;

    const isAcceptedType = ACCEPTED_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext),
    );
    if (!isAcceptedType) {
      setItems([{ id: crypto.randomUUID(), file, error: t('step1.fileWrongType') }]);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setItems([{ id: crypto.randomUUID(), file, error: t('step1.fileTooLarge') }]);
      return;
    }

    setItems([{ id: crypto.randomUUID(), file }]);
    onFileSelected(file);
  }

  const displayItems: FileUploadItem[] = error && items[0] ? [{ ...items[0], error }] : items;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">{t('step1.description')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void downloadCalendarImportTemplate('xlsx')}
        >
          {t('step1.downloadTemplate')}
        </Button>
      </div>

      <FileUpload
        items={displayItems}
        onFilesSelected={handleFilesSelected}
        onRemove={() => setItems([])}
        accept=".xlsx,.csv"
        multiple={false}
        aria-label={t('step1.chooseFile')}
        chooseLabel={t('step1.chooseFile')}
        disabled={disabled}
      />
    </div>
  );
}
