import { ATTACHMENT_LIMITS } from '@biddaloy/shared';
import { Card, FileUpload } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const MB = ATTACHMENT_LIMITS.maxBytes / (1024 * 1024);

/** Files stay in memory until submit; anything outside the limits is refused here, before any request. */
export function AttachmentsStep({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const { t } = useTranslation('applicationsNew');
  const [problems, setProblems] = React.useState<string[]>([]);
  // `FileUpload` keys rows by a caller id; a file object is unique enough per pick here.
  const ids = React.useRef(new WeakMap<File, string>());
  const idOf = (file: File) => {
    let id = ids.current.get(file);
    if (!id) {
      id = crypto.randomUUID();
      ids.current.set(file, id);
    }
    return id;
  };

  function add(picked: File[]) {
    const next = [...files];
    const found: string[] = [];
    for (const file of picked) {
      if (!(ATTACHMENT_LIMITS.mime as readonly string[]).includes(file.type)) {
        found.push(t('attachments.wrongType', { name: file.name }));
      } else if (file.size > ATTACHMENT_LIMITS.maxBytes) {
        found.push(t('attachments.tooLarge', { size: MB, name: file.name }));
      } else if (next.length >= ATTACHMENT_LIMITS.maxFiles) {
        found.push(t('attachments.tooMany', { count: ATTACHMENT_LIMITS.maxFiles }));
        break;
      } else {
        next.push(file);
      }
    }
    setProblems(found);
    onChange(next);
  }

  return (
    <Card padded className="flex flex-col gap-3">
      <p className="text-text-secondary">
        {t('attachments.hint', { count: ATTACHMENT_LIMITS.maxFiles, size: MB })}
      </p>
      <FileUpload
        aria-label={t('attachments.label')}
        accept={ATTACHMENT_LIMITS.mime.join(',')}
        items={files.map((file) => ({ id: idOf(file), file }))}
        onFilesSelected={add}
        onRemove={(file) => {
          setProblems([]);
          onChange(files.filter((f) => f !== file));
        }}
      />
      {problems.length > 0 && (
        <ul role="alert" className="text-caption text-destructive">
          {[...new Set(problems)].map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
