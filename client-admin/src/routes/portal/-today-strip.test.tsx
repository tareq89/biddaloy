import { cleanupTestState, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { renderPortalCard } from './-card-test-utils';
import { TodayStrip } from './-today-strip';

const TODAY = '2026-11-23';
const MONTH = '2026-11';
const A = { id: 'kid-a', fullName: 'Fatima Rahman', meta: 'Class 8 B · Roll 14' };
const B = { id: 'kid-b', fullName: 'Imran Rahman', meta: 'Class 3 A · Roll 7' };

interface DayInput {
  status?: string | null;
  working?: boolean;
  markedAt?: string | null;
}

/** The month of days the server sends, with only 22 and 23 November varying. */
function days({ status = null, working = true, markedAt = null }: DayInput) {
  return ['2026-11-22', TODAY].map((date) => ({
    date,
    // The 22nd is always ABSENT: a strip reading the wrong row would say so.
    status: date === TODAY ? status : 'ABSENT',
    minutes_late: null,
    remarks: null,
    is_working_day: date === TODAY ? working : true,
    holiday_name: null,
    marked_at: date === TODAY ? markedAt : null,
  }));
}

function mock(byChild: Record<string, DayInput>) {
  server.use(
    http.get('/api/v1/attendance/students/:id/days', ({ params }) =>
      HttpResponse.json(days(byChild[String(params.id)] ?? {})),
    ),
  );
}

function renderStrip(children = [A, B], role = 'PARENT') {
  return renderPortalCard(
    <TodayStrip students={children} today={TODAY} month={MONTH} />,
    'en',
    role,
  );
}

describe('TodayStrip', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('child A present, child B absent: text and icon for each', async () => {
    mock({ 'kid-a': { status: 'PRESENT' }, 'kid-b': { status: 'ABSENT' } });
    renderStrip();

    const cards = await screen.findByTestId('today-cards');
    expect(await within(cards).findByText('At school today')).toBeTruthy();
    expect(within(cards).getByText('Absent today')).toBeTruthy();
    // Never colour alone: each status block carries an icon.
    for (const status of within(cards).getAllByText(/At school today|Absent today/)) {
      expect(status.querySelector('svg')).not.toBeNull();
    }
  });

  it.each([
    ['LATE', true, 'Came late today', 'Late'],
    ['LEAVE', true, 'On leave today', 'Leave'],
    [null, true, 'Attendance not taken yet', 'Not taken'],
    [null, false, 'No school today', 'Closed'],
  ] as const)('maps %s (working day: %s) to "%s"', async (status, working, long, short) => {
    mock({ 'kid-a': { status, working } });
    renderStrip([A]);

    const cards = await screen.findByTestId('today-cards');
    expect(await within(cards).findByText(long)).toBeTruthy();
    expect(within(screen.getByTestId('today-rows')).getByText(short)).toBeTruthy();
  });

  it('reads today row, not another day', async () => {
    // The 22nd is ABSENT in the fixture; the strip is for the 23rd.
    mock({ 'kid-a': { status: 'PRESENT' } });
    renderStrip([A]);

    expect(await screen.findByText('At school today')).toBeTruthy();
    expect(screen.queryByText('Absent today')).toBeNull();
  });

  it('shows when attendance was taken, on the school clock', async () => {
    // 02:10 UTC is 08:10 in Dhaka.
    mock({ 'kid-a': { status: 'PRESENT', markedAt: '2026-11-23T02:10:00.000Z' } });
    renderStrip([A]);

    expect((await screen.findAllByText('Attendance was taken at 8:10 AM')).length).toBeGreaterThan(
      0,
    );
  });

  it('says attendance is not taken yet when marked_at is null on a school day', async () => {
    mock({ 'kid-a': { status: null, markedAt: null } });
    renderStrip([A]);

    expect((await screen.findAllByText("Today's attendance has not been taken yet")).length).toBe(
      2,
    );
  });

  it('shows no taken line on a non-school day', async () => {
    mock({ 'kid-a': { status: null, working: false } });
    renderStrip([A]);

    await screen.findByText('No school today');
    expect(screen.queryByText(/Attendance was taken|has not been taken/)).toBeNull();
  });

  it('phone: one card with one row per child', async () => {
    mock({ 'kid-a': { status: 'PRESENT' }, 'kid-b': { status: 'ABSENT' } });
    renderStrip();

    const rows = await screen.findByTestId('today-rows');
    await within(rows).findByText('Present');
    expect(within(rows).getAllByRole('listitem')).toHaveLength(2);
    expect(rows.getAttribute('data-slot')).toBe('card');
  });

  describe('Tell the school [8.10.7.7.06]', () => {
    const tell = () => screen.queryAllByRole('link', { name: 'Tell the school' });

    it('ABSENT: a link to the student-leave form for that child, in both layouts', async () => {
      mock({ 'kid-a': { status: 'PRESENT' }, 'kid-b': { status: 'ABSENT' } });
      renderStrip();
      await screen.findByText('Absent today');
      const links = tell();
      // The desktop card and the phone row each carry one, for the absent child only.
      expect(links).toHaveLength(2);
      for (const l of links) {
        const href = l.getAttribute('href') ?? '';
        expect(href).toContain('/portal/applications/new');
        expect(href).toContain('student=kid-b');
        expect(href).toContain('type=STUDENT_LEAVE');
      }
    });

    it('not marked yet on a school day: shown', async () => {
      mock({ 'kid-a': { status: null } });
      renderStrip([A]);
      await screen.findByText('Attendance not taken yet');
      expect(tell()).toHaveLength(2);
    });

    it.each([
      ['PRESENT', true],
      ['LATE', true],
      ['LEAVE', true],
      [null, false],
    ] as const)('%s (working day: %s): not shown', async (status, working) => {
      mock({ 'kid-a': { status, working } });
      renderStrip([A]);
      await within(await screen.findByTestId('today-rows')).findByRole('listitem');
      await screen.findAllByText(
        /Present|At school|Late|Came late|Leave|On leave|Closed|No school/,
      );
      expect(tell()).toHaveLength(0);
    });

    it('a role without APPLICATION_SUBMIT never sees it', async () => {
      mock({ 'kid-a': { status: 'ABSENT' } });
      renderStrip([A], 'COMMITTEE');
      await screen.findByText('Absent today');
      expect(tell()).toHaveLength(0);
    });

    it('STUDENT holds the permission and sees it', async () => {
      mock({ 'kid-a': { status: 'ABSENT' } });
      renderStrip([A], 'STUDENT');
      await screen.findByText('Absent today');
      expect(tell().length).toBeGreaterThan(0);
    });

    it('is axe clean with the link present, in bn', async () => {
      mock({ 'kid-a': { status: 'ABSENT' } });
      const { container } = renderPortalCard(
        <TodayStrip students={[A]} today={TODAY} month={MONTH} />,
        'bn',
      );
      expect((await screen.findAllByRole('link', { name: 'স্কুলকে জানান' })).length).toBe(2);
      await expect(container).toHaveNoViolations();
    });
  });

  it('renders no heading element and is axe clean', async () => {
    mock({ 'kid-a': { status: 'PRESENT' }, 'kid-b': { status: 'ABSENT' } });
    const { container } = renderStrip();

    await screen.findByText('At school today');
    expect(screen.queryAllByRole('heading')).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Today at school' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });
});
