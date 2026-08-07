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
import { applyServerFieldErrors, useFormShellMode, useWarnUnsavedChanges } from './use-form-shell';

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
    form.reset(values);
  }

  return (
    <Form {...form}>
      <FormShell
        title="Admit a student"
        errors={summaryErrors}
        submitCount={form.formState.submitCount}
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
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
