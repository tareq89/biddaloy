import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FormEvent } from 'react';
import { describe, expect, it } from 'vitest';

import { FormShell, FormSection, type FormShellError } from './form-shell';

function Controlled() {
  const [submitCount, setSubmitCount] = useState(0);
  const [errors, setErrors] = useState<FormShellError[]>([]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitCount((count) => count + 1);
    const formData = new FormData(event.currentTarget);
    const nameValue = formData.get('name');
    const name = typeof nameValue === 'string' ? nameValue : '';
    setErrors(
      name.trim() === '' ? [{ field: 'student-name', message: 'Student name is required' }] : [],
    );
  }

  return (
    <FormShell
      title="Admit a student"
      errors={errors}
      submitCount={submitCount}
      onSubmit={handleSubmit}
    >
      <FormSection legend="Student details">
        <label htmlFor="student-name">Student name</label>
        <input id="student-name" name="name" />
      </FormSection>
      <button type="submit">Submit</button>
    </FormShell>
  );
}

describe('FormShell', () => {
  it('renders the title and a fieldset/legend section', () => {
    render(<Controlled />);
    expect(screen.getByRole('heading', { name: 'Admit a student' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Student details' })).toBeTruthy();
  });

  it('shows no error summary before a failed submit', () => {
    render(<Controlled />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('on submit failure, renders an error summary and moves focus to it', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toContain('There is 1 problem');
    await waitFor(() => expect(document.activeElement).toBe(summary));
  });

  it('each summary entry links to and focuses its field', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('link', { name: 'Student name is required' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Student name')));
  });

  it('re-submitting with the same error still re-focuses the summary', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const summary = await screen.findByRole('alert');

    // Move focus elsewhere, then submit again with the same invalid state.
    screen.getByLabelText('Student name').focus();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(document.activeElement).toBe(summary));
  });

  it('fixing the error and resubmitting clears the summary', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('alert');

    await user.type(screen.getByLabelText('Student name'), 'Rahim Uddin');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('is axe clean, including with an error summary shown', async () => {
    const user = userEvent.setup();
    const { container } = render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('alert');
    await expect(container).toHaveNoViolations();
  });
});

describe('FormSection', () => {
  it('renders a native fieldset/legend pair', () => {
    render(
      <FormSection legend="Guardian details">
        <p>fields</p>
      </FormSection>,
    );
    const fieldset = screen.getByRole('group', { name: 'Guardian details' });
    expect(fieldset.tagName).toBe('FIELDSET');
    expect(screen.getByText('Guardian details').tagName).toBe('LEGEND');
  });

  it('is axe clean', async () => {
    const { container } = render(
      <FormSection legend="Guardian details">
        <label htmlFor="phone">Phone</label>
        <input id="phone" />
      </FormSection>,
    );
    await expect(container).toHaveNoViolations();
  });
});
