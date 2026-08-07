import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

/** Models a caller like `applyServerFieldErrors` being invoked after an
 * `await` — `submitCount` increments in one render, `errors` populates
 * in a later, separate one, rather than both landing in the same
 * commit the way `Controlled`'s synchronous validation does. */
function AsyncErrorsControlled() {
  const [submitCount, setSubmitCount] = useState(0);
  const [errors, setErrors] = useState<FormShellError[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitCount((count) => count + 1);
    await Promise.resolve();
    setErrors([{ field: 'student-name', message: 'Student name is required' }]);
  }

  return (
    <FormShell
      title="Admit a student"
      errors={errors}
      submitCount={submitCount}
      onSubmit={(event) => void handleSubmit(event)}
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

  it('each summary entry also scrolls its field into view, not just focuses it', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('alert');

    const field = screen.getByLabelText('Student name');
    const scrollSpy = vi.spyOn(field, 'scrollIntoView');
    await user.click(screen.getByRole('link', { name: 'Student name is required' }));
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'center' });
  });

  it('still focuses the summary when errors arrive in a later render than the submitCount increment', async () => {
    const user = userEvent.setup();
    render(<AsyncErrorsControlled />);
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    const summary = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(summary));
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

  it('two FormShells rendered at once use distinct heading ids, not a hardcoded one', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Controlled />
        <Controlled />
      </>,
    );
    const submitButtons = screen.getAllByRole('button', { name: 'Submit' });
    await user.click(submitButtons[0]!);
    await user.click(submitButtons[1]!);

    const summaries = await screen.findAllByRole('alert');
    expect(summaries).toHaveLength(2);
    const headingIds = summaries.map((summary) => summary.getAttribute('aria-labelledby'));
    expect(headingIds[0]).toBeTruthy();
    expect(headingIds[0]).not.toBe(headingIds[1]);
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
