/**
 * #535's inline "Add admin" form on the school detail page — same
 * name/email-or-phone shape as `-create-school-wizard.tsx`'s
 * `AdminStepForm`/`adminStepSchema`, since both ultimately hit the same
 * find-or-create-user path (`ProvisioningService.findOrCreateAdmin`) via
 * different routes (`POST /schools` vs `POST /schools/:id/admins`).
 * Kept as its own small form rather than reusing the wizard's component
 * directly — that one is coupled to the wizard's step/success flow this
 * card doesn't have.
 */
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@biddaloy/ui/components';
import type { AddSchoolAdminInput } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const addAdminSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().max(100).optional().or(z.literal('')),
    phone: z.string().trim().max(20).optional().or(z.literal('')),
  })
  .superRefine((values, ctx) => {
    if (!values.email && !values.phone) {
      const message = 'Provide an email or a phone number.';
      ctx.addIssue({ code: 'custom', path: ['email'], message });
      ctx.addIssue({ code: 'custom', path: ['phone'], message });
    } else if (values.email) {
      const emailCheck = z.email().safeParse(values.email);
      if (!emailCheck.success) {
        ctx.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email address.' });
      }
    }
  });

type AddAdminValues = z.infer<typeof addAdminSchema>;

export interface AddAdminFormProps {
  submitting: boolean;
  submitError?: string;
  /** Resolves `true` once the admin is created. The form only clears on
   * `true` — on a failed `POST /schools/:id/admins` the entered values stay
   * put so the user can fix and retry without re-typing everything. */
  onSubmit: (values: AddSchoolAdminInput) => Promise<boolean>;
}

export function AddAdminForm({ submitting, submitError, onSubmit }: AddAdminFormProps) {
  const { t } = useTranslation('platform');
  const form = useForm<AddAdminValues>({
    resolver: zodResolver(addAdminSchema),
    defaultValues: { name: '', email: '', phone: '' },
  });

  async function handleSubmit(values: AddAdminValues) {
    const created = await onSubmit({
      name: values.name,
      ...(values.email ? { email: values.email } : {}),
      ...(values.phone ? { phone: values.phone } : {}),
    });
    if (created) form.reset({ name: '', email: '', phone: '' });
  }

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-3 rounded-lg border p-4"
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
        <h3 className="text-sm font-semibold">{t('schoolDetail.admins.addTitle')}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="add-admin-name">{t('schoolDetail.admins.nameLabel')}</FormLabel>
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
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div>
          <Button type="submit" loading={submitting}>
            {t('schoolDetail.admins.addAction')}
          </Button>
        </div>
        {submitError && (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        )}
      </form>
    </Form>
  );
}
