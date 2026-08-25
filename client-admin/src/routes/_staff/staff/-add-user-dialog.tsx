/**
 * [8.11.8]'s Add-user dialog — `POST /users` creates the account *and*
 * its membership in the active school in one transaction
 * (`UserService.create`). Local `useState` rather than react-hook-form,
 * same weight-class reasoning as `academic-years/-year-form-dialog.tsx`.
 * A 409 (duplicate email — global accounts are unique by email, not
 * per-school) renders its own inline message instead of the generic one.
 */
import { STAFF_ROLES } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
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
} from '@biddaloy/ui/components';
import { useActiveTenant, useCreateUser, type UserRoleFilter } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface AddUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddUserDialog({ open, onOpenChange }: AddUserDialogProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const tenantId = useActiveTenant();
  const createUser = useCreateUser();

  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [role, setRole] = React.useState<string | null>(null);
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFullName('');
    setEmail('');
    setPhone('');
    setRole(null);
    setValidationError(null);
    createUser.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (fullName.trim() === '') {
      setValidationError(t('addUser.errorNameRequired'));
      return;
    }
    if (role === null) {
      setValidationError(t('addUser.errorRoleRequired'));
      return;
    }
    if (tenantId === null) return;
    setValidationError(null);
    createUser.mutate(
      {
        full_name: fullName.trim(),
        ...(email.trim() !== '' ? { email: email.trim() } : {}),
        ...(phone.trim() !== '' ? { phone: phone.trim() } : {}),
        role: role as UserRoleFilter,
        tenantId,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  const duplicateEmail =
    createUser.isError &&
    createUser.error instanceof ApiError &&
    createUser.error.statusCode === 409;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('addUser.title')}</DialogTitle>
            <DialogDescription>{t('addUser.description')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-user-name" className="text-sm font-medium">
              {t('addUser.nameLabel')}
            </label>
            <Input
              id="add-user-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-user-email" className="text-sm font-medium">
              {t('addUser.emailLabel')}
            </label>
            <Input
              id="add-user-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-user-phone" className="text-sm font-medium">
              {t('addUser.phoneLabel')}
            </label>
            <PhoneInput
              id="add-user-phone"
              value={phone}
              config={regionConfig}
              onValueChange={(value) => setPhone(value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('addUser.roleLabel')}</span>
            <Select value={role ?? ''} onValueChange={(value) => setRole(value)}>
              <SelectTrigger aria-label={t('addUser.roleLabel')}>
                <SelectValue placeholder={t('addUser.rolePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {STAFF_ROLES.map((staffRole) => (
                  <SelectItem key={staffRole} value={staffRole}>
                    {t(`roles.${staffRole}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {validationError && (
            <p role="alert" className="text-sm text-destructive">
              {validationError}
            </p>
          )}
          {createUser.isError && (
            <p role="alert" className="text-sm text-destructive">
              {duplicateEmail ? t('addUser.errorDuplicateEmail') : t('addUser.errorMessage')}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button type="submit" loading={createUser.isPending}>
              {createUser.isPending ? t('addUser.saving') : t('addUser.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
