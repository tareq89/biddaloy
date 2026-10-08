import '@biddaloy/ui/test';

import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeritDialog } from './merit-dialog';

const push = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ history: { push } }),
}));

describe('MeritDialog', () => {
  afterEach(async () => {
    push.mockReset();
    await cleanupTestState();
  });

  it('section scope + top 2 asks for those candidates and Continue goes to the preview with their ids', async () => {
    const urls: URL[] = [];
    server.use(
      http.get('/api/v1/exams/:examId/documents/merit-candidates', ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json([
          {
            student_id: 's-1',
            full_name: 'A',
            section_name: 'A',
            position: 1,
            section_position: 1,
            gpa: 5,
          },
          {
            student_id: 's-2',
            full_name: 'B',
            section_name: 'A',
            position: 2,
            section_position: 2,
            gpa: 5,
          },
        ]);
      }),
    );
    const { user } = renderWithProviders(
      <RegionConfigProvider value={REGION_BD_EN}>
        <MeritDialog examId="exam-1" open onOpenChange={vi.fn()} />
      </RegionConfigProvider>,
      { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
    );

    await user.click(await screen.findByRole('radio', { name: 'Section position' }));
    const top = screen.getByLabelText('How many top students (1–50)');
    await user.clear(top);
    await user.type(top, '2');

    await waitFor(() => {
      const last = urls.at(-1);
      expect(last?.searchParams.get('scope')).toBe('SECTION');
      expect(last?.searchParams.get('top')).toBe('2');
    });
    await screen.findByText('2 students');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const href = push.mock.calls[0]?.[0] as string;
    expect(href).toContain('kind=MERIT_CERTIFICATE');
    expect(href).toContain('ids=s-1%2Cs-2');
    expect(href).toContain('context_id=exam-1');
  });

  it('blocks Continue for a top outside 1-50', async () => {
    const { user } = renderWithProviders(
      <MeritDialog examId="exam-1" open onOpenChange={vi.fn()} />,
      {
        locale: 'en',
        role: 'ADMIN',
        tenantId: 'school-1',
      },
    );
    const top = await screen.findByLabelText('How many top students (1–50)');
    await user.clear(top);
    await user.type(top, '99');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' }).disabled).toBe(true);
  });
});
