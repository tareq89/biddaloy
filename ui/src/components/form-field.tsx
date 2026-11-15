/**
 * React Hook Form + Zod wiring with no per-field boilerplate. Adapted from
 * shadcn/ui's well-known `form.tsx` pattern (not literal CLI output — this
 * shadcn CLI/registry version has no `form` recipe to `add`, confirmed by
 * running it — so this is hand-authored the same way `primitives/lib/
 * utils.ts` is, per that file's own README note, rather than vendored).
 * Composes `primitives/label.tsx` and Radix's `Slot`, not the CLI's own
 * un-fetchable template.
 *
 * `FormField` binds label, control, help text and error together with
 * correct `aria-describedby`/`aria-invalid` — a field built with `FormItem`
 * + `FormLabel` + `FormControl` + `FormMessage` cannot end up unlabelled or
 * with its error unannounced by accident, which is the single guarantee
 * this component exists for.
 *
 * `focusFirstError(form)` — call it from `handleSubmit`'s invalid callback
 * (`form.handleSubmit(onValid, () => focusFirstError(form))`) to move focus
 * to the first field with an error. It only focuses, never reads or prints
 * a submitted value (Rule 23); the message text comes from the caller's
 * schema or `states.validation.*`. Errors show after submit or once a field
 * is touched (react-hook-form's default `onSubmit` mode), not while typing
 * the first character — `FormMessage` below keeps that behaviour.
 */
import { CircleAlertIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import * as React from 'react';
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { Label } from './label';

const Form = FormProvider;

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName;
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

interface FormItemContextValue {
  id: string;
}

const FormItemContext = React.createContext<FormItemContextValue | null>(null);

function FormItem({ className, ...props }: React.ComponentProps<'div'>) {
  const id = React.useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        className={cn('grid w-full min-w-0 gap-1.5', className)}
        {...props}
      />
    </FormItemContext.Provider>
  );
}

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState(fieldContext ? { name: fieldContext.name } : undefined);

  if (!fieldContext) {
    throw new Error('useFormField must be used within <FormField>');
  }
  if (!itemContext) {
    throw new Error('useFormField must be used within <FormItem>');
  }

  const fieldState = getFieldState(fieldContext.name, formState);
  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

function FormLabel({
  className,
  htmlFor,
  required,
  children,
  helpId,
  helpLabel,
  ...props
}: React.ComponentProps<typeof Label> & {
  required?: boolean | undefined;
  /** A (?) after the label text; a sibling of the label, so clicking the label still focuses the input. */
  helpId?: string | undefined;
  /** Names the (?) when the children are not plain text; defaults to the children. */
  helpLabel?: string | undefined;
}) {
  const { error, formItemId } = useFormField();
  const { t } = useTranslation();
  return (
    <Label
      {...props}
      helpId={helpId}
      helpLabel={helpLabel ?? (typeof children === 'string' ? children : undefined)}
      data-slot="form-label"
      data-error={!!error}
      className={cn(error && 'text-destructive', className)}
      // A caller-supplied `htmlFor` wins over `formItemId` — the opposite
      // of what this used to do (always `formItemId`, no matter what the
      // caller passed). That guaranteed the label/control pairing only
      // when the caller *also* let `FormControl` supply `formItemId` as
      // the control's own id; a caller who sets an explicit `id` on the
      // control instead (needed wherever something outside `FormField`
      // — `FormShellError.field`, `document.getElementById` — has to
      // target that field by a stable, caller-chosen id rather than a
      // `React.useId()` value generated at render time) ended up with an
      // unlabelled control instead, invisible until an actual axe run
      // hits it (#8.7.13 was the first real page to). `FormControl`'s own
      // `id={formItemId}` already loses to a caller-supplied `id` on the
      // control in the same way (Radix `Slot`'s prop merge favors the
      // child's own value) — this makes `FormLabel` follow the same rule
      // instead of being the one piece still hardcoded to `formItemId`.
      htmlFor={htmlFor ?? formItemId}
    >
      {required ? (
        <span>
          {children}
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
          <span className="sr-only">{t('form.required')}</span>
        </span>
      ) : (
        children
      )}
    </Label>
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return (
    <Slot.Root
      {...props}
      data-slot="form-control"
      // After `{...props}`, not before — same reasoning as `FormLabel`'s
      // `htmlFor`: these three are the actual field association/error
      // wiring this component exists to guarantee, so a caller-supplied
      // `id`/`aria-describedby`/`aria-invalid` must not be able to
      // silently override them.
      id={formItemId}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId}
      aria-invalid={!!error}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { formDescriptionId } = useFormField();
  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn('text-caption text-text-secondary', className)}
      {...props}
    />
  );
}

/** `role="alert"` gives the error an implicit assertive live region — a
 * screen reader announces it the moment it mounts, no separate
 * `aria-live` wiring needed. Renders nothing when there's no error and no
 * static `children`, so an empty `<p>` never sits in the DOM as a false
 * "something's here" signal for a screen reader doing element-by-element
 * review. */
function FormMessage({ className, children, ...props }: React.ComponentProps<'p'>) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message ?? '') : children;

  if (!body) return null;

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      role="alert"
      className={cn('flex items-center gap-1 text-caption text-destructive', className)}
      {...props}
    >
      <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
      {body}
    </p>
  );
}

/** Focuses the first field (by error key order) that failed validation; no-op for a valid form. */
function focusFirstError<T extends FieldValues>(
  form: Pick<UseFormReturn<T>, 'formState' | 'setFocus'>,
) {
  const [first] = Object.keys(form.formState.errors);
  if (first) form.setFocus(first as FieldPath<T>);
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  focusFirstError,
  useFormField,
};
