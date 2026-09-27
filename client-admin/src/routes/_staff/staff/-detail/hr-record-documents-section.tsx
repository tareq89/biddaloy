/**
 * [23.11] Real documents section — a fixed slot per `StaffDocumentType`
 * (NID, birth certificate, photo, other), each showing the current file
 * (if any) with a download link, and an upload/replace control. There's
 * no delete endpoint on the server ([23.6] only ever upserts on the
 * tenant/staff/type unique index), so "replace" is just "upload again" —
 * no separate remove action needed.
 *
 * Reuses `FileUpload` (Epic 22's `ui/src/components/file-upload.tsx`) for
 * the picker + per-file progress/error UI rather than building a new
 * upload widget, per this ticket's acceptance criterion.
 */
import { Button, FileUpload, type FileUploadItem } from '@biddaloy/ui/components';
import {
  downloadStaffDocument,
  useStaffDocuments,
  useUploadStaffDocument,
  type StaffDocument,
  type StaffDocumentType,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface HrRecordDocumentsSectionProps {
  userId: string;
}

const DOCUMENT_TYPES: StaffDocumentType[] = ['NID', 'BIRTH_CERTIFICATE', 'PHOTO', 'OTHER'];

function DocumentSlot({
  userId,
  documentType,
  document,
}: {
  userId: string;
  documentType: StaffDocumentType;
  document: StaffDocument | undefined;
}) {
  const { t } = useTranslation('staff');
  const upload = useUploadStaffDocument(userId);
  const [item, setItem] = React.useState<FileUploadItem | null>(null);

  function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;
    const nextItem: FileUploadItem = { id: crypto.randomUUID(), file, progress: 0 };
    setItem(nextItem);
    upload.mutate(
      {
        documentType,
        file,
        onProgress: (percent) =>
          setItem((current) => (current ? { ...current, progress: percent } : current)),
      },
      {
        onSuccess: () => setItem((current) => (current ? { ...current, progress: 100 } : current)),
        onError: () =>
          setItem((current) =>
            current ? { ...current, error: t('hrRecord.documents.uploadError') } : current,
          ),
      },
    );
  }

  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t(`hrRecord.documents.types.${documentType}`)}</span>
        {document ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void downloadStaffDocument(document)}
          >
            {document.original_filename}
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">
            {t('hrRecord.documents.notUploaded')}
          </span>
        )}
      </div>
      <div className="mt-2">
        <FileUpload
          items={item ? [item] : []}
          onFilesSelected={handleFilesSelected}
          multiple={false}
          disabled={upload.isPending}
          aria-label={t(`hrRecord.documents.types.${documentType}`)}
          chooseLabel={
            document ? t('hrRecord.documents.replaceAction') : t('hrRecord.documents.uploadAction')
          }
        />
      </div>
    </div>
  );
}

export function HrRecordDocumentsSection({ userId }: HrRecordDocumentsSectionProps) {
  const documentsQuery = useStaffDocuments(userId);
  const documents = documentsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      {DOCUMENT_TYPES.map((documentType) => (
        <DocumentSlot
          key={documentType}
          userId={userId}
          documentType={documentType}
          document={documents.find((doc) => doc.document_type === documentType)}
        />
      ))}
    </div>
  );
}
