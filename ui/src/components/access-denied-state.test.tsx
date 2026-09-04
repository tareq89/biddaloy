import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState } from '../test';
import { renderWithProviders } from '../test/render-with-providers';

import { AccessDeniedState } from './access-denied-state';

/** Forces English and waits for the bundle, since the app's default
 * locale is Bengali — same pattern `cached-data-notice.test.tsx` uses. */
async function renderInEnglish(
  ui: Parameters<typeof renderWithProviders>[0],
): Promise<ReturnType<typeof renderWithProviders>> {
  const result = renderWithProviders(ui, { locale: 'en' });
  await result.localeReady;
  return result;
}

describe('AccessDeniedState', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders exactly one heading, the i18n default title', async () => {
    await renderInEnglish(<AccessDeniedState />);

    expect(
      screen.getByRole('heading', { level: 1, name: "You don't have access to this page." }),
    ).toBeTruthy();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('announces politely, not as alert — a refusal is not an application fault', async () => {
    await renderInEnglish(<AccessDeniedState />);

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('omits the action button unless the caller supplies onAction', async () => {
    const { rerender } = await renderInEnglish(<AccessDeniedState />);
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<AccessDeniedState onAction={() => {}} />);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('fires onAction when the action button is clicked', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    await renderInEnglish(<AccessDeniedState onAction={onAction} />);

    await user.click(screen.getByRole('button', { name: 'Back to dashboard' }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('lets title/explanation/actionLabel props override the i18n defaults', async () => {
    await renderInEnglish(
      <AccessDeniedState
        title="Custom title"
        explanation="Custom explanation"
        actionLabel="Custom action"
        onAction={() => {}}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Custom title' })).toBeTruthy();
    expect(screen.getByText('Custom explanation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Custom action' })).toBeTruthy();
    expect(screen.queryByText("You don't have access to this page.")).toBeNull();
  });

  it('renders the Bengali default copy under the bn locale', async () => {
    const result = renderWithProviders(<AccessDeniedState />, { locale: 'bn' });
    await result.localeReady;

    expect(
      screen.getByRole('heading', { level: 1, name: 'এই পাতাটি দেখার অনুমতি আপনার নেই।' }),
    ).toBeTruthy();
  });

  it('is axe clean', async () => {
    const { container } = await renderInEnglish(<AccessDeniedState onAction={() => {}} />);

    await expect(container).toHaveNoViolations();
  });
});
