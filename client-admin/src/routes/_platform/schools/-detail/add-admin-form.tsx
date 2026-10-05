/**
 * #535's "Add admin" dialog on the school detail page — same
 * name/email-or-phone shape as `-create-school-wizard.tsx`'s admin step,
 * since both ultimately hit the same find-or-create-user path
 * (`ProvisioningService.findOrCreateAdmin`) via different routes
 * (`POST /schools` vs `POST /schools/:id/admins`). Opened from the header
 * primary and the admins empty state (D21/D29: no inline forms, one filled
 * button per view).
 *
 * Owns `useAddSchoolAdmin`. On failure the typed values stay and a translated
 * sentence shows inline (never the server message, D9).
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  toast,
} from '@biddaloy/ui/components';
import { useAddSchoolAdmin } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

interface AddAdminValues {
  name: string;
  email?: string | undefined;
  phone?: string | undefined;
}

const EMPTY: AddAdminValues = { name: '', email: '', phone: '' };

export interface AddAdminDialogProps {
  schoolId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddAdminDialog({ schoolId, open, onOpenChange }: AddAdminDialogProps) {
  const { t } = useTranslation('platform');
  const addAdmin = useAddSchoolAdmin(schoolId);
  const [failed, setFailed] = React.useState(false);

  const schema = React.useMemo(
    () =>
      z
        .object({
          name: z.string().trim().min(1, t('createWizard.errors.required')).max(100),
          email: z.string().trim().max(100).optional().or(z.literal('')),
          phone: z.string().trim().max(20).optional().or(z.literal('')),
        })
        .superRefine((values, ctx) => {
          if (!values.email && !values.phone) {
            const message = t('createWizard.errors.contactRequired');
            ctx.addIssue({ code: 'custom', path: ['email'], message });
            ctx.addIssue({ code: 'custom', path: ['phone'], message });
          } else if (values.email && !z.email().safeParse(values.email).success) {
            ctx.addIssue({
              code: 'custom',
              path: ['email'],
              message: t('createWizard.errors.emailInvalid'),
            });
          }
        }),
    [t],
  );

  const form = useForm<AddAdminValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const pending = addAdmin.isPending;

  function handleOpenChange(next: boolean) {
    // A pending request must not be dismissed from under itself.
    if (!next && pending) return;
    if (!next) {
      form.reset(EMPTY);
      setFailed(false);
    }
    onOpenChange(next);
  }

  function handleSubmit(values: AddAdminValues) {
    setFailed(false);
    addAdmin.mutate(
      {
        name: values.name,
        ...(values.email ? { email: values.email } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
      },
      {
        onSuccess: () => {
          form.reset(EMPTY);
          onOpenChange(false);
          toast.success(t('schoolDetail.admins.addSuccess'));
        },
        onError: () => setFailed(true),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        size="md"
        showCloseButton={!pending}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('schoolDetail.admins.addTitle')}</DialogTitle>
          <DialogDescription>{t('schoolDetail.admins.addDescription')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="add-admin-form"
            noValidate
            onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
            className="grid gap-4 md:grid-cols-2"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel htmlFor="add-admin-name" required>
                    {t('schoolDetail.admins.nameLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="add-admin-name" {...field} />
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
                  <FormLabel htmlFor="add-admin-email">
                    {t('schoolDetail.admins.emailLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="add-admin-email" type="email" {...field} />
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
                  <FormLabel htmlFor="add-admin-phone">
                    {t('schoolDetail.admins.phoneLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="add-admin-phone" {...field} />
                  </FormControl>
                  <FormDescription>{t('schoolDetail.admins.contactHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        {failed && (
          <p role="alert" className="text-caption text-destructive">
            {t('schoolDetail.admins.addError')}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form="add-admin-form" loading={pending}>
            {t('schoolDetail.admins.addAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
