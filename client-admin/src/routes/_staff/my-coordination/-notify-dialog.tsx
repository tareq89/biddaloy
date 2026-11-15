/**
 * [83.4.1] "Notify teachers" (Epic 83 D8, D24): every teacher of the class is pre-checked, the
 * coordinator unticks the ones they do not want and writes one message (≤ 500 characters).
 * The server builds the title and drops anyone outside the coordinator's classes; a 422 (nobody
 * left) shows its fixed sentence beside Send.
 *
 * Opened by the card's button and by the palette action `coordination.notify-teachers`
 * (`/my-coordination?then=notify`).
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  Dialog,
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
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { useNotifyCoordinatedTeachers, type CoordinationTeacher } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { ErrorText } from '../classes/-dialog-kit';

export const MESSAGE_MAX = 500;

export function NotifyTeachersDialog({
  open,
  onOpenChange,
  teachers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teachers: CoordinationTeacher[];
}) {
  const { t } = useTranslation('coordination');
  const notify = useNotifyCoordinatedTeachers();
  const [checked, setChecked] = React.useState<string[]>([]);
  const form = useForm<{ message: string }>({ defaultValues: { message: '' } });
  const message = form.watch('message');
  const [validationError, setValidationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setChecked(teachers.map((teacher) => teacher.user_id));
    form.reset({ message: '' });
    setValidationError(null);
    notify.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  function toggle(userId: string, on: boolean) {
    setChecked((prev) => (on ? [...prev, userId] : prev.filter((id) => id !== userId)));
  }

  function handleSubmit({ message }: { message: string }) {
    if (notify.isPending) return;
    if (checked.length === 0) {
      setValidationError(t('notifyDialog.errorPickOne'));
      return;
    }
    setValidationError(null);
    notify.mutate(
      { userIds: checked, message: message.trim() },
      {
        onSuccess: (result) => {
          toast.success(t('notifyDialog.sentToast', { count: result.recipient_count }));
          onOpenChange(false);
        },
      },
    );
  }

  const apiError = notify.error instanceof ApiError ? notify.error : null;
  const nobody = notify.isError && apiError?.statusCode === 422;

  return (
    <Dialog open={open} onOpenChange={(next) => !notify.isPending && onOpenChange(next)}>
      <DialogContent size="md">
        <Form {...form}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit(handleSubmit, () => form.setFocus('message'))(event);
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>{t('notifyDialog.title')}</DialogTitle>
              <DialogDescription>{t('notifyDialog.description')}</DialogDescription>
            </DialogHeader>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-label text-text-primary">
                {t('notifyDialog.teachersLabel')}
              </legend>
              <p className="text-caption text-text-secondary">{t('notifyDialog.allPreChecked')}</p>
              <ul className="max-h-64 overflow-y-auto">
                {teachers.map((teacher) => (
                  <li key={teacher.user_id}>
                    <label className="flex min-h-11 items-center gap-3 md:min-h-8">
                      <Checkbox
                        checked={checked.includes(teacher.user_id)}
                        onCheckedChange={(on) => toggle(teacher.user_id, on === true)}
                      />
                      <span>
                        {teacher.full_name}
                        <span className="ml-2 text-caption text-text-secondary">
                          {teacher.section_names.join(', ')}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <FormField
              control={form.control}
              name="message"
              rules={{
                validate: (v) => v.trim().length > 0 || t('notifyDialog.errorMessage'),
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('notifyDialog.messageLabel')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      maxLength={MESSAGE_MAX}
                      rows={4}
                      placeholder={t('notifyDialog.messagePlaceholder')}
                    />
                  </FormControl>
                  <FormMessage />
                  <span className="self-end text-caption text-text-secondary" aria-live="polite">
                    {t('notifyDialog.counter', { count: message.length, max: MESSAGE_MAX })}
                  </span>
                </FormItem>
              )}
            />

            {validationError && <ErrorText>{validationError}</ErrorText>}
            {notify.isError && (
              <ErrorText>
                {nobody ? t('notifyDialog.errorNobody') : t('notifyDialog.errorGeneric')}
              </ErrorText>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={notify.isPending}
                onClick={() => onOpenChange(false)}
              >
                {t('notifyDialog.cancel')}
              </Button>
              <Button type="submit" loading={notify.isPending}>
                {notify.isPending ? t('notifyDialog.sending') : t('notifyDialog.send')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
