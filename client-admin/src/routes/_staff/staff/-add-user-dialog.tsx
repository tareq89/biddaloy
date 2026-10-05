/**
 * [8.11.8]'s Add-user dialog — `POST /users` creates the account *and*
 * its membership in the active school in one transaction
 * (`UserService.create`). Local `useState` rather than react-hook-form,
 * same weight-class reasoning as `academic-years/-year-form-dialog.tsx`.
 * A 409 (duplicate email — global accounts are unique by email, not
 * per-school) renders its own inline message instead of the generic one.
 */
import { STAFF_ROLES, UserRole } from '@biddaloy/shared';
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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
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
import { useForm } from 'react-hook-form';

export interface AddUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** SUPER_ADMIN is a platform role: `POST /users` always refuses it (#731). */
const ASSIGNABLE_ROLES = STAFF_ROLES.filter((r) => r !== UserRole.SUPER_ADMIN);

interface AddUserValues {
  full_name: string;
  email: string;
  phone: string;
  role: string;
}

const EMPTY: AddUserValues = { full_name: '', email: '', phone: '', role: '' };

export function AddUserDialog({ open, onOpenChange }: AddUserDialogProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const tenantId = useActiveTenant();
  const createUser = useCreateUser();
  const form = useForm<AddUserValues>({ defaultValues: EMPTY });

  React.useEffect(() => {
    if (!open) return;
    form.reset(EMPTY);
    createUser.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(values: AddUserValues) {
    if (tenantId === null) return;
    createUser.mutate(
      {
        full_name: values.full_name.trim(),
        ...(values.email.trim() !== '' ? { email: values.email.trim() } : {}),
        ...(values.phone.trim() !== '' ? { phone: values.phone.trim() } : {}),
        role: values.role as UserRoleFilter,
        tenantId,
      },
      {
        onSuccess: () => onOpenChange(false),
        // A 409 (duplicate email) sits under the email field; anything else
        // keeps the generic alert above the footer.
        onError: (error) => {
          if (error instanceof ApiError && error.statusCode === 409) {
            form.setError('email', { message: t('addUser.errorDuplicateEmail') });
          }
        },
      },
    );
  }

  const genericError =
    createUser.isError &&
    !(createUser.error instanceof ApiError && createUser.error.statusCode === 409);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
        <Form {...form}>
          <form
            onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
            className="flex flex-col gap-4"
            noValidate
          >
            <DialogHeader>
              <DialogTitle>{t('addUser.title')}</DialogTitle>
              <DialogDescription>{t('addUser.description')}</DialogDescription>
            </DialogHeader>

            <FormField
              control={form.control}
              name="full_name"
              rules={{
                validate: (v) => v.trim() !== '' || t('addUser.errorNameRequired'),
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="add-user-name" required>
                    {t('addUser.nameLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="add-user-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="add-user-email">{t('addUser.emailLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      id="add-user-email"
                      type="email"
                      {...field}
                      onChange={(event) => {
                        form.clearErrors('email');
                        field.onChange(event);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="add-user-phone">{t('addUser.phoneLabel')}</FormLabel>
                  <FormControl>
                    <PhoneInput
                      id="add-user-phone"
                      value={field.value}
                      config={regionConfig}
                      onValueChange={(value) => field.onChange(value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              rules={{ validate: (v) => v !== '' || t('addUser.errorRoleRequired') }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="add-user-role" required>
                    {t('addUser.roleLabel')}
                  </FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger id="add-user-role">
                        <SelectValue
                          placeholder={t('form.selectPlaceholder', { ns: 'common' })}
                        >
                          {field.value ? t(`roles.${field.value}`) : undefined}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ASSIGNABLE_ROLES.map((staffRole) => (
                        <SelectItem key={staffRole} value={staffRole}>
                          <span className="flex flex-col">
                            <span>{t(`roles.${staffRole}`)}</span>
                            <span className="text-caption text-text-secondary">
                              {t(`roleDescriptions.${staffRole}`)}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {genericError && (
              <p role="alert" className="text-caption text-destructive">
                {t('addUser.errorMessage')}
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
        </Form>
      </DialogContent>
    </Dialog>
  );
}
