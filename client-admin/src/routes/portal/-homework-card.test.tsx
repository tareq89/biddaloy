import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, server } from '@biddaloy/ui/test';
import { formatDate } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderPortalCard } from './-card-test-utils';
import { HomeworkCard } from './-homework-card';

const KIDS = [
  { id: 'kid-a', fullName: 'Fatima Rahman' },
  { id: 'kid-b', fullName: 'Imran Rahman' },
];

function item(id: string, subject: string, title: string, due: string) {
  return {
    assignment_id: id,
    title,
    description: null,
    subject_name_en: subject,
    subject_name_bn: null,
    assigned_date: '2026-11-20',
    due_date: due,
  };
}

const ITEMS: Record<string, ReturnType<typeof item>[]> = {
  'kid-a': [
    item('a2', 'English', 'Essay', '2026-11-30'),
    item('a1', 'Math', 'Algebra exercise', '2026-11-23'),
  ],
  'kid-b': [
    item('b2', 'Bangla', 'Poem', '2026-12-01'),
    item('b1', 'Science', 'Plants', '2026-11-24'),
  ],
};

function mock(overrides: Partial<Record<string, ReturnType<typeof item>[]>> = {}) {
  const calls: string[] = [];
  server.use(
    http.get('/api/v1/students/:id/homework', ({ params }) => {
      const id = String(params.id);
      calls.push(id);
      return HttpResponse.json({ today: '2026-11-23', items: overrides[id] ?? ITEMS[id] ?? [] });
    }),
  );
  return calls;
}

describe('HomeworkCard', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupTestState();
  });

  it('merges both children by due date, caps at 3 and names the child on each row', async () => {
    // The browser clock is a different day: labels come from the response's `today`.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-05-05T06:00:00Z'));
    mock();
    renderPortalCard(<HomeworkCard students={KIDS} />);

    expect(await screen.findByText('Algebra exercise')).toBeTruthy();
    const titles = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(titles).toHaveLength(3);
    expect(titles[0]).toContain('Math · Fatima');
    expect(titles[0]).toContain('Due today');
    expect(titles[1]).toContain('Science · Imran');
    expect(titles[1]).toContain('Due tomorrow');
    expect(titles[2]).toContain('English · Fatima');
    expect(titles[2]).toContain(`Due ${formatDate('2026-11-30', REGION_BD_EN)}`);
    expect(screen.queryByText('Poem')).toBeNull();
    // Never an id or an ISO date.
    expect(document.body.textContent).not.toMatch(/a1|b1|2026-11-/);
  });

  it('compact value counts only items due today or tomorrow, across children', async () => {
    mock();
    renderPortalCard(<HomeworkCard students={KIDS} />);

    expect(await screen.findByText('2 tasks new')).toBeTruthy();
    expect(screen.getByText("Fatima's Math is due today")).toBeTruthy();
  });

  it('links to the homework page', async () => {
    mock();
    renderPortalCard(<HomeworkCard students={KIDS} />);

    const link = await screen.findByRole('link', { name: 'All homework' });
    expect(link.getAttribute('href')).toBe('/portal/homework');
  });

  it('empty keeps the homework link', async () => {
    mock({ 'kid-a': [], 'kid-b': [] });
    renderPortalCard(<HomeworkCard students={KIDS} />);

    expect(await screen.findByText('No homework due.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All homework' })).toBeTruthy();
  });

  it('error then Retry refetches both children', async () => {
    let fail = true;
    const calls: string[] = [];
    server.use(
      http.get('/api/v1/students/:id/homework', ({ params }) => {
        calls.push(String(params.id));
        return fail
          ? HttpResponse.json({ message: 'no' }, { status: 403 })
          : HttpResponse.json({ today: '2026-11-23', items: [] });
      }),
    );
    renderPortalCard(<HomeworkCard students={KIDS} />);

    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    calls.length = 0;
    await userEvent.click(retry);
    await waitFor(() => expect(new Set(calls)).toEqual(new Set(['kid-a', 'kid-b'])));
    expect(await screen.findByText('No homework due.')).toBeTruthy();
  });

  it('renders no h1 and exposes its title as h2', async () => {
    mock();
    renderPortalCard(<HomeworkCard students={KIDS} />);

    await screen.findByText('Algebra exercise');
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(screen.getAllByRole('heading', { level: 2, name: /Today's homework/ }).length).toBe(2);
  });

  it('is axe clean', async () => {
    mock();
    const { container } = renderPortalCard(<HomeworkCard students={KIDS} />);

    await screen.findByText('Algebra exercise');
    await expect(container).toHaveNoViolations();
  });
});
