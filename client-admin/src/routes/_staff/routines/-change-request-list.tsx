/**
 * [21.9.1] D11: the builder's change-request queue. Accepting or
 * rejecting a request never edits the routine — the copy says so
 * explicitly, because the actual grid edit (if any) usually reshuffles
 * other slots too and is done deliberately through the grid builder
 * (`$sectionId.tsx`), not as a side effect of this list.
 */
import { Button, Textarea, toast } from '@biddaloy/ui/components';
import { useResolveChangeRequest, type RoutineChangeRequest } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface ChangeRequestListProps {
  routineId: string;
  requests: RoutineChangeRequest[];
  slotLabel: (slotId: string) => string;
  requesterLabel: (userId: string) => string;
}

export function ChangeRequestList({
  routineId,
  requests,
  slotLabel,
  requesterLabel,
}: ChangeRequestListProps) {
  const { t } = useTranslation('routines');
  const resolve = useResolveChangeRequest(routineId);
  const [resolutionNotes, setResolutionNotes] = React.useState<Record<string, string>>({});

  const open = requests.filter((request) => request.state === 'OPEN');

  function handleResolve(id: string, state: 'ACCEPTED' | 'REJECTED') {
    const note = resolutionNotes[id]?.trim();
    resolve.mutate(
      { id, input: note ? { state, resolution_note: note } : { state } },
      {
        onSuccess: () => toast.success(t('changeRequestList.resolvedToast')),
        onError: () => toast.error(t('changeRequestList.errorToast')),
      },
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{t('changeRequestList.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('changeRequestList.acceptDoesNotEditExplanation')}</p>

      {open.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('changeRequestList.empty')}</p>
      )}

      <ul className="flex flex-col gap-2">
        {open.map((request) => (
          <li
            key={request.id}
            className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-card p-3"
          >
            <div className="text-sm">
              <span className="font-medium">{slotLabel(request.routine_slot_id)}</span>
              {' — '}
              <span className="text-muted-foreground">
                {t('changeRequestList.requestedBy', { name: requesterLabel(request.requested_by) })}
              </span>
            </div>
            <p className="text-sm">{request.note}</p>
            <Textarea
              aria-label={t('changeRequestList.resolutionNoteLabel')}
              placeholder={t('changeRequestList.resolutionNotePlaceholder')}
              value={resolutionNotes[request.id] ?? ''}
              onChange={(event) =>
                setResolutionNotes((current) => ({ ...current, [request.id]: event.target.value }))
              }
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                loading={resolve.isPending}
                onClick={() => handleResolve(request.id, 'REJECTED')}
              >
                {t('changeRequestList.reject')}
              </Button>
              <Button
                type="button"
                loading={resolve.isPending}
                onClick={() => handleResolve(request.id, 'ACCEPTED')}
              >
                {t('changeRequestList.accept')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
