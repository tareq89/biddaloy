import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcrPrintButton } from './acr-print-button';

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigateMock,
  useRouterState: () => '/staff/u-1/acr',
}));

afterEach(async () => {
  navigateMock.mockClear();
  await cleanupTestState();
});

function setup(role: string, status: 'COMPLETED' | 'INCOMPLETE') {
  return renderWithProviders(<AcrPrintButton assessment={{ id: 'acr-1', status }} />, {
    locale: 'en',
    role,
    tenantId: 'tenant-1',
  });
}

describe('AcrPrintButton', () => {
  it('opens the preview for a completed ACR (ADMIN has ACR_READ and DOCUMENT_PRINT)', async () => {
    const { user } = setup('ADMIN', 'COMPLETED');
    await user.click(await screen.findByRole('button', { name: 'Print ACR' }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/print/preview',
      search: {
        kind: 'ACR_ASSESSMENT',
        subject_type: 'ACR',
        ids: 'acr-1',
        from: '/staff/u-1/acr',
      },
    });
  });

  it('is hidden while the ACR is incomplete', async () => {
    setup('ADMIN', 'INCOMPLETE');
    // The namespace suspends on first render; wait for a settled frame.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Print ACR' })).toBeNull();
  });

  it('is hidden without ACR_READ (ACCOUNTANT can print documents but not read ACRs)', async () => {
    setup('ACCOUNTANT', 'COMPLETED');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Print ACR' })).toBeNull();
  });

  it('is hidden for a role with neither permission (TEACHER)', async () => {
    setup('TEACHER', 'COMPLETED');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Print ACR' })).toBeNull();
  });
});
