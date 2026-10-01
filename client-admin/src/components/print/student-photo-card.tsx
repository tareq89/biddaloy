/**
 * [32.3.8] A student's photo, with an upload / replace control (D15, D48).
 * 32.4.2 mounts it in the student's Documents tab.
 *
 * The photo route needs the bearer token, so it can't go in a bare `<img src>`:
 * `studentPhotoUrl` fetches it through `apiClient` as an object URL, which this
 * component owns and revokes. A student with no photo gets an initials
 * placeholder (and no request at all).
 */
import { Card, FileUpload } from '@biddaloy/ui/components';
import { studentPhotoUrl, useStudent, useUploadStudentPhoto } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
/** The server accepts up to 8 MB and resizes; refuse anything larger before sending it. */
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export interface StudentPhotoCardProps {
  studentId: string;
  /** Upload / replace is shown only to people who may edit the student. */
  canEdit: boolean;
}

function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toUpperCase();
}

export function StudentPhotoCard({ studentId, canEdit }: StudentPhotoCardProps) {
  const { t } = useTranslation('students');
  const studentQuery = useStudent(studentId);
  const upload = useUploadStudentPhoto(studentId);
  const [rejected, setRejected] = React.useState(false);

  const student = studentQuery.data;
  const photoKey = student?.photo_key ?? null;

  // Keyed by the photo key, so a replaced photo is fetched again. `gcTime: 0`
  // because the cached value is an object URL we revoke on unmount.
  const photoQuery = useQuery({
    queryKey: ['student-photo', studentId, photoKey],
    queryFn: () => studentPhotoUrl(studentId),
    enabled: photoKey !== null,
    staleTime: Infinity,
    gcTime: 0,
  });

  const url = photoQuery.data;
  React.useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (file.size > PHOTO_MAX_BYTES) {
      setRejected(true);
      return;
    }
    setRejected(false);
    upload.mutate(file);
  }

  const name = student?.full_name ?? '';

  return (
    <Card className="flex items-start gap-4 p-4">
      {url ? (
        <img
          src={url}
          alt={t('photo.alt', { name })}
          className="size-24 shrink-0 rounded-md object-cover object-top"
        />
      ) : (
        <div
          data-slot="photo-placeholder"
          aria-hidden="true"
          className="flex size-24 shrink-0 items-center justify-center rounded-md bg-muted text-2xl font-semibold text-muted-foreground"
        >
          {initialsOf(name)}
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm font-semibold">{t('photo.title')}</h3>
        {canEdit ? (
          <>
            <FileUpload
              items={[]}
              onFilesSelected={handleFilesSelected}
              accept={PHOTO_ACCEPT}
              multiple={false}
              disabled={upload.isPending}
              aria-label={photoKey ? t('photo.replace') : t('photo.upload')}
              chooseLabel={photoKey ? t('photo.replace') : t('photo.upload')}
            />
            <p className="text-xs text-muted-foreground">{t('photo.help')}</p>
          </>
        ) : null}
        {upload.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t('photo.uploading')}
          </p>
        ) : null}
        {upload.isError || rejected ? (
          <p role="alert" className="text-xs text-destructive">
            {t('photo.uploadFailed')}
          </p>
        ) : null}
        {photoQuery.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {t('photo.loadFailed')}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
