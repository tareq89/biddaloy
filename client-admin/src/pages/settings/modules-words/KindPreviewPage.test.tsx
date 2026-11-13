import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WithTestRouter } from '../with-test-router';

import { COACHING_CHANGES, KIND_FIXTURES, NO_CHANGES } from './kind-fixtures';
import { KindPreviewPage } from './KindPreviewPage';

const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: 'school-1' };

function mockApi(changes = COACHING_CHANGES) {
  const apply = vi.fn<(key: string | null) => void>();
  server.use(
    http.get('/api/v1/institution-kinds', () => HttpResponse.json(KIND_FIXTURES)),
    http.post('/api/v1/institution-kinds/:id/preview', () => HttpResponse.json(changes)),
    http.post('/api/v1/institution-kinds/:id/apply', ({ request }) => {
      apply(request.headers.get('Idempotency-Key'));
      return HttpResponse.json(changes);
    }),
  );
  return apply;
}

function renderPage(onClose = vi.fn()) {
  const view = renderWithProviders(
    <WithTestRouter>
      <KindPreviewPage kindId="coaching" onClose={onClose} />
    </WithTestRouter>,
    opts,
  );
  return { ...view, onClose };
}

const serverError = { statusCode: 400, message: 'Unknown institution kind.', requestId: 'r' };

describe('KindPreviewPage', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the title, the reassurance and what will change', async () => {
    mockApi();
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Institution kind: Coaching centre' }),
    ).toBeTruthy();
    expect(
      await screen.findByText(/This is only a preview\. Nothing has changed yet\./),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Will be On' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Will be Off' })).toBeTruthy();
    expect(screen.getByText('Fines')).toBeTruthy();
    expect(screen.getByText('Fees')).toBeTruthy();
    // Words: now → will be, both languages.
    expect(screen.getByText('Batch / ব্যাচ')).toBeTruthy();
    expect(screen.getByText('Course / কোর্স')).toBeTruthy();
  });

  it('Apply sends one POST with an Idempotency-Key, toasts and closes', async () => {
    const apply = mockApi();
    const { user, onClose } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a failed Apply stays on the preview with a fixed sentence and never retries by itself', async () => {
    const apply = vi.fn();
    mockApi();
    server.use(
      http.post('/api/v1/institution-kinds/:id/apply', () => {
        apply();
        return HttpResponse.json(serverError, { status: 400 });
      }),
    );
    const { user, onClose } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Apply' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not apply this. Nothing was changed. Try again.');
    // The server's own text is never shown.
    expect(screen.queryByText(/Unknown institution kind/)).toBeNull();
    // Give any stray automatic retry time to fire.
    await new Promise((r) => setTimeout(r, 400));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
  });

  it('a network error on Apply shows the same fixed sentence and does not retry', async () => {
    const apply = vi.fn();
    mockApi();
    server.use(
      http.post('/api/v1/institution-kinds/:id/apply', () => {
        apply();
        return HttpResponse.error();
      }),
    );
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Apply' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not apply this. Nothing was changed. Try again.',
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('with nothing to change, says so and Apply is disabled', async () => {
    mockApi(NO_CHANGES);
    renderPage();

    expect(await screen.findByText(/already match Coaching centre/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
  });

  it('a failed preview shows a fixed error and no Apply target', async () => {
    mockApi();
    server.use(
      http.post('/api/v1/institution-kinds/:id/preview', () =>
        HttpResponse.json(serverError, { status: 400 }),
      ),
    );
    renderPage();

    expect(await screen.findByText('Could not show this preview. Try again.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
  });

  it('Cancel closes without calling apply', async () => {
    const apply = mockApi();
    const { user, onClose } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });
});
