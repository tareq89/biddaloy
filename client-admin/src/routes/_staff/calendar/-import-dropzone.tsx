/**
 * [17.5.3] / [31.4] Step 1 of the import wizard: template download + file
 * picker. Wraps the shared `FileUpload` presentational component (no new
 * dropzone primitive) and enforces the type and 2 MB cap client-side. It
 * only reports the chosen file up (`undefined` for a rejected one) — the
 * page's "Check file" button does the upload, so a wrong pick fires no request.
 */
import { Button, Card, FileUpload, type FileUploadItem } from '@biddaloy/ui/components';
import { downloadCalendarImportTemplate } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { DownloadIcon } from 'lucide-react';
import * as React from 'react';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.xlsx', '.csv'];

export interface ImportDropzoneProps {
  onFileChange: (file: File | undefined) => void;
  disabled?: boolean;
  error?: string;
}

export function ImportDropzone({ onFileChange, disabled = false, error }: ImportDropzoneProps) {
  const { t } = useTranslation('calendarImport');
  const [items, setItems] = React.useState<FileUploadItem[]>([]);

  function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;

    const isAcceptedType = ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!isAcceptedType) {
      setItems([{ id: crypto.randomUUID(), file, error: t('step1.fileWrongType') }]);
      onFileChange(undefined);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setItems([{ id: crypto.randomUUID(), file, error: t('step1.fileTooLarge') }]);
      onFileChange(undefined);
      return;
    }

    setItems([{ id: crypto.randomUUID(), file }]);
    onFileChange(file);
  }

  const displayItems: FileUploadItem[] = error && items[0] ? [{ ...items[0], error }] : items;

  return (
    <Card className="p-4 md:p-5">
      <p className="text-text-secondary">{t('step1.description')}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-3"
        onClick={() => void downloadCalendarImportTemplate('xlsx')}
      >
        <DownloadIcon aria-hidden="true" />
        {t('step1.downloadTemplate')}
      </Button>

      <div className="mt-4">
        <FileUpload
          items={displayItems}
          onFilesSelected={handleFilesSelected}
          onRemove={() => {
            setItems([]);
            onFileChange(undefined);
          }}
          accept=".xlsx,.csv"
          multiple={false}
          aria-label={t('step1.chooseFile')}
          chooseLabel={t('step1.chooseFile')}
          disabled={disabled}
        />
      </div>
    </Card>
  );
}
