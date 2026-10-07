import '@biddaloy/ui/test';

import { useTranslation } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TemplateGrid, validateBlock, type TemplateGridHandle } from './-template-grid';
import type { ExamTemplateDetail } from './-use-exam-templates';

const SUBJECTS = [
  { code: 'BAN', name: 'Bangla', label: 'Bangla' },
  { code: 'ENG', name: 'English', label: 'English' },
];
const ROWS: ExamTemplateDetail['rows'] = [
  {
    classGrade: 5,
    subjectCode: 'BAN',
    subjectName: 'Bangla',
    components: [{ name: 'Written', kind: 'WRITTEN', full: 80, pass: 26, sequence: 1 }],
  },
  {
    classGrade: 6,
    subjectCode: 'ENG',
    subjectName: 'English',
    components: [{ name: 'Written', kind: 'WRITTEN', full: 100, pass: 33, sequence: 1 }],
  },
];

/** The page header owns Save / Discard; the harness stands in for it. */
function Harness(props: Omit<React.ComponentProps<typeof TemplateGrid>, 'ref'>) {
  const { t } = useTranslation('examTemplates');
  const ref = React.useRef<TemplateGridHandle>(null);
  const [grade, setGrade] = React.useState<number | undefined>(props.selectedGrade);
  return (
    <>
      <button type="button" onClick={() => ref.current?.save()}>
        {t('detail.save')}
      </button>
      <TemplateGrid {...props} ref={ref} selectedGrade={grade} onGradeChange={setGrade} />
    </>
  );
}

function setup(onSave = vi.fn(), rows = ROWS, extra: { selectedGrade?: number } = {}) {
  const user = userEvent.setup();
  const view = renderWithProviders(
    <Harness rows={rows} subjects={SUBJECTS} onSave={onSave} {...extra} />,
    { locale: 'en' },
  );
  return { ...view, user, onSave };
}

const cell = (column: string, row = 1, subject = 'BAN — Bangla', grade = 5) =>
  screen.findByLabelText<HTMLInputElement>(`${column} — ${subject}, class ${grade}, row ${row}`);

describe('TemplateGrid', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('has no axe violations', async () => {
    const { container } = setup();
    await cell('Part name');
    await expect(container).toHaveNoViolations();
  });

  it('shows one class at a time: its tab selected, only its subjects rendered', async () => {
    setup();
    await cell('Part name');
    expect(screen.getByRole('tab', { name: /Class/, selected: true })).toBeTruthy();
    expect(screen.queryByLabelText(/ENG — English, class 6/)).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('switching tab shows the other class', async () => {
    const { user } = setup();
    await cell('Part name');
    await user.click(screen.getAllByRole('tab')[1]!);
    expect(await cell('Part name', 1, 'ENG — English', 6)).toBeTruthy();
    expect(screen.queryByLabelText(/BAN — Bangla, class 5/)).toBeNull();
  });

  it('switches tabs and selects a newly added class without a parent controlling the grade', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TemplateGrid rows={ROWS} subjects={SUBJECTS} onSave={vi.fn()} />, {
      locale: 'en',
    });
    await cell('Part name');
    await user.click(screen.getAllByRole('tab')[1]!);
    expect(await cell('Part name', 1, 'ENG — English', 6)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Add class' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Class number'), '7{Enter}');
    expect(await screen.findByRole('combobox', { name: /Subject to add to class 7/ })).toBeTruthy();
  });

  it('adds and removes part rows', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add part' }));
    expect(await cell('Part name', 2)).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Remove part 2 of BAN — Bangla, class 5' }),
    );
    expect(screen.queryByLabelText(/Part name — BAN — Bangla, class 5, row 2/)).toBeNull();
  });

  it('blocks save and shows an error when pass > full', async () => {
    const { user, onSave } = setup();
    const pass = await cell('Pass marks');
    await user.clear(pass);
    await user.type(pass, '90');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByText(/Pass marks must be between 0 and full marks/)).toBeTruthy();
  });

  it('marks the tab of another class that has errors, after a save attempt', async () => {
    const { user } = setup();
    // Break the (hidden) class 6 block, then try to save from class 5.
    await user.click(screen.getAllByRole('tab')[1]!);
    const pass = await cell('Pass marks', 1, 'ENG — English', 6);
    await user.clear(pass);
    await user.type(pass, '900');
    await user.click(screen.getAllByRole('tab')[0]!);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByLabelText(/Class .* has errors/)).toBeTruthy();
  });

  it('blocks save on duplicate part names within a subject', async () => {
    const { user, onSave } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add part' }));
    await user.keyboard('Written');
    await user.tab();
    await user.tab();
    await user.keyboard('50{Tab}20');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByText('Two parts of this subject share a name.')).toBeTruthy();
  });

  it('keyboard only: Enter adds a row and focuses its name, then save sends the full row set', async () => {
    const { user, onSave } = setup();
    const pass = await cell('Pass marks');
    pass.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(await cell('Part name', 2));
    await user.keyboard('Viva');
    await user.tab(); // kind select trigger
    await user.tab(); // full
    await user.keyboard('20');
    await user.tab();
    await user.keyboard('7');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith([
      {
        classGrade: 5,
        subjectCode: 'BAN',
        components: [
          { name: 'Written', kind: 'WRITTEN', full: 80, pass: 26 },
          { name: 'Viva', kind: 'WRITTEN', full: 20, pass: 7 },
        ],
      },
      {
        classGrade: 6,
        subjectCode: 'ENG',
        components: [{ name: 'Written', kind: 'WRITTEN', full: 100, pass: 33 }],
      },
    ]);
  });

  it('shows saved marks in tenant numerals and accepts Bangla numerals', async () => {
    const { user, onSave } = setup();
    const full = await cell('Full marks');
    expect(full.value).toBe('৮০');
    await user.clear(full);
    await user.type(full, '৭০');
    const pass = await cell('Pass marks');
    await user.clear(pass);
    await user.type(pass, '২৩');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0]?.[0][0].components[0]).toMatchObject({ full: 70, pass: 23 });
  });

  it('Esc in a field never discards the draft', async () => {
    const { user } = setup();
    const name = await cell('Part name');
    await user.type(name, 'X');
    expect(name.value).toBe('WrittenX');
    await user.keyboard('{Escape}');
    expect((await cell('Part name')).value).toBe('WrittenX');
  });

  it('adds a class through the dialog and a subject to it', async () => {
    const { user, onSave } = setup(vi.fn(), []);
    // No classes yet: the empty state's button opens the dialog.
    await user.click(await screen.findByRole('button', { name: 'Add class' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Class number'), '3{Enter}');
    await user.click(await screen.findByRole('combobox', { name: /Subject to add to class 3/ }));
    await user.click(await screen.findByRole('option', { name: /ENG — English/ }));
    await user.click(screen.getByRole('button', { name: 'Add subject' }));
    expect(await screen.findByRole('heading', { name: 'English' })).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('validateBlock', () => {
  const block = (components: { name: string; full: string; pass: string }[]) => ({
    key: 'b',
    classGrade: 1,
    subjectCode: 'X',
    components: components.map((c, i) => ({ key: `c${i}`, kind: 'WRITTEN' as const, ...c })),
  });
  it.each([
    ['0', '0', 'fullInvalid'],
    ['10.123', '1', 'fullInvalid'],
    ['10000', '1', 'fullInvalid'],
    ['10', '11', 'passInvalid'],
    ['10', '-1', 'passInvalid'],
    ['10', '1.234', 'passInvalid'],
  ])('full=%s pass=%s -> %s', (full, pass, code) => {
    expect(validateBlock(block([{ name: 'A', full, pass }]))).toEqual({ c0: code });
  });
  it('flags every ATTENDANCE component after the first', () => {
    const b = block([
      { name: 'A', full: '10', pass: '4' },
      { name: 'B', full: '10', pass: '4' },
      { name: 'C', full: '10', pass: '4' },
    ]);
    b.components.forEach((c) => (c.kind = 'ATTENDANCE' as never));
    expect(validateBlock(b)).toEqual({ c1: 'attendanceDuplicate', c2: 'attendanceDuplicate' });
  });
  it('accepts boundaries', () => {
    expect(validateBlock(block([{ name: 'A', full: '9999.99', pass: '0' }]))).toEqual({});
  });
});
