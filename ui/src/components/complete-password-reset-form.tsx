import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useTranslation } from '../i18n';

import { Button } from './button';
import { Card } from './card';
import { Checkbox } from './checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form-field';
import { Input } from './input';

export interface CompletePasswordResetFormValues {
  new_password: string;
  confirm_password: string;
}

export interface CompletePasswordResetFormServerError {
  message?: string;
}

export interface CompletePasswordResetFormProps {
  onSubmit: (values: { new_password: string }) => void;
  onCancel: () => void;
  submitting?: boolean;
  serverError?: CompletePasswordResetFormServerError | null;
}

export function CompletePasswordResetForm({
  onSubmit,
  onCancel,
  submitting = false,
  serverError = null,
}: CompletePasswordResetFormProps) {
  const { t } = useTranslation('auth');
  const [showPasswords, setShowPasswords] = React.useState(false);

  const schema = React.useMemo(
    () =>
      z
        .object({
          new_password: z.string().min(1, t('reset.errors.newRequired')),
          confirm_password: z.string().min(1, t('reset.errors.confirmRequired')),
        })
        .refine((data) => data.new_password === data.confirm_password, {
          message: t('reset.errors.mismatch'),
          path: ['confirm_password'],
        }),
    [t],
  );

  const form = useForm<CompletePasswordResetFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { new_password: '', confirm_password: '' },
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  function handleValidSubmit(values: CompletePasswordResetFormValues): void {
    onSubmit({ new_password: values.new_password });
  }

  const passwordType = showPasswords ? 'text' : 'password';

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">{t('reset.title')}</h2>
      {serverError?.message && (
        <p role="alert" className="text-sm text-destructive">
          {serverError.message}
        </p>
      )}
      <Form {...form}>
        <form
          onSubmit={(event) => void form.handleSubmit(handleValidSubmit)(event)}
          noValidate
          className="flex flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="new_password"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="account-change-new-password">{t('reset.fields.new')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id="account-change-new-password"
                    type={passwordType}
                    autoComplete="new-password"
                    disabled={submitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirm_password"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="account-change-confirm-password">
                  {t('reset.fields.confirm')}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id="account-change-confirm-password"
                    type={passwordType}
                    autoComplete="new-password"
                    disabled={submitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex items-center gap-2">
            <Checkbox
              id="account-change-show-passwords"
              checked={showPasswords}
              onCheckedChange={(checked) => setShowPasswords(checked === true)}
              disabled={submitting}
            />
            <label
              htmlFor="account-change-show-passwords"
              className="text-xs text-muted-foreground"
            >
              {showPasswords ? t('reset.hide') : t('reset.show')}
            </label>
          </div>

          <p className="rounded-md bg-status-due-bg p-3 text-xs text-status-due-fg">
            {t('reset.consequenceNotice')}
          </p>

          <Button type="submit" loading={submitting} className="self-start">
            {submitting ? t('reset.saving') : t('reset.save')}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('reset.cancel')}
          </Button>
        </form>
      </Form>
    </Card>
  );
}
