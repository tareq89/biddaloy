import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { TemplateDetail } from './-template-detail';

const ROWS = [
  {
    classGrade: 6,
    subjectCode: 'BAN',
    subjectName: 'Bangla',
    components: [
      { name: 'Written', kind: 'WRITTEN', full: 70, pass: 23, sequence: 1 },
      { name: 'MCQ', kind: 'MCQ', full: 30, pass: 10, sequence: 2 },
    ],
  },
  {
    classGrade: 7,
    subjectCode: 'ENG',
    subjectName: 'English',
    components: [{ name: 'Written', kind: 'WRITTEN', full: 100, pass: 33, sequence: 1 }],
  },
];

function mount(
  options: {
    role?: string;
    state?: 'APPLIED' | 'AVAILABLE';
    rows?: unknown[];
    patch?: () => Response;
  } = {},
) {
  const { role = 'ADMIN', state = 'AVAILABLE', rows = [] } = options;
  const patches: unknown[] = [];
  server.use(
    http.get('/api/v1/exam-templates/:id', () =>
      HttpResponse.json({ id: 't1', name: 'Annual', kind: 'TERM', rows }),
    ),
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({ data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } }),
    ),
    http.get('/api/v1/presets/status', () => HttpResponse.json({ state })),
    http.patch('/api/v1/exam-templates/:id', async ({ request }) => {
      patches.push(await request.json());
      return options.patch?.() ?? HttpResponse.json({ id: 't1', name: 'Annual', kind: 'TERM', rows });
    }),
  );
  renderWithProviders(<TemplateDetail templateId="t1" />, {
    locale: 'en',
    role,
    tenantId: 'tenant-1',
  });
  return patches;
}

/** [35.5.2] The preset warning banner on the template detail. */
describe('TemplateDetail preset banner', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows with APPLIED for a viewer holding CURRICULUM_PRESET_APPLY', async () => {
    mount({ state: 'APPLIED' });
    expect(await screen.findByText(/This comes from your ready-made curriculum/)).toBeTruthy();
  });

  it('is absent with AVAILABLE', async () => {
    mount({ state: 'AVAILABLE' });
    await screen.findByText('Annual');
    expect(screen.queryByText(/This comes from your ready-made curriculum/)).toBeNull();
  });

  it('is not mounted without the permission', async () => {
    mount({ role: 'TEACHER', state: 'APPLIED' });
    await screen.findByText('Annual');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/This comes from your ready-made curriculum/)).toBeNull();
  });
});

/** [31.4.exams-3b] Header: facts, unsaved badge, Save / Discard, rename. */
describe('TemplateDetail header', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('has no tab strip and shows the facts in tenant numerals', async () => {
    mount({ rows: ROWS });
    await screen.findByRole('heading', { name: 'Annual' });
    expect(screen.queryByRole('tab', { name: 'Parts' })).toBeNull();
    expect(await screen.findByText('Term')).toBeTruthy();
    expect(screen.getByText('৬, ৭')).toBeTruthy(); // classes
    const fact = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
    expect(fact('Subjects')).toBe('২');
    expect(fact('Parts')).toBe('৩');
  });

  it('Save is the one filled button, disabled until a change; a change shows the unsaved badge', async () => {
    const user = userEvent.setup();
    mount({ rows: ROWS });
    const save = await screen.findByRole<HTMLButtonElement>('button', { name: 'Save' });
    expect(save.getAttribute('data-variant')).toBe('default');
    expect(save.disabled).toBe(true);
    expect(screen.queryByText('Not saved')).toBeNull();

    const name = await screen.findByLabelText('Part name — BAN — Bangla, class 6, row 1');
    await user.type(name, 'X');
    expect(await screen.findByText('Not saved')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false);
  });

  it('Save sends the whole row set', async () => {
    const user = userEvent.setup();
    const patches = mount({ rows: ROWS });
    const name = await screen.findByLabelText('Part name — BAN — Bangla, class 6, row 1');
    await user.type(name, 'X');
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    const sent = (patches[0] as { rows: { classGrade: number; subjectCode: string }[] }).rows;
    expect(sent.map((r) => `${r.classGrade}/${r.subjectCode}`)).toEqual(['6/BAN', '7/ENG']);
  });

  it('a failed save shows the translated message, never the server text', async () => {
    const user = userEvent.setup();
    mount({
      rows: ROWS,
      patch: () => HttpResponse.json({ message: 'db exploded' }, { status: 500 }),
    });
    const name = await screen.findByLabelText('Part name — BAN — Bangla, class 6, row 1');
    await user.type(name, 'X');
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    const alert = await screen.findByText("Couldn't save the changes.");
    expect(alert).toBeTruthy();
    expect(screen.queryByText(/db exploded/)).toBeNull();
  });

  it('More opens the rename dialog', async () => {
    const user = userEvent.setup();
    mount({ rows: ROWS });
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change name and type' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Annual');
  });
});
