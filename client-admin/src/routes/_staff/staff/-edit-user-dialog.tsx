/**
 * [8.11.8]'s edit-user dialog — `PATCH /users/{id}` takes contact fields
 * only (**no `role`, no `status`** — neither endpoint exists to change
 * them, and the description copy says so). Kept separate from the
 * teacher-profile dialog on purpose: user identity fields and teacher
 * profile fields are different resources with different endpoints.
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
} from '@biddaloy/ui/components';
import { useUpdateUser, type StaffUser } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface EditUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: StaffUser;
}

export function EditUserDialog({ open, onOpenChange, user }: EditUserDialogProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const updateUser = useUpdateUser(user.id);

  const [fullName, setFullName] = React.useState(user.full_name);
  const [email, setEmail] = React.useState(user.email ?? '');
  const [phone, setPhone] = React.useState(user.phone ?? '');
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFullName(user.full_name);
    setEmail(user.email ?? '');
    setPhone(user.phone ?? '');
    setValidationError(null);
    updateUser.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (fullName.trim() === '') {
      setValidationError(t('editUser.errorNameRequired'));
      return;
    }
    // Email is a login identifier and cannot be cleared — blanking it
    // must fail loudly, not silently keep the old value.
    if (email.trim() === '' && user.email !== null) {
      setValidationError(t('editUser.errorEmailRequired'));
      return;
    }
    setValidationError(null);
    updateUser.mutate(
      {
        full_name: fullName.trim(),
        ...(email.trim() !== '' ? { email: email.trim() } : {}),
        // Blank phone clears the stored number (server accepts null).
        phone: phone.trim() !== '' ? phone.trim() : null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('editUser.title')}</DialogTitle>
            <DialogDescription>{t('editUser.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-user-name" className="text-sm font-medium">
              {t('editUser.nameLabel')}
            </label>
            <Input
              id="edit-user-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-user-email" className="text-sm font-medium">
              {t('editUser.emailLabel')}
            </label>
            <Input
              id="edit-user-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-user-phone" className="text-sm font-medium">
              {t('editUser.phoneLabel')}
            </label>
            <PhoneInput
              id="edit-user-phone"
              value={phone}
              config={regionConfig}
              onValueChange={(value) => setPhone(value)}
            />
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {updateUser.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('editUser.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={updateUser.isPending}>
              {updateUser.isPending ? t('editUser.saving') : t('editUser.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
