import { zodResolver } from '@hookform/resolvers/zod';
import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from '@storybook/test';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { Button } from '../components/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../components/form-field';
import { Input } from '../components/input';

import { FormSection, FormShell, type FormShellError } from './form-shell';
import {
  applyServerFieldErrors,
  useFormAutosave,
  useFormShellMode,
  useWarnUnsavedChanges,
} from './use-form-shell';

const meta: Meta<typeof FormShell> = {
  title: 'Shells/FormShell',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FormShell>;

const admissionSchema = z.object({
  studentName: z.string().min(1, 'Student name is required'),
  guardianPhone: z.string().min(1, "Guardian's phone number is required"),
});

type AdmissionValues = z.infer<typeof admissionSchema>;

function AdmissionForm() {
  const form = useForm<AdmissionValues>({
    resolver: zodResolver(admissionSchema),
    defaultValues: { studentName: '', guardianPhone: '' },
    ...useFormShellMode(),
  });

  useWarnUnsavedChanges(form.formState.isDirty && !form.formState.isSubmitSuccessful);

  // A simple flat-schema mapping — `admissionSchema` has no nested
  // fields, so `Object.entries` is enough here. A schema with nested
  // objects/arrays (`guardian.phone`, `students.0.name`, ...) needs a
  // recursive flattener instead; `FormShell` itself has no opinion on
  // how a caller produces `FormShellError[]`, only that it receives one.
  const summaryErrors: FormShellError[] = Object.entries(form.formState.errors).map(
    ([field, error]) => ({
      field,
      message: String(error?.message ?? ''),
    }),
  );

  function handleSubmit(values: AdmissionValues) {
    if (values.studentName === 'Rahim Uddin') {
      // Demonstrates server-side field errors mapping onto the right input.
      applyServerFieldErrors(form.setError, {
        studentName: 'A student with this name is already enrolled',
      });
      return;
    }
    // keepIsSubmitSuccessful: reset() otherwise clears isSubmitSuccessful
    // back to false along with everything else, and the success message
    // below exists specifically to demonstrate that state.
    form.reset(values, { keepIsSubmitSuccessful: true });
  }

  return (
    <Form {...form}>
      <FormShell
        title="Admit a student"
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
        {form.formState.isSubmitSuccessful && (
          <p role="status">{form.getValues('studentName')} has been admitted.</p>
        )}
        <FormSection legend="Student details">
          <FormField
            control={form.control}
            name="studentName"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="studentName">Student name</FormLabel>
                <FormControl>
                  <Input id="studentName" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>
        <FormSection legend="Guardian details">
          <FormField
            control={form.control}
            name="guardianPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="guardianPhone">Guardian&rsquo;s phone</FormLabel>
                <FormControl>
                  <Input id="guardianPhone" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>
        <Button type="submit">Admit student</Button>
      </FormShell>
    </Form>
  );
}

export const Default: Story = {
  render: () => <AdmissionForm />,
};

/** Stands in for this issue's "error" state category — submitting empty
 * triggers the error summary at the top, focus moved to it. */
export const ErrorSummary: Story = {
  render: () => <AdmissionForm />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Admit student' }));
  },
};

/** Submitting "Rahim Uddin" simulates a server rejecting the field —
 * `applyServerFieldErrors` maps it onto the same input a client-side
 * validation error would. */
export const ServerFieldError: Story = {
  render: () => <AdmissionForm />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Student name'), 'Rahim Uddin');
    await userEvent.type(canvas.getByLabelText('Guardian’s phone'), '01712345678');
    await userEvent.click(canvas.getByRole('button', { name: 'Admit student' }));
  },
};

/** A name other than "Rahim Uddin" (which the demo's own `handleSubmit`
 * treats as a server rejection) succeeds — the success message replaces
 * nothing, it's additive content inside the same `FormShell`, since a
 * real page usually redirects or shows a toast rather than restyling
 * the form itself. */
export const SuccessfulSubmit: Story = {
  render: () => <AdmissionForm />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Student name'), 'Karim Ahmed');
    await userEvent.type(canvas.getByLabelText('Guardian’s phone'), '01812345678');
    await userEvent.click(canvas.getByRole('button', { name: 'Admit student' }));
  },
};

const AUTOSAVE_KEY = 'form-shell-storybook-demo';

/** Wires `useFormAutosave` into the same admission form: every change
 * (debounced) writes a draft, a banner offers restoring one found on
 * mount, and a successful submit clears it — `clearDraft` (not
 * `discardDraft`) is deliberate here, since this is the "already
 * succeeded" case the two exist to distinguish, even though they're
 * currently the same function. */
function AdmissionFormWithAutosave() {
  const form = useForm<AdmissionValues>({
    resolver: zodResolver(admissionSchema),
    defaultValues: { studentName: '', guardianPhone: '' },
    ...useFormShellMode(),
  });

  const { draftAvailable, restoreDraft, clearDraft } = useFormAutosave(AUTOSAVE_KEY, form.watch(), {
    debounceMs: 300,
  });

  const summaryErrors: FormShellError[] = Object.entries(form.formState.errors).map(
    ([field, error]) => ({ field, message: String(error?.message ?? '') }),
  );

  function handleSubmit(values: AdmissionValues) {
    clearDraft();
    form.reset(values, { keepIsSubmitSuccessful: true });
  }

  return (
    <Form {...form}>
      <FormShell
        title="Admit a student"
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
        {draftAvailable && !form.formState.isSubmitSuccessful && (
          <div role="status" className="rounded-lg border border-border p-3 text-sm">
            A previous draft was found.{' '}
            <button
              type="button"
              className="text-primary underline underline-offset-2"
              onClick={() => {
                const draft = restoreDraft();
                if (draft) form.reset(draft);
              }}
            >
              Restore it
            </button>
          </div>
        )}
        {form.formState.isSubmitSuccessful && (
          <p role="status">{form.getValues('studentName')} has been admitted.</p>
        )}
        <FormSection legend="Student details">
          <FormField
            control={form.control}
            name="studentName"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="autosave-studentName">Student name</FormLabel>
                <FormControl>
                  <Input id="autosave-studentName" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>
        <FormSection legend="Guardian details">
          <FormField
            control={form.control}
            name="guardianPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="autosave-guardianPhone">Guardian&rsquo;s phone</FormLabel>
                <FormControl>
                  <Input id="autosave-guardianPhone" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>
        <Button type="submit">Admit student</Button>
      </FormShell>
    </Form>
  );
}

/** Seeds a draft into `localStorage` before the story mounts, so
 * `AdmissionFormWithAutosave` renders straight into the "draft found"
 * banner rather than needing a play function to type first. */
export const DraftRestore: Story = {
  loaders: [
    () => {
      window.localStorage.setItem(
        `form-shell-draft:${AUTOSAVE_KEY}`,
        JSON.stringify({ studentName: 'Nusrat Jahan', guardianPhone: '01912345678' }),
      );
      return {};
    },
  ],
  render: () => <AdmissionFormWithAutosave />,
};

export const RightToLeft: Story = {
  render: () => (
    <FormShell
      title="একজন শিক্ষার্থী ভর্তি করুন"
      errors={[]}
      submitCount={0}
      onSubmit={(event) => event.preventDefault()}
    >
      <FormSection legend="শিক্ষার্থীর বিবরণ">
        <label htmlFor="rtl-student-name">শিক্ষার্থীর নাম</label>
        <Input id="rtl-student-name" />
      </FormSection>
      <Button type="submit">ভর্তি করুন</Button>
    </FormShell>
  ),
  decorators: [rtlDecorator],
};
