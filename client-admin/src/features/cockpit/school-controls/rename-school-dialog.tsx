/**
 * #3821 Rename a school. `PATCH /platform/schools/:id/name` through `useRenameSchool`
 * (`useApprovedMutation`): the owner's authenticator code is asked by the approval prompt after
 * Rename. Shows the old name; a failure is one fixed sentence, never the typed value (Rule 23).
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
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { ApprovalCancelledError, useRenameSchool } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'rename-school-form';

interface FormValues {
  name: string;
  reason: string;
}

export interface RenameSchoolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  /** The name shown today. */
  currentName: string;
}

export function RenameSchoolDialog({
  open,
  onOpenChange,
  schoolId,
  currentName,
}: RenameSchoolDialogProps) {
  const { t } = useTranslation('schoolControl');
  const rename = useRenameSchool(schoolId);
  const [failed, setFailed] = React.useState(false);

  const schema = React.useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('rename.errors.nameRequired')).max(200),
        reason: z.string().trim().min(5, t('rename.errors.reasonLength')).max(500),
      }),
    [t],
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', reason: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ name: '', reason: '' });
      rename.reset();
      setFailed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  async function handleSubmit(values: FormValues) {
    setFailed(false);
    try {
      await rename.mutateAsync({ name: values.name.trim(), reason: values.reason.trim() });
      onOpenChange(false);
      toast.success(t('rename.success'));
    } catch (error) {
      // A closed code prompt is the owner changing their mind, not a failure.
      if (!(error instanceof ApprovalCancelledError)) setFailed(true);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && rename.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" showCloseButton={!rename.isPending}>
        <DialogHeader>
          <DialogTitle>{t('rename.title')}</DialogTitle>
          <DialogDescription>{t('rename.description', { name: currentName })}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id={FORM_ID}
            noValidate
            onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="rename-name" required>
                    {t('rename.nameLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="rename-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="rename-reason" required>
                    {t('rename.reasonLabel')}
                  </FormLabel>
                  <FormControl>
                    <Textarea id="rename-reason" rows={3} {...field} />
                  </FormControl>
                  <FormDescription>{t('rename.codeNote')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        {failed && (
          <p role="alert" className="text-caption text-destructive">
            {t('rename.errors.generic')}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={rename.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} loading={rename.isPending}>
            {t('rename.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
