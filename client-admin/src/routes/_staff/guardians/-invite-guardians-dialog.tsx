/**
 * [12.6] Preview-first batch provisioning of guardian accounts —
 * "Invite 287 guardians — 12 skipped: no phone" reusing the reminder-batch
 * UX grammar: preview → confirm → progress. Cloned from
 * `bulk-reminder-wizard.tsx`'s `handlePreview`/`handleSubmit` shape, but
 * scoped down to `WizardShell`'s `select` → `preview` (review) steps plus
 * a `result` screen, since there is no per-row message to compose here.
 *
 * Selection is "every guardian in this school" for now — the guardians
 * list has no row-selection UI wired yet (`selected` is a reserved,
 * currently-unused URL key; see the list route's own comment), so
 * `guardian_ids`/`student_ids` selection is left for a follow-up once
 * that lands. Reported as a deviation from the plan's "current list
 * selection" bullet in this PR's description.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  VisuallyHidden,
} from '@biddaloy/ui/components';
import {
  useDispatchInvitations,
  useInvitationBatch,
  useInvitationPreview,
  type InvitePreviewResult,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { WizardShell } from '@biddaloy/ui/shells';
import * as React from 'react';

export interface InviteGuardiansDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselects the imported cohort's guardians via their students —
   * [12.6]'s bulk-import wizard final step. Omit to invite every
   * guardian in the school. */
  studentIds?: string[];
}

function skipReasonLabel(t: ReturnType<typeof useTranslation>['t'], reason: string): string {
  return t(`invite.skipReason.${reason}`, { defaultValue: reason });
}

export function InviteGuardiansDialog({
  open,
  onOpenChange,
  studentIds,
}: InviteGuardiansDialogProps) {
  const { t } = useTranslation('guardians');
  // Local state, not `useWizardShellStep` — this is a modal dialog, not a
  // full-page route, so the step doesn't need to survive a refresh or
  // round-trip through the URL the way `bulk-reminder-wizard.tsx`'s does.
  const [stepId, setStepId] = React.useState<'select' | 'preview'>('select');
  const [preview, setPreview] = React.useState<InvitePreviewResult | null>(null);
  const [batchId, setBatchId] = React.useState<string | null>(null);

  const selection = studentIds !== undefined ? { student_ids: studentIds } : { all: true };

  const previewMutation = useInvitationPreview();
  const dispatchMutation = useDispatchInvitations();
  const batchQuery = useInvitationBatch(batchId ?? undefined);

  function handleStepChange(id: string) {
    setStepId(id === 'preview' ? 'preview' : 'select');
  }

  React.useEffect(() => {
    if (!open) {
      setStepId('select');
      setPreview(null);
      setBatchId(null);
      previewMutation.reset();
      dispatchMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handlePreview() {
    previewMutation.mutate(selection, {
      onSuccess: (result) => setPreview(result),
    });
  }

  function handleSubmit() {
    if (preview === null) return;
    dispatchMutation.mutate(selection, {
      onSuccess: (result) => setBatchId(result.batch_id),
    });
  }

  const batch = batchQuery.data;
  const done = batchId !== null && batch !== undefined && batch.queued === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {/* `WizardShell` renders its own visible `<h1>{title}</h1>` below —
            `DialogTitle` still needs to exist for Radix's `aria-labelledby`
            a11y contract, but rendered as a `<span>` (via `asChild`), not
            the default `<h2>`, so it doesn't register as a second
            `role="heading"` element with the same accessible name — Radix's
            `VisuallyHidden` alone doesn't help here since it keeps the
            element in the accessibility tree by design. */}
        <VisuallyHidden.Root>
          <DialogTitle asChild>
            <span>{t('invite.title')}</span>
          </DialogTitle>
        </VisuallyHidden.Root>
        <DialogDescription>{t('invite.description')}</DialogDescription>

        <WizardShell
          title={t('invite.title')}
          irreversible
          currentStepId={stepId}
          onStepChange={handleStepChange}
          onSubmit={handleSubmit}
          submitLabel={t('invite.confirm')}
          submitting={dispatchMutation.isPending}
          steps={[
            {
              id: 'select',
              label: t('invite.steps.select'),
              content: (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    {studentIds !== undefined
                      ? t('invite.select.importedCohort', { count: studentIds.length })
                      : t('invite.select.allGuardians')}
                  </p>
                  <Button type="button" onClick={handlePreview} loading={previewMutation.isPending}>
                    {t('invite.select.runPreview')}
                  </Button>
                  {previewMutation.isError && (
                    <p role="alert" className="text-sm text-destructive">
                      {t('invite.errors.previewFailed')}
                    </p>
                  )}
                </div>
              ),
            },
          ]}
          reviewStep={{
            id: 'preview',
            label: t('invite.steps.preview'),
            // The confirm button on `WizardShell`'s review step is the
            // mandatory gate — it stays disabled until a preview has run.
            isValid: () => preview !== null,
            content: (
              <div className="flex flex-col gap-4">
                {preview === null ? (
                  <p className="text-sm text-muted-foreground">{t('invite.preview.runFirst')}</p>
                ) : (
                  <>
                    <p className="text-sm">
                      {t('invite.preview.summary', {
                        count: preview.to_invite.length,
                        skipped: preview.skipped.length,
                      })}
                    </p>
                    {preview.to_invite.length > 0 && (
                      <ul className="max-h-48 list-inside list-disc overflow-auto text-sm">
                        {preview.to_invite.map((entry) => (
                          <li key={entry.guardian_id}>
                            {entry.full_name} — {entry.channel}
                          </li>
                        ))}
                      </ul>
                    )}
                    {preview.skipped.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-sm text-muted-foreground">
                          {t('invite.preview.skippedSummary', { count: preview.skipped.length })}
                        </summary>
                        <ul className="mt-2 max-h-48 list-inside list-disc overflow-auto text-sm">
                          {preview.skipped.map((entry) => (
                            <li key={entry.guardian_id}>
                              {entry.full_name} — {skipReasonLabel(t, entry.reason)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
                {dispatchMutation.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {t('invite.errors.dispatchFailed')}
                  </p>
                )}
              </div>
            ),
          }}
          result={
            batchId !== null ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm">
                  {done
                    ? t('invite.done.finished', {
                        sent: batch?.sent ?? 0,
                        failed: batch?.failed ?? 0,
                      })
                    : t('invite.done.inProgress', {
                        queued: batch?.queued ?? 0,
                        total: batch?.total ?? 0,
                      })}
                </p>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t('actions.close', { ns: 'common' })}
                </Button>
              </div>
            ) : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}
