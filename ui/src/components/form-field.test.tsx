import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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

const schema = z.object({
  studentName: z.string().min(1, 'Name is required'),
});

function NameForm({ onSubmit }: { onSubmit: (values: z.infer<typeof schema>) => void }) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { studentName: '' },
  });

  return (
    <Form {...form}>
      <form onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
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
        <button type="submit">Save</button>
      </form>
    </Form>
  );
}

describe('FormField', () => {
  it('links the label to the control via a real association', async () => {
    const { container } = render(<NameForm onSubmit={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Student name' });
    expect(input).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('has no aria-invalid and no error message before submit', () => {
    render(<NameForm onSubmit={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Student name' });
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('on a failed submit, sets aria-invalid, links the error via aria-describedby, and announces it via role=alert', async () => {
    const user = userEvent.setup();
    render(<NameForm onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const input = await screen.findByRole('textbox', { name: 'Student name' });
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Name is required');

    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ')).toContain(alert.id);
  });

  it('calls onSubmit with valid data', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<NameForm onSubmit={onSubmit} />);
    await user.type(screen.getByRole('textbox', { name: 'Student name' }), 'Rahim Uddin');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ studentName: 'Rahim Uddin' }, expect.anything()),
    );
  });

  it('useFormField throws outside a FormField/FormItem — a guardrail against a wrapper misuse, not a UI state', () => {
    // Rendered outside <Form>/<FormField> entirely: useFormContext() itself
    // throws first (a plain RHF error), proving nothing in this file swallows
    // a missing provider.
    function Broken() {
      return (
        <FormItem>
          <FormLabel>orphaned</FormLabel>
        </FormItem>
      );
    }
    expect(() => render(<Broken />)).toThrow();
  });

  it("FormLabel/FormControl throw this file's own error when used outside FormField, even with a real Form provider present", () => {
    function OutsideFormField() {
      const form = useForm({ defaultValues: { studentName: '' } });
      return (
        <Form {...form}>
          <FormItem>
            <FormLabel>orphaned</FormLabel>
          </FormItem>
        </Form>
      );
    }
    expect(() => render(<OutsideFormField />)).toThrow(
      'useFormField must be used within <FormField>',
    );
  });

  it("FormLabel throws this file's own error when used outside FormItem, even inside a real FormField", () => {
    function OutsideFormItem() {
      const form = useForm({ defaultValues: { studentName: '' } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="studentName"
            render={() => <FormLabel>orphaned</FormLabel>}
          />
        </Form>
      );
    }
    expect(() => render(<OutsideFormItem />)).toThrow(
      'useFormField must be used within <FormItem>',
    );
  });
});
