import '@biddaloy/ui/test';

import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdmitCardPicker } from './admit-card-picker';

const student = (id: string, roll: number, section: string, printed: number) => ({
  student_id: id,
  full_name: id,
  roll_number: roll,
  section_name: section,
  printed_copies: printed,
  last_printed_at: null,
  has_dues: null,
});

function setup() {
  server.use(
    http.get('/api/v1/exams/:examId/documents/admit-cards', () =>
      HttpResponse.json({
        withhold_for_dues: false,
        seat_plan_published: true,
        // Out of order on purpose: the picker returns roll order.
        students: [
          student('b2', 2, 'B', 0),
          student('a2', 2, 'A', 1),
          student('a1', 1, 'A', 0),
          student('b1', 1, 'B', 1),
        ],
      }),
    ),
  );
  const onConfirm = vi.fn();
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <AdmitCardPicker examId="exam-1" onClose={vi.fn()} onConfirm={onConfirm} />
    </RegionConfigProvider>,
    { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
  );
  return { ...view, onConfirm };
}

describe('AdmitCardPicker', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('"not printed yet" is preselected and sends only the unprinted ids in roll order', async () => {
    const { user, onConfirm } = setup();
    const remaining = await screen.findByRole('radio', { name: 'Not printed yet (2)' });
    expect(remaining.getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onConfirm).toHaveBeenCalledWith('a1,b2');
  });

  it('"one section" sends only that section', async () => {
    const { user, onConfirm } = setup();
    await user.click(await screen.findByRole('radio', { name: 'One section' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Preview' }).disabled).toBe(true);
    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'B' }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(onConfirm).toHaveBeenCalledWith('b1,b2');
  });

  it('arrow keys move between the choices', async () => {
    const { user } = setup();
    const remaining = await screen.findByRole('radio', { name: 'Not printed yet (2)' });
    remaining.focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'One section' })),
    );
  });
});
