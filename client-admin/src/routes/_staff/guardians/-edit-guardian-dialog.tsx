/**
 * [8.11.4]'s Information tab edit action — a small dialog over
 * `useUpdateGuardian`, same shape as `students/-detail/transfer-status
 * -dialog.tsx` (plain `useState` per field, no `react-hook-form`/`Form
 * Shell`): the field count here (7, all optional but `full_name`) doesn't
 * warrant that heavier machinery the way the full Add/Edit Student page
 * does. `student_ids` is deliberately not a field here — the Linked
 * Students tab owns that edit, via its own `StudentPicker`.
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PhoneInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@biddaloy/ui/components';
import { useUpdateGuardian, type Guardian, type UpdateGuardianInput } from '@biddaloy/ui/hooks';
import { useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import * as React from 'react';

const PREFERRED_COMMUNICATION_OPTIONS = [
  'SMS',
  'WHATSAPP',
  'EMAIL',
  'PHONE_CALL',
  'MESSENGER',
] as const;

export interface EditGuardianDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guardian: Guardian;
  config: RegionConfig;
}

interface FormState {
  full_name: string;
  relationship: string;
  phone: string;
  email: string;
  alternate_phone: string;
  address: string;
  occupation: string;
  preferred_communication: Guardian['preferred_communication'];
}

function toFormState(guardian: Guardian): FormState {
  return {
    full_name: guardian.full_name,
    relationship: guardian.relationship,
    phone: guardian.phone ?? '',
    email: guardian.email ?? '',
    alternate_phone: guardian.alternate_phone ?? '',
    address: guardian.address ?? '',
    occupation: guardian.occupation ?? '',
    preferred_communication: guardian.preferred_communication,
  };
}

export function EditGuardianDialog({
  open,
  onOpenChange,
  guardian,
  config,
}: EditGuardianDialogProps) {
  const { t } = useTranslation('guardians');
  const [form, setForm] = React.useState<FormState>(() => toFormState(guardian));
  const [fullNameError, setFullNameError] = React.useState<string | undefined>(undefined);
  const updateGuardian = useUpdateGuardian(guardian.id);

  // A background refetch of the `useGuardian` query the dialog reads
  // `guardian` from (e.g. another tab open on the same guardian) can hand
  // this component a new `guardian` object reference while the dialog is
  // still open — a ref, not `guardian` itself, in the effect's deps below
  // means that doesn't wipe whatever the user has already typed.
  const guardianRef = React.useRef(guardian);
  guardianRef.current = guardian;

  React.useEffect(() => {
    if (open) {
      setForm(toFormState(guardianRef.current));
      setFullNameError(undefined);
      updateGuardian.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions, not on every `guardian` change; see guardianRef comment above
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const fullName = form.full_name.trim();
    if (fullName === '') {
      setFullNameError(t('editDialog.fullNameRequired'));
      return;
    }
    setFullNameError(undefined);

    const relationship = form.relationship.trim();
    const phone = form.phone.trim();
    const email = form.email.trim();
    const alternatePhone = form.alternate_phone.trim();
    const address = form.address.trim();
    const occupation = form.occupation.trim();

    // Sent as `''`, not omitted, when the user cleared a field — omitting
    // an emptied field here would silently leave the old value in place
    // instead of clearing it (`GuardianService.update` maps `''` to NULL
    // for these nullable columns; see its own comment).
    const input: UpdateGuardianInput = {
      full_name: fullName,
      relationship,
      phone,
      email,
      alternate_phone: alternatePhone,
      address,
      occupation,
      preferred_communication: form.preferred_communication,
    };
    updateGuardian.mutate(input, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{t('editDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('editDialog.description', { name: guardian.full_name })}
            </DialogDescription>
          </DialogHeader>

          <Input
            id="guardian-edit-full-name"
            aria-label={t('editDialog.fields.fullName')}
            placeholder={t('editDialog.fields.fullName')}
            value={form.full_name}
            onChange={(event) => setForm({ ...form, full_name: event.target.value })}
          />
          {fullNameError && (
            <p role="alert" className="text-sm text-destructive">
              {fullNameError}
            </p>
          )}

          <Input
            id="guardian-edit-relationship"
            aria-label={t('editDialog.fields.relationship')}
            placeholder={t('editDialog.fields.relationship')}
            value={form.relationship}
            onChange={(event) => setForm({ ...form, relationship: event.target.value })}
          />

          <PhoneInput
            id="guardian-edit-phone"
            aria-label={t('editDialog.fields.phone')}
            value={form.phone}
            config={config}
            onValueChange={(value) => setForm({ ...form, phone: value })}
          />

          <PhoneInput
            id="guardian-edit-alternate-phone"
            aria-label={t('editDialog.fields.alternatePhone')}
            value={form.alternate_phone}
            config={config}
            onValueChange={(value) => setForm({ ...form, alternate_phone: value })}
          />

          <Input
            id="guardian-edit-email"
            type="email"
            aria-label={t('editDialog.fields.email')}
            placeholder={t('editDialog.fields.email')}
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />

          <Textarea
            id="guardian-edit-address"
            aria-label={t('editDialog.fields.address')}
            placeholder={t('editDialog.fields.address')}
            value={form.address}
            onChange={(event) => setForm({ ...form, address: event.target.value })}
          />

          <Input
            id="guardian-edit-occupation"
            aria-label={t('editDialog.fields.occupation')}
            placeholder={t('editDialog.fields.occupation')}
            value={form.occupation}
            onChange={(event) => setForm({ ...form, occupation: event.target.value })}
          />

          <Select
            value={form.preferred_communication}
            onValueChange={(value) =>
              setForm({
                ...form,
                preferred_communication: value as Guardian['preferred_communication'],
              })
            }
          >
            <SelectTrigger aria-label={t('editDialog.fields.preferredCommunication')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PREFERRED_COMMUNICATION_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`preferredCommunicationOptions.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {updateGuardian.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('editDialog.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={updateGuardian.isPending}>
              {updateGuardian.isPending ? t('editDialog.saving') : t('editDialog.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
