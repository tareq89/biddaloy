import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyServerFieldErrors,
  useFormAutosave,
  useFormShellMode,
  useWarnUnsavedChanges,
} from './use-form-shell';

describe('useFormShellMode', () => {
  it("pins validation to onBlur — 'never on every keystroke'", () => {
    expect(useFormShellMode()).toEqual({ mode: 'onBlur', reValidateMode: 'onBlur' });
  });
});

interface AdmissionForm {
  studentName: string;
  guardianPhone: string;
}

function ServerErrorProbe() {
  const form = useForm<AdmissionForm>({ defaultValues: { studentName: '', guardianPhone: '' } });

  return (
    <div>
      <p>studentName error: {form.formState.errors.studentName?.message ?? 'none'}</p>
      <p>guardianPhone error: {form.formState.errors.guardianPhone?.message ?? 'none'}</p>
      <button
        onClick={() =>
          applyServerFieldErrors(form.setError, {
            studentName: 'A student with this name is already enrolled',
          })
        }
      >
        Apply server errors
      </button>
    </div>
  );
}

describe('applyServerFieldErrors', () => {
  it('maps a server error onto the correct field, typed against the form', async () => {
    const user = userEvent.setup();
    render(<ServerErrorProbe />);
    await user.click(screen.getByRole('button', { name: 'Apply server errors' }));
    await waitFor(() =>
      expect(
        screen.getByText('studentName error: A student with this name is already enrolled'),
      ).toBeTruthy(),
    );
    expect(screen.getByText('guardianPhone error: none')).toBeTruthy();
  });
});

function UnsavedChangesProbe({ dirty }: { dirty: boolean }) {
  useWarnUnsavedChanges(dirty);
  return <p>probe</p>;
}

describe('useWarnUnsavedChanges', () => {
  it('calls preventDefault on beforeunload when there are unsaved changes', () => {
    render(<UnsavedChangesProbe dirty />);
    const event = new Event('beforeunload', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('does not warn when there are no unsaved changes', () => {
    render(<UnsavedChangesProbe dirty={false} />);
    const event = new Event('beforeunload', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('stops warning once the component unmounts', () => {
    const { unmount } = render(<UnsavedChangesProbe dirty />);
    unmount();
    const event = new Event('beforeunload', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });
});

function AutosaveProbe({ formKey, value }: { formKey: string; value: string }) {
  const { draftAvailable, restoreDraft, discardDraft, clearDraft } = useFormAutosave(
    formKey,
    { studentName: value },
    {
      debounceMs: 10,
    },
  );
  const [restored, setRestored] = useState<string>('');
  return (
    <div>
      <p>draftAvailable: {String(draftAvailable)}</p>
      <p>restored: {restored}</p>
      <button onClick={() => setRestored(JSON.stringify(restoreDraft()) ?? 'undefined')}>
        Show draft
      </button>
      <button onClick={discardDraft}>Discard draft</button>
      <button onClick={clearDraft}>Clear draft</button>
    </div>
  );
}

describe('useFormAutosave', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('reports no draft available when localStorage is empty', () => {
    render(<AutosaveProbe formKey="admission-form" value="" />);
    expect(screen.getByText('draftAvailable: false')).toBeTruthy();
  });

  it('saves a debounced draft to localStorage', async () => {
    render(<AutosaveProbe formKey="admission-form" value="Rahim Uddin" />);
    await waitFor(() => {
      const raw = window.localStorage.getItem('form-shell-draft:admission-form');
      expect(raw).toBe(JSON.stringify({ studentName: 'Rahim Uddin' }));
    });
  });

  it('draftAvailable becomes true once autosave actually writes a draft, not just on mount', async () => {
    render(<AutosaveProbe formKey="admission-form" value="Rahim Uddin" />);
    expect(screen.getByText('draftAvailable: false')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('draftAvailable: true')).toBeTruthy());
  });

  it('does not rewrite localStorage when the debounced value is unchanged from what was last written', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const { rerender } = render(<AutosaveProbe formKey="admission-form" value="Rahim Uddin" />);
    await waitFor(() => expect(setItemSpy).toHaveBeenCalledTimes(1));

    rerender(<AutosaveProbe formKey="admission-form" value="Rahim Uddin" />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    setItemSpy.mockRestore();
  });

  it('reports a draft available on mount when one already exists in localStorage', () => {
    window.localStorage.setItem(
      'form-shell-draft:admission-form',
      JSON.stringify({ studentName: 'Karim' }),
    );
    render(<AutosaveProbe formKey="admission-form" value="" />);
    expect(screen.getByText('draftAvailable: true')).toBeTruthy();
  });

  it('restoreDraft returns the saved values', () => {
    window.localStorage.setItem(
      'form-shell-draft:admission-form',
      JSON.stringify({ studentName: 'Karim' }),
    );
    render(<AutosaveProbe formKey="admission-form" value="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show draft' }));
    expect(screen.getByText(`restored: ${JSON.stringify({ studentName: 'Karim' })}`)).toBeTruthy();
  });

  it('discardDraft removes the saved draft', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'form-shell-draft:admission-form',
      JSON.stringify({ studentName: 'Karim' }),
    );
    render(<AutosaveProbe formKey="admission-form" value="" />);
    expect(screen.getByText('draftAvailable: true')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(window.localStorage.getItem('form-shell-draft:admission-form')).toBeNull();
    await waitFor(() => expect(screen.getByText('draftAvailable: false')).toBeTruthy());
  });

  it('clearDraft removes the saved draft (direct coverage — not just via its discardDraft alias)', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'form-shell-draft:admission-form',
      JSON.stringify({ studentName: 'Karim' }),
    );
    render(<AutosaveProbe formKey="admission-form" value="" />);
    expect(screen.getByText('draftAvailable: true')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Clear draft' }));
    expect(window.localStorage.getItem('form-shell-draft:admission-form')).toBeNull();
    await waitFor(() => expect(screen.getByText('draftAvailable: false')).toBeTruthy());
  });

  it('two different form keys do not collide', async () => {
    render(<AutosaveProbe formKey="form-a" value="Alpha" />);
    render(<AutosaveProbe formKey="form-b" value="Beta" />);
    await waitFor(() => {
      expect(window.localStorage.getItem('form-shell-draft:form-a')).toBe(
        JSON.stringify({ studentName: 'Alpha' }),
      );
      expect(window.localStorage.getItem('form-shell-draft:form-b')).toBe(
        JSON.stringify({ studentName: 'Beta' }),
      );
    });
  });

  it('fails silently when localStorage.setItem throws (quota exceeded/disabled)', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<AutosaveProbe formKey="admission-form" value="Rahim Uddin" />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(setItemSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('does not crash on mount when localStorage.getItem throws (blocked storage)', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => render(<AutosaveProbe formKey="admission-form" value="" />)).not.toThrow();
    expect(screen.getByText('draftAvailable: false')).toBeTruthy();
    getItemSpy.mockRestore();
  });

  it('discardDraft still resets local state even when localStorage.removeItem throws', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'form-shell-draft:admission-form',
      JSON.stringify({ studentName: 'Karim' }),
    );
    render(<AutosaveProbe formKey="admission-form" value="" />);
    expect(screen.getByText('draftAvailable: true')).toBeTruthy();

    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    // Doesn't throw out of the click handler — if it did, this await
    // itself would reject/throw and fail the test.
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    await waitFor(() => expect(screen.getByText('draftAvailable: false')).toBeTruthy());
    removeItemSpy.mockRestore();
  });

  it('restoreDraft returns undefined when the saved value is not valid JSON', () => {
    window.localStorage.setItem('form-shell-draft:admission-form', 'not json');
    render(<AutosaveProbe formKey="admission-form" value="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show draft' }));
    expect(screen.getByText('restored: undefined')).toBeTruthy();
  });
});
