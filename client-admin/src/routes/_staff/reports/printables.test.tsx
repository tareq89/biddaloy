import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const { REGISTER, HISTORY, TO_PRINT, OPEN_REGISTER } = vi.hoisted(() => ({
  REGISTER: 'register',
  HISTORY: 'history',
  TO_PRINT: 'to-print',
  OPEN_REGISTER: 'open-register',
}));

// The three bodies have their own tests; here only the ROUTE (its search and tab choice) is under test.
vi.mock('../../../components/print/history/print-history-page', () => ({
  PrintHistoryPage: ({ tabs }: { tabs: React.ReactNode }) => (
    <>
      <div data-testid="body">{HISTORY}</div>
      {tabs}
    </>
  ),
}));
vi.mock('../../../components/print/history/certificate-register', () => ({
  CertificateRegister: ({ search }: { search: { year?: number } }) => (
    <div data-testid="body">{`${REGISTER}:${search.year ?? 'all'}`}</div>
  ),
  currentYear: () => 2026,
}));
vi.mock('../../../components/print/history/to-print', () => ({
  ToPrint: () => <div data-testid="body">{TO_PRINT}</div>,
}));
vi.mock('../../../components/print/history/printables-tabs', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../components/print/history/printables-tabs')>();
  return {
    ...actual,
    PrintablesTabs: ({
      onChange,
    }: {
      onChange: (tab: 'history' | 'register' | 'to-print') => void;
    }) => (
      <button type="button" onClick={() => onChange('register')}>
        {OPEN_REGISTER}
      </button>
    ),
  };
});

const render = (path: string, role: UserRole = UserRole.ADMIN) =>
  renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

describe('/reports/printables tabs', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('no tab opens the history', async () => {
    render('/reports/printables');
    expect((await screen.findByTestId('body')).textContent).toBe('history');
  });

  it('the palette link ?tab=to-print lands on To print', async () => {
    render('/reports/printables?tab=to-print');
    expect(await screen.findByText('to-print')).toBeTruthy();
  });

  it('the palette link ?tab=register lands on the register, opened on this year', async () => {
    const { router } = render('/reports/printables?tab=register');
    expect(await screen.findByText('register:2026')).toBeTruthy();
    expect(router.state.location.search).toMatchObject({ tab: 'register', year: 2026 });
  });

  it('an explicit year in the URL is kept', async () => {
    render('/reports/printables?tab=register&year=2025');
    expect(await screen.findByText('register:2025')).toBeTruthy();
  });

  it('a nonsense tab falls back to the history', async () => {
    render('/reports/printables?tab=nope');
    expect((await screen.findByTestId('body')).textContent).toBe('history');
  });

  it('To print falls back to the history for an EXECUTIVE', async () => {
    render('/reports/printables?tab=to-print', UserRole.EXECUTIVE);
    expect((await screen.findByTestId('body')).textContent).toBe('history');
  });

  it('switching tabs puts ?tab in the URL', async () => {
    const { router } = render('/reports/printables');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'open-register' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: 'register' }));
  });
});
