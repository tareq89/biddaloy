/**
 * [32.3.8] Bulk student photo upload (D43, D57). Photos are matched to students
 * by the registration number in the file name (`2024-0153.jpg`). The hook sends
 * them in chunks of 25, one request at a time; this dialog picks the files,
 * shows progress, and then reports what matched, what didn't and what couldn't
 * be read, so 500 photos end in a clear list instead of a silent "done".
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ProgressBar,
  toast,
} from '@biddaloy/ui/components';
import { useBulkUploadStudentPhotos, type BulkStudentPhotoResult } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

type ReportTab = 'matched' | 'unmatched' | 'invalid';
const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;

export interface BulkPhotoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BulkPhotoDialog({ open, onOpenChange }: BulkPhotoDialogProps) {
  const { t } = useTranslation('students');
  const upload = useBulkUploadStudentPhotos();
  const photosInput = React.useRef<HTMLInputElement>(null);
  const folderInput = React.useRef<HTMLInputElement>(null);

  const [files, setFiles] = React.useState<File[]>([]);
  const [percent, setPercent] = React.useState(0);
  const [result, setResult] = React.useState<BulkStudentPhotoResult | undefined>(undefined);
  const [tab, setTab] = React.useState<ReportTab>('matched');

  function reset() {
    setFiles([]);
    setPercent(0);
    setResult(undefined);
    setTab('matched');
    upload.reset();
  }

  function handleOpenChange(next: boolean) {
    if (upload.isPending) return; // don't abandon a run half-way
    if (!next) reset();
    onOpenChange(next);
  }

  function handlePicked(list: FileList | null) {
    // A folder pick can contain anything; keep only images.
    setFiles(Array.from(list ?? []).filter((file) => IMAGE_FILE.test(file.name)));
    setResult(undefined);
  }

  function handleUpload() {
    setPercent(0);
    upload.mutate({ files, onProgress: setPercent }, { onSuccess: (report) => setResult(report) });
  }

  const rows: Record<ReportTab, string[]> = {
    matched: (result?.matched ?? []).map((m) =>
      t('bulkPhotos.matchedRow', { file: m.file, name: m.full_name }),
    ),
    unmatched: result?.unmatched ?? [],
    invalid: (result?.invalid ?? []).map((i) =>
      t('bulkPhotos.invalidRow', { file: i.file, reason: i.reason }),
    ),
  };

  async function copyList() {
    try {
      await navigator.clipboard.writeText(rows[tab].join('\n'));
      toast.success(t('bulkPhotos.copied'));
    } catch {
      // Clipboard can be blocked; the list is still on screen to select by hand.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('bulkPhotos.title')}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{t('bulkPhotos.explainer')}</p>

        {/* Hidden inputs; the buttons below open them. `webkitdirectory` picks a whole folder. */}
        <input
          ref={photosInput}
          type="file"
          multiple
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="photos-input"
          onChange={(e) => handlePicked(e.target.files)}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="folder-input"
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => handlePicked(e.target.files)}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={upload.isPending}
            onClick={() => photosInput.current?.click()}
          >
            {t('bulkPhotos.choosePhotos')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={upload.isPending}
            onClick={() => folderInput.current?.click()}
          >
            {t('bulkPhotos.chooseFolder')}
          </Button>
        </div>

        {files.length > 0 && !result ? (
          <p role="status" className="text-sm">
            {t('bulkPhotos.selected', { count: files.length })}
          </p>
        ) : null}

        {upload.isPending ? (
          <ProgressBar done={percent} total={100} label={t('bulkPhotos.progress', { percent })} />
        ) : null}

        {upload.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t('bulkPhotos.failed')}
          </p>
        ) : null}

        {result ? (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm font-medium">
              {t('bulkPhotos.done')}
            </p>
            <div role="group" aria-label={t('bulkPhotos.title')} className="flex flex-wrap gap-2">
              {(['matched', 'unmatched', 'invalid'] as const).map((key) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={tab === key ? 'default' : 'outline'}
                  aria-pressed={tab === key}
                  onClick={() => setTab(key)}
                >
                  {t(`bulkPhotos.tabs.${key}`, { count: rows[key].length })}
                </Button>
              ))}
            </div>
            {rows[tab].length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('bulkPhotos.noneInTab')}</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto rounded-md border border-border-subtle p-2 text-sm">
                {rows[tab].map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            )}
            {rows[tab].length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => void copyList()}
              >
                {t('bulkPhotos.copyList')}
              </Button>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={upload.isPending}
            onClick={() => handleOpenChange(false)}
          >
            {t('bulkPhotos.close')}
          </Button>
          {!result ? (
            <Button
              type="button"
              disabled={files.length === 0}
              loading={upload.isPending}
              onClick={handleUpload}
            >
              {t('bulkPhotos.start', { count: files.length })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
