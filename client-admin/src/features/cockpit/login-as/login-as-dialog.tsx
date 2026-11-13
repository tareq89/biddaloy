/**
 * [99.W5] The Login as dialog (mockup "Login as dialog"). Two clicks for the common case: role
 * defaults to Admin, person to the first one who can be chosen. The authenticator code is asked
 * by the shared approval modal when Login as is pressed.
 */
import { IMPERSONATION_REASON_MAX, IMPERSONATION_REASON_MIN, UserRole } from '@biddaloy/shared';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  PersonPicker,
  ReasonChips,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useLoginAsCandidates } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { NoAdminState } from './no-admin-state';
import { useLoginAs } from './use-login-as';
import { WaitingState } from './waiting-state';

const ROLES = [
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.EXECUTIVE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

export interface LoginAsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
  /** The school's own note, shown read-only above the reason (W12). */
  schoolNote?: string | undefined;
  /** Prefill from the palette action. */
  defaultRole?: UserRole;
  defaultReason?: string;
  /** Opens the invite-admin dialog (D26). */
  onInviteAdmin: () => void;
}

export function LoginAsDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  schoolNote,
  defaultRole = UserRole.ADMIN,
  defaultReason = '',
  onInviteAdmin,
}: LoginAsDialogProps) {
  const { t } = useTranslation('loginAs');
  const [role, setRole] = React.useState<UserRole>(defaultRole);
  const [personId, setPersonId] = React.useState<string | undefined>();
  const [query, setQuery] = React.useState('');
  const [reason, setReason] = React.useState(defaultReason);
  const [viewOnly, setViewOnly] = React.useState(false);
  const [emergency, setEmergency] = React.useState(false);
  const candidates = useLoginAsCandidates(open ? schoolId : undefined, role);
  const data = candidates.data;
  const flow = useLoginAs(data?.supportAccessMode);

  const blocked = (data?.supportAccessMode as string | undefined) === 'blocked';
  const items = (data?.candidates ?? [])
    .filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    .map((c) => ({
      id: c.userId ?? `none-${c.name}`,
      name: c.name,
      meta: c.email ?? c.phone ?? '',
      ...(c.unavailableReason
        ? {
            disabledReason: t(
              c.unavailableReason === 'NO_LOGIN_ACCOUNT' ? 'noLoginAccount' : 'inactive',
            ),
          }
        : {}),
    }));
  const firstEnabled = items.find((i) => !i.disabledReason)?.id;
  const chosen = items.some((i) => i.id === personId && !i.disabledReason)
    ? personId
    : firstEnabled;
  const canSubmit =
    !!chosen && reason.trim().length >= IMPERSONATION_REASON_MIN && (!blocked || emergency);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || flow.isPending || !chosen) return;
    flow.submit({
      schoolId,
      role,
      targetUserId: chosen,
      reason: reason.trim(),
      viewOnly: viewOnly || blocked,
    });
  }

  const { reset: resetFlow, cancel: cancelFlow } = flow;
  const waiting = flow.state.kind === 'waiting';
  const close = React.useCallback(
    (next: boolean) => {
      if (next) return onOpenChange(true);
      // Dismissing while waiting must also end the pending request on the server. If that
      // fails, the dialog stays open on the waiting card with a retry; nothing is lost.
      if (waiting) void cancelFlow().then((ended) => ended && onOpenChange(false));
      else {
        resetFlow();
        onOpenChange(false);
      }
    },
    [onOpenChange, resetFlow, cancelFlow, waiting],
  );

  React.useEffect(() => {
    if (flow.state.kind === 'opened') close(false);
  }, [flow.state.kind, close]);

  const chips = [
    t('reasonChips.supportRequest'),
    t('reasonChips.bugCheck'),
    t('reasonChips.setupHelp'),
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { school: schoolName })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {flow.state.kind === 'waiting' ? (
          <WaitingState
            ownerWait={flow.state.blocked}
            outcome={flow.outcome}
            cancelFailed={flow.state.cancelFailed === true}
            onCancel={() => void flow.cancel()}
            onOpen={flow.openApproved}
          />
        ) : data?.noActiveAdmin ? (
          <NoAdminState onInvite={onInviteAdmin} />
        ) : (
          <form id="login-as-form" onSubmit={submit} className="flex flex-col gap-4">
            {blocked && (
              <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
                <p>{t('blocked')}</p>
                {emergency ? (
                  <p>{t('emergencyHelp')}</p>
                ) : (
                  <Button type="button" variant="link" onClick={() => setEmergency(true)}>
                    {t('emergencyLink')}
                  </Button>
                )}
              </div>
            )}
            {(!blocked || emergency) && (
              <>
                <div className="flex flex-col gap-2">
                  <Label>{t('role')}</Label>
                  <Select
                    value={role}
                    onValueChange={(v) => {
                      setRole(v as UserRole);
                      setPersonId(undefined);
                    }}
                  >
                    <SelectTrigger aria-label={t('role')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {t(`roles.${r}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t('person')}</Label>
                  <PersonPicker
                    items={items}
                    value={chosen}
                    onValueChange={setPersonId}
                    searchLabel={t('personSearch')}
                    onSearchChange={setQuery}
                    emptyLabel={t('personEmpty')}
                    label={t('personList')}
                  />
                  {candidates.isError && (
                    <p role="alert" className="text-sm text-destructive">
                      {t('loadError')}
                    </p>
                  )}
                </div>
                {schoolNote && (
                  <p className="rounded-lg bg-muted p-3 text-sm">
                    <span className="font-semibold">{t('schoolNote')}: </span>
                    {schoolNote}
                  </p>
                )}
                <ReasonChips
                  chips={blocked ? [] : chips}
                  value={reason}
                  onChange={(v) => setReason(v.slice(0, IMPERSONATION_REASON_MAX))}
                  textLabel={blocked ? t('emergencyReason') : t('reason')}
                  minLength={IMPERSONATION_REASON_MIN}
                  error={t('reasonTooShort', { count: IMPERSONATION_REASON_MIN })}
                />
                {!blocked && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="login-as-view-only"
                      checked={viewOnly}
                      onCheckedChange={(v) => setViewOnly(v === true)}
                    />
                    <Label htmlFor="login-as-view-only">{t('viewOnly')}</Label>
                  </div>
                )}
              </>
            )}
            {flow.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t('error')}
              </p>
            )}
          </form>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {flow.state.kind !== 'waiting' && (
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {t('cancel')}
            </Button>
          )}
          {flow.state.kind === 'idle' && !data?.noActiveAdmin && (
            <Button
              type="submit"
              form="login-as-form"
              disabled={!canSubmit}
              loading={flow.isPending}
            >
              {t('submit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
