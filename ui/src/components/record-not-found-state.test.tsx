import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import { cleanupTestState } from '../test';

import { RecordNotFoundState } from './record-not-found-state';

describe('RecordNotFoundState', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the message and a back button, and no retry', async () => {
    const onBack = vi.fn();
    render(<RecordNotFoundState onBack={onBack} />);
    expect(screen.getByRole('status').textContent).toContain('not found');
    expect(screen.queryByRole('button', { name: /try again|retry/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
