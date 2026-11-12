import { Button, Card, ErrorState, toast } from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  getApprovalRequestId,
  useAnnouncements,
  usePlatformApprovals,
  usePreviewAnnouncement,
  useSendAnnouncement,
  type Announcement,
  type SendAnnouncementInput,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ComposeForm, type PreviewState } from './-compose-form';
import { SentList } from './-sent-list';

/**
 * Epic 99 #3826: one message to every school's admins. The owner sees how many schools and
 * people it reaches, and that the other owner must agree. Send answers 403 `APPROVAL_REQUESTED`;
 * the page then waits (polling the approvals), and re-sends the SAME body (same Idempotency-Key,
 * kept by `useSendAnnouncement`) with the approval id once it is granted.
 */
const POLL_MS = 5_000;

export const Route = createFileRoute('/_platform/announcements/')({
  loader: () => loadRouteNamespaces('platformAnnouncements', 'approval'),
  component: AnnouncementsPage,
});

type Pending = { input: SendAnnouncementInput; approvalId: string; at: number };

function AnnouncementsPage() {
  const { t } = useTranslation('platformAnnouncements');
  const list = useAnnouncements();
  const previewMutation = usePreviewAnnouncement();
  const send = useSendAnnouncement();
  const approvals = usePlatformApprovals();

  const [formKey, setFormKey] = React.useState(0);
  const [preview, setPreview] = React.useState<PreviewState>({ kind: 'loading' });
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [sent, setSent] = React.useState<Announcement | null>(null);
  const [usedNote, setUsedNote] = React.useState(false);

  // Preview: a POST, so it runs from the filter change. Only the latest call may answer.
  const latest = React.useRef(0);
  const lastFilter = React.useRef<SendAnnouncementInput['statusFilter']>(['ACTIVE']);
  const { mutateAsync: previewAsync } = previewMutation;
  const runPreview = React.useCallback(
    async (statusFilter: SendAnnouncementInput['statusFilter']) => {
      lastFilter.current = statusFilter;
      const call = ++latest.current;
      setPreview({ kind: 'loading' });
      try {
        const result = await previewAsync({ statusFilter });
        if (call === latest.current) setPreview({ kind: 'ready', ...result });
      } catch {
        if (call === latest.current) setPreview({ kind: 'error' });
      }
    },
    [previewAsync],
  );

  // One send at a time: a double click is one request.
  const inFlight = React.useRef(false);
  const { refetch: refetchApprovals } = approvals;
  async function doSend(input: SendAnnouncementInput, approvalId?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await send.mutateAsync({ ...input, ...(approvalId ? { approvalId } : {}) });
      setPending(null);
      setSent(result);
      setFormKey((k) => k + 1);
    } catch (error) {
      const requestId = getApprovalRequestId(error);
      if (error instanceof ApprovalCancelledError) {
        // The owner closed the code prompt: nothing to say.
      } else if (requestId) {
        setPending({ input, approvalId: requestId, at: Date.now() });
        void refetchApprovals();
      } else {
        toast.error(t('compose.sendError'));
      }
    } finally {
      inFlight.current = false;
    }
  }

  const found = pending ? approvals.data?.find((a) => a.id === pending.approvalId) : undefined;
  const status = found?.status;
  // A list fetched after the request was made that does not hold it: do not wait forever.
  const unknown =
    pending !== null && !found && approvals.isSuccess && approvals.dataUpdatedAt > pending.at;
  const ended = status === 'DENIED' || status === 'EXPIRED';
  const settled = ended || unknown;

  // While waiting, look again every few seconds (only while the tab is visible).
  React.useEffect(() => {
    if (!pending || settled) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refetchApprovals();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [pending, settled, refetchApprovals]);

  // Granted: send it once. If the owner closes the code prompt, "Send now" stays.
  const autoTried = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (pending && status === 'GRANTED' && autoTried.current !== pending.approvalId) {
      autoTried.current = pending.approvalId;
      void doSend(pending.input, pending.approvalId);
    }
    // doSend reads refs and stable hook callbacks only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, status]);

  // Used: it was already sent (another tab, an earlier re-send). Show the list, not a wait.
  const { refetch: refetchList } = list;
  React.useEffect(() => {
    if (pending && status === 'USED') {
      setPending(null);
      setUsedNote(true);
      void refetchList();
    }
  }, [pending, status, refetchList]);

  return (
    <PageContainer>
      <PageHeader title={t('title')} subtitle={t('caption')} />
      {sent && (
        <Card role="status" className="flex flex-wrap items-center justify-between gap-2 p-4">
          <span>
            {t('sent.done', { schools: sent.schoolsSucceeded, people: sent.recipientCount })}
          </span>
          <Button variant="outline" size="lg" onClick={() => setSent(null)}>
            {t('sent.another')}
          </Button>
        </Card>
      )}
      {usedNote && (
        <Card role="status" className="flex flex-wrap items-center justify-between gap-2 p-4">
          <span>{t('waiting.used')}</span>
          <Button variant="outline" size="lg" onClick={() => setUsedNote(false)}>
            {t('waiting.dismiss')}
          </Button>
        </Card>
      )}
      {pending && (
        <Card role="status" className="flex flex-wrap items-center justify-between gap-2 p-4">
          <span>
            {unknown
              ? t('waiting.unknown')
              : ended
                ? t(status === 'DENIED' ? 'waiting.denied' : 'waiting.expired')
                : status === 'GRANTED'
                  ? `${t('waiting.granted')} ${send.isPending ? t('waiting.sending') : ''}`.trim()
                  : t('waiting.pending')}
          </span>
          <div className="flex gap-2">
            {status === 'GRANTED' && !send.isPending && (
              <Button size="lg" onClick={() => void doSend(pending.input, pending.approvalId)}>
                {t('waiting.sendNow')}
              </Button>
            )}
            {!send.isPending && (
              <Button variant="outline" size="lg" onClick={() => setPending(null)}>
                {t(settled ? 'waiting.dismiss' : 'waiting.cancel')}
              </Button>
            )}
          </div>
        </Card>
      )}
      <ComposeForm
        key={formKey}
        preview={preview}
        onFilterChange={(statusFilter) => void runPreview(statusFilter)}
        onRetryPreview={() => void runPreview(lastFilter.current)}
        onSend={(input) => void doSend(input)}
        busy={send.isPending}
        locked={pending !== null && !settled}
      />
      <h2 className="text-h2">{t('list.title')}</h2>
      {list.isError ? (
        <ErrorState message={t('list.loadError')} onRetry={() => void list.refetch()} />
      ) : (
        <SentList
          rows={list.data?.items ?? []}
          loading={list.isLoading}
          isFetching={list.isFetching}
        />
      )}
    </PageContainer>
  );
}
