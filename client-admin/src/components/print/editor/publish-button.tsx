/**
 * [32.3.2] Publish a new immutable version (D17, D36). Disabled while the draft is
 * still saving or has errors (which are listed), and always behind a confirm that
 * says what publishing means. After the first publish for a document type it offers
 * to make the template the default, since printing needs one.
 */
import {
  validateTemplateDefinition,
  type DocumentKind,
  type TemplateDefinition,
} from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@biddaloy/ui/components';
import {
  usePrintTemplates,
  usePrintTemplateVersions,
  usePublishPrintTemplate,
  useSetDefaultPrintTemplate,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import type { AutosaveStatus } from './use-draft-autosave';

export interface PublishButtonProps {
  templateId: string;
  kind: DocumentKind;
  draft: TemplateDefinition;
  saveStatus: AutosaveStatus;
}

export function PublishButton({ templateId, kind, draft, saveStatus }: PublishButtonProps) {
  const { t } = useTranslation('printEditor');
  const versions = usePrintTemplateVersions(templateId);
  const templates = usePrintTemplates(kind);
  const publish = usePublishPrintTemplate(templateId);
  const makeDefault = useSetDefaultPrintTemplate(templateId);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [offerDefault, setOfferDefault] = React.useState(false);

  const next = Math.max(0, ...(versions.data ?? []).map((v) => v.version)) + 1;
  const validation = validateTemplateDefinition(draft, kind);
  const problems = validation.success ? [] : validation.errors;
  const blocked = saveStatus !== 'saved' || problems.length > 0;

  function handlePublish() {
    publish.mutate(undefined, {
      onSuccess: (version) => {
        setConfirmOpen(false);
        toast.success(t('publish.done', { n: version.version }));
        // Printing needs a default for the type: offer it if none exists yet.
        const hasDefault = (templates.data ?? []).some(
          (x) => x.is_default && x.archived_at === null,
        );
        if (!hasDefault) setOfferDefault(true);
      },
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" disabled={blocked} onClick={() => setConfirmOpen(true)}>
        {t('publish.button', { n: next })}
      </Button>
      {saveStatus !== 'saved' && problems.length === 0 ? (
        <span className="text-xs text-muted-foreground">{t('publish.saving')}</span>
      ) : null}
      {problems.length > 0 ? (
        <details className="max-w-xs text-xs">
          <summary className="cursor-pointer text-destructive">{t('publish.problems')}</summary>
          <ul role="alert" className="list-disc ps-4">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => !publish.isPending && setConfirmOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('publish.confirmTitle', { n: next })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{t('publish.confirmBody')}</p>
          {publish.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {t('publish.failed')}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('publish.cancel')}
            </Button>
            <Button type="button" loading={publish.isPending} onClick={handlePublish}>
              {t('publish.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={offerDefault} onOpenChange={setOfferDefault}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('publish.makeDefaultTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{t('publish.makeDefaultBody')}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOfferDefault(false)}>
              {t('publish.notNow')}
            </Button>
            <Button
              type="button"
              loading={makeDefault.isPending}
              onClick={() =>
                makeDefault.mutate(undefined, { onSuccess: () => setOfferDefault(false) })
              }
            >
              {t('publish.makeDefault')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
