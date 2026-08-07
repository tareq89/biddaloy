import { zodResolver } from '@hookform/resolvers/zod';
import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from '@storybook/test';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Button } from './button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './form-field';
import { Input } from './input';

const meta: Meta<typeof Form> = {
  title: 'Components/FormField',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Form>;

const schema = z.object({
  studentName: z.string().min(1, 'Student name is required'),
});

function DemoForm() {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { studentName: '' },
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void form.handleSubmit(() => {})(event)} className="grid gap-4">
        <FormField
          control={form.control}
          name="studentName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Student name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>As it appears on the birth certificate.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Save</Button>
      </form>
    </Form>
  );
}

export const Default: Story = {
  render: () => <DemoForm />,
};

/** Stands in for this issue's "error" state category — submitting empty
 * triggers Zod's required-field error, rendered via `FormMessage`. */
export const ErrorState: Story = {
  render: () => <DemoForm />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
  },
};

/** Stands in for this issue's "disabled" state category. */
export const Disabled: Story = {
  render: () => {
    function DisabledForm() {
      const form = useForm<z.infer<typeof schema>>({
        defaultValues: { studentName: 'Rahim Uddin' },
      });
      return (
        <Form {...form}>
          <form className="grid gap-4">
            <FormField
              control={form.control}
              name="studentName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Student name</FormLabel>
                  <FormControl>
                    <Input {...field} disabled />
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>
      );
    }
    return <DisabledForm />;
  },
};

export const RightToLeft: Story = {
  render: () => {
    function BanglaForm() {
      const form = useForm<z.infer<typeof schema>>({ defaultValues: { studentName: '' } });
      return (
        <Form {...form}>
          <form className="grid gap-4">
            <FormField
              control={form.control}
              name="studentName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>শিক্ষার্থীর নাম</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>জন্ম নিবন্ধন সনদ অনুযায়ী।</FormDescription>
                </FormItem>
              )}
            />
          </form>
        </Form>
      );
    }
    return <BanglaForm />;
  },
  decorators: [rtlDecorator],
};
