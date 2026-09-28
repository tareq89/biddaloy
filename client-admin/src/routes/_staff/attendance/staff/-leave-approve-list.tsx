/**
 * [36.4] The ticket's step 3 calls for a pending-requests approve/reject
 * list for `LEAVE_APPROVE` holders. That needs a way to *list* pending
 * leave requests — `server/src/modules/leave/leave.controller.ts` has no
 * such route (only `POST /requests`, `POST /requests/:id/decide`,
 * `GET /balance`, `GET /policies`; confirmed against `leave.service.ts`'s
 * method list too). Without a list endpoint there is no record id to
 * decide on, so this renders an explanation instead of a component that
 * would silently 404/degrade in production.
 *
 * Not a fake `useState([])` "empty list" either — that would look
 * indistinguishable from "no one has requested leave", which is false and
 * would hide the gap from whoever reviews this screen next. Replace this
 * whole component with a real list once a `GET /leave/requests` (or
 * similar) endpoint exists — the `useDecideLeaveRequest` mutation and
 * whatever list hook it needs both belong in `ui/src/api/leave.ts`
 * alongside the existing hooks there.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export function LeaveApproveList() {
  const { t } = useTranslation('leave');
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-card p-4">
      <h2 className="text-sm font-semibold">{t('approve.title')}</h2>
      <p role="status" className="text-sm text-muted-foreground">
        {t('approve.notAvailableMessage')}
      </p>
    </div>
  );
}
