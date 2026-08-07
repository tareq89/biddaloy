import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  const { draftAvailable, restoreDraft, discardDraft } = useFormAutosave(
    formKey,
    { studentName: value },
    {
      debounceMs: 10,
    },
  );
  return (
    <div>
      <p>draftAvailable: {String(draftAvailable)}</p>
      <button onClick={() => window.alert(JSON.stringify(restoreDraft()))}>Show draft</button>
      <button onClick={discardDraft}>Discard draft</button>
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
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<AutosaveProbe formKey="admission-form" value="" />);
    screen.getByRole('button', { name: 'Show draft' }).click();
    expect(alertSpy).toHaveBeenCalledWith(JSON.stringify({ studentName: 'Karim' }));
    alertSpy.mockRestore();
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
    const setItemSpy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<AutosaveProbe formKey="admission-form" value="Rahim Uddin" />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(setItemSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('restoreDraft returns undefined when the saved value is not valid JSON', () => {
    window.localStorage.setItem('form-shell-draft:admission-form', 'not json');
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<AutosaveProbe formKey="admission-form" value="" />);
    screen.getByRole('button', { name: 'Show draft' }).click();
    expect(alertSpy).toHaveBeenCalledWith(undefined);
    alertSpy.mockRestore();
  });
});
