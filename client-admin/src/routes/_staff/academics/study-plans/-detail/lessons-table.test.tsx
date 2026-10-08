import type { SyllabusTopic } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LessonsTable, type LessonsTableProps } from './lessons-table';
import { lessonItems, planFactory, scheduleFactory, scheduleLesson } from './test-fixtures';
import { useSaveLessons } from './use-save-lessons';

const API = '/api/v1/study-plans/plan-1/lessons';

function mockPut() {
  const bodies: { lessons: { id: string; periods: number }[] }[] = [];
  server.use(
    http.put(API, async ({ request }) => {
      const body = (await request.json()) as (typeof bodies)[number];
      bodies.push(body);
      return HttpResponse.json(planFactory({ lessons: body.lessons as never }));
    }),
  );
  return bodies;
}

type TableProps = Omit<LessonsTableProps, 'save' | 'isPending'>;

function Harness(props: TableProps) {
  const { save, isPending } = useSaveLessons('plan-1');
  return <LessonsTable save={save} isPending={isPending} {...props} />;
}

function renderTable(props: Partial<TableProps> = {}) {
  const lessons = props.lessons ?? lessonItems(3);
  return renderWithProviders(
    <Harness
      lessons={lessons}
      schedule={undefined}
      topics={[]}
      examMarkers={[]}
      editable
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    />,
    { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
  );
}

function rowFor(title: string): HTMLElement {
  return screen.getByText(title).closest('tr') as HTMLElement;
}

describe('LessonsTable', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanupTestState();
  });

  it('Alt+ArrowDown swaps two rows, sends the whole list and keeps focus on the moved row', async () => {
    const bodies = mockPut();
    const { user } = renderTable();

    await screen.findByRole('table');
    rowFor('Lesson 2').focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.lessons.map((l) => l.id)).toEqual(['l1', 'l3', 'l2']);
    await waitFor(() => expect(document.activeElement).toBe(rowFor('Lesson 2')));
    expect(screen.getByText(/^Moved 'Lesson 2' to position /)).toBeTruthy();
  });

  it('Alt+ArrowUp on the first row and a plain ArrowDown do nothing', async () => {
    const bodies = mockPut();
    const { user } = renderTable();

    await screen.findByRole('table');
    rowFor('Lesson 1').focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await user.keyboard('{ArrowDown}');

    expect(bodies).toHaveLength(0);
  });

  it('the buttons move a lesson and are disabled while the PUT is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bodies: unknown[] = [];
    server.use(
      http.put(API, async ({ request }) => {
        bodies.push(await request.json());
        await gate;
        return HttpResponse.json(planFactory());
      }),
    );
    const { user } = renderTable();

    await user.click(screen.getByRole('button', { name: 'Move Lesson 1 down' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    const buttons = screen.getAllByRole('button', { name: /^Move .* (up|down)$/ });
    for (const button of buttons) expect(button.matches(':disabled')).toBe(true);
    release();
  });

  it('shows a span as a date range and flags an extra class', () => {
    renderTable({
      schedule: scheduleFactory([
        scheduleLesson('l1', 'UPCOMING', {
          expected_date: '2026-03-02',
          expected_end_date: '2026-03-04',
        }),
        scheduleLesson('l2', 'UPCOMING', { in_extra_class: true }),
        scheduleLesson('l3', 'UPCOMING', { overflow: true, expected_date: null }),
      ]),
    });

    expect(within(rowFor('Lesson 1')).getByText(/2nd.*4th March/)).toBeTruthy();
    expect(within(rowFor('Lesson 2')).getByText('in an extra class')).toBeTruthy();
    expect(within(rowFor('Lesson 3')).getByText("Won't fit this term")).toBeTruthy();
  });

  it('renders a marker row after its lesson with the taught count, and no edit without onEditMarker', () => {
    const props = {
      lessons: lessonItems(3),
      examMarkers: [{ exam_id: 'e1', up_to_lesson_id: 'l2', exam_name: 'Half-yearly' }],
      schedule: scheduleFactory([
        scheduleLesson('l1', 'DONE'),
        scheduleLesson('l2', 'DONE'),
        scheduleLesson('l3', 'UPCOMING'),
      ]),
    };
    const { unmount } = renderTable(props);

    expect(screen.getByText('Half-yearly syllabus up to here')).toBeTruthy();
    expect(screen.getByText('lessons 1–2 · 2 taught')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    const markerIndex = rows.findIndex((r) => r.textContent?.includes('syllabus up to here'));
    expect(rows[markerIndex - 1]?.textContent).toContain('Lesson 2');
    expect(screen.queryByRole('button', { name: 'Set exam syllabus marker' })).toBeNull();
    unmount();

    const onEditMarker = vi.fn();
    renderTable({ ...props, onEditMarker });
    expect(screen.getByRole('button', { name: 'Set exam syllabus marker' })).toBeTruthy();
  });

  it('collapses a long done run into one expandable button', async () => {
    const lessons = lessonItems(25);
    const { user } = renderTable({
      lessons,
      schedule: scheduleFactory(
        lessons.map((l, i) => scheduleLesson(l.id, i < 20 ? 'DONE' : 'UPCOMING')),
      ),
    });

    const button = screen.getByRole('button', { name: 'Show lessons 1–17 · all done' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Lesson 1')).toBeNull();

    await user.click(button);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Lesson 1')).toBeTruthy();
  });

  it('collapses lessons far after the current one', async () => {
    const lessons = lessonItems(30);
    const { user } = renderTable({
      lessons,
      schedule: scheduleFactory(
        lessons.map((l, i) => scheduleLesson(l.id, i === 0 ? 'IN_PROGRESS' : 'UPCOMING')),
      ),
    });

    const button = screen.getByRole('button', { name: 'Show 19 more lessons (12–30)' });
    expect(screen.queryByText('Lesson 30')).toBeNull();
    await user.click(button);
    expect(screen.getByText('Lesson 30')).toBeTruthy();
  });

  it('shows a dash for a topic the list no longer has, and the topic name otherwise', () => {
    const lessons = lessonItems(2).map((l, i) => ({ ...l, topic_id: i === 0 ? 'gone' : 't-1' }));
    renderTable({ lessons, topics: [{ id: 't-1', name: 'Decimals' } as SyllabusTopic] });

    expect(within(rowFor('Lesson 1')).getAllByText('—')).toBeTruthy();
    expect(within(rowFor('Lesson 2')).getByText('Decimals')).toBeTruthy();
  });

  it('read-only: no reorder or row actions', () => {
    renderTable({ editable: false });
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
    expect(rowFor('Lesson 1').getAttribute('tabindex')).toBeNull();
  });

  it('phone layout renders cards with labelled 44px buttons', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: true,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    renderTable();

    expect(screen.queryByRole('table')).toBeNull();
    const down = screen.getByRole('button', { name: 'Move Lesson 1 down' });
    expect(down.className).toContain('size-11');
    expect(screen.getByRole('button', { name: 'Edit lesson: Lesson 1' }).className).toContain(
      'size-11',
    );
  });
});
