import type { PublicHolidaySet } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HolidaySetEditor, type HolidaySetEditorProps } from './-holiday-set-editor';

afterEach(cleanupTestState);

const BASE_SET = {
  id: 'set-1',
  country: 'BD',
  year: 2026,
  source: 'NAGER_DATE',
  published_at: null,
  fetched_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  entries: [
    {
      id: 'entry-1',
      set_id: 'set-1',
      date: '2026-02-21',
      end_date: '2026-02-21',
      name: 'International Mother Language Day',
      name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
    },
  ],
} as unknown as PublicHolidaySet;

function baseProps(overrides: Partial<HolidaySetEditorProps> = {}): HolidaySetEditorProps {
  return {
    set: BASE_SET,
    onSave: vi.fn(),
    isSaving: false,
    saveError: null,
    saveSucceeded: false,
    onPublish: vi.fn(),
    onUnpublish: vi.fn(),
    isPublishing: false,
    isUnpublishing: false,
    publishError: null,
    unpublishError: null,
    ...overrides,
  };
}

function renderEditor(overrides: Partial<HolidaySetEditorProps> = {}) {
  const props = baseProps(overrides);
  const view = renderWithProviders(<HolidaySetEditor {...props} />, { locale: 'en' });
  return { ...view, props };
}

describe('HolidaySetEditor', () => {
  it('adds a blank row when "Add holiday" is clicked', async () => {
    const { user } = renderEditor();

    await screen.findByDisplayValue('International Mother Language Day');
    expect(screen.getAllByLabelText('Name')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Add holiday' }));

    expect(screen.getAllByLabelText('Name')).toHaveLength(2);
  });

  it('removes a row when its "Remove" button is clicked', async () => {
    const { user } = renderEditor();

    await screen.findByDisplayValue('International Mother Language Day');
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.queryByDisplayValue('International Mother Language Day')).toBeNull();
  });

  it('shows the empty message once every row is removed', async () => {
    const { user } = renderEditor();

    await screen.findByDisplayValue('International Mother Language Day');
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('No entries yet — add one below.')).toBeTruthy();
  });

  it('shows a save error message', async () => {
    renderEditor({ saveError: new Error('boom') });
    expect(await screen.findByText('Could not save these entries.')).toBeTruthy();
  });

  it('shows publish and unpublish error messages', async () => {
    renderEditor({ publishError: new Error('boom'), unpublishError: new Error('boom') });
    expect(await screen.findByText('Could not publish this set.')).toBeTruthy();
    expect(await screen.findByText('Could not unpublish this set.')).toBeTruthy();
  });

  it('opens the publish dialog, and confirming it calls onPublish', async () => {
    const { user, props } = renderEditor();

    await user.click(screen.getByRole('button', { name: 'Publish' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    expect(props.onPublish).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the publish dialog, and cancelling it does not call onPublish', async () => {
    const { user, props } = renderEditor();

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(props.onPublish).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the unpublish dialog, and confirming it calls onUnpublish', async () => {
    const { user, props } = renderEditor({
      set: { ...BASE_SET, published_at: '2026-01-05T00:00:00.000Z' },
    });

    await user.click(screen.getByRole('button', { name: 'Unpublish' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Unpublish' }));

    expect(props.onUnpublish).toHaveBeenCalled();
  });

  it('disables the publish toggle while there are unsaved changes, with a hint', async () => {
    const { user } = renderEditor();

    await user.click(screen.getByRole('button', { name: 'Add holiday' }));

    const toggle = screen.getByRole('button', { name: 'Publish' });
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(toggle.getAttribute('title')).toBe('Save your changes before publishing.');
  });
});
