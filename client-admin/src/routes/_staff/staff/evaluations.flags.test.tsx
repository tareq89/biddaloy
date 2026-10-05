import { Permission } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

// No real role has ACR_READ without ACR_WRITE, so denial is simulated.
const denyWrite = vi.hoisted(() => ({ value: false }));
vi.mock('@biddaloy/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/hooks')>();
  return {
    ...actual,
    useHasPermission: (p: Permission) =>
      !(denyWrite.value && p === Permission.ACR_WRITE) && actual.useHasPermission(p),
  };
});

afterEach(async () => {
  denyWrite.value = false;
  await cleanupTestState();
});

function mount(search: string) {
  return renderWithRouter(routeTree, {
    initialEntries: [`/staff/evaluations?${search}`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('evaluations palette flags', () => {
  it.each([
    ['reportIncident=1', 'Report an incident'],
    ['startAcr=1', 'Start an ACR'],
  ])('?%s opens its dialog for ACR_WRITE and clears the flag', async (search, title) => {
    const { router } = mount(search);
    expect(await screen.findByRole('dialog', { name: title }, { timeout: 4000 })).toBeTruthy();
    await waitFor(() =>
      expect(router.state.location.search).not.toHaveProperty(search.split('=')[0]!),
    );
  });

  it.each(['reportIncident=1', 'startAcr=1', 'publishSurvey=1'])(
    '?%s opens nothing without ACR_WRITE and is stripped',
    async (search) => {
      denyWrite.value = true;
      const { router } = mount(search);
      await screen.findByRole('tab', { name: 'ACR' });
      await waitFor(() =>
        expect(router.state.location.search).not.toHaveProperty(search.split('=')[0]!),
      );
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );

  it('?publishSurvey=1 keeps the param and shows the full-page survey form for ACR_WRITE', async () => {
    const { router } = mount('publishSurvey=1');
    expect(
      await screen.findByRole('dialog', { name: 'New teacher survey' }, { timeout: 4000 }),
    ).toBeTruthy();
    expect(router.state.location.search).toHaveProperty('publishSurvey');
  });
});
