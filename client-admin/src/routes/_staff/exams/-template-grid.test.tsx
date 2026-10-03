import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TemplateGrid, validateBlock } from './-template-grid';
import type { ExamTemplateDetail } from './use-exam-templates';

const SUBJECTS = [
  { code: 'BAN', name: 'Bangla' },
  { code: 'ENG', name: 'English' },
];
const ROWS: ExamTemplateDetail['rows'] = [
  {
    classGrade: 5,
    subjectCode: 'BAN',
    subjectName: 'Bangla',
    components: [{ name: 'Written', kind: 'WRITTEN', full: 80, pass: 26, sequence: 1 }],
  },
];

function setup(onSave = vi.fn(), rows = ROWS) {
  const user = userEvent.setup();
  const view = renderWithProviders(
    <TemplateGrid rows={rows} subjects={SUBJECTS} onSave={onSave} />,
    { locale: 'en' },
  );
  return { ...view, user, onSave };
}

const cell = (column: string, row = 1) =>
  screen.findByLabelText<HTMLInputElement>(`${column} — BAN — Bangla, class 5, row ${row}`);

describe('TemplateGrid', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('has no axe violations', async () => {
    const { container } = setup();
    await cell('Component');
    await expect(container).toHaveNoViolations();
  });

  it('adds and removes component rows', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add component' }));
    expect(await cell('Component', 2)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove row 2 of BAN — Bangla, class 5' }));
    expect(screen.queryByLabelText(/Component — BAN — Bangla, class 5, row 2/)).toBeNull();
  });

  it('blocks save and shows an error when pass > full', async () => {
    const { user, onSave } = setup();
    const pass = await cell('Pass marks');
    await user.clear(pass);
    await user.type(pass, '90');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByText(/Pass marks must be between 0 and full marks/)).toBeTruthy();
  });

  it('blocks save on duplicate component names within a subject', async () => {
    const { user, onSave } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add component' }));
    await user.keyboard('Written');
    await user.tab();
    await user.tab();
    await user.keyboard('50{Tab}20');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByText('Two components of this subject share a name.')).toBeTruthy();
  });

  it('keyboard only: Enter adds a row and focuses its name, then save posts the full row set', async () => {
    const { user, onSave } = setup();
    const pass = await cell('Pass marks');
    pass.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(await cell('Component', 2));
    await user.keyboard('Viva');
    await user.tab(); // kind select trigger
    await user.tab(); // full
    await user.keyboard('20');
    await user.tab();
    await user.keyboard('7');

    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(onSave).toHaveBeenCalledWith([
      {
        classGrade: 5,
        subjectCode: 'BAN',
        components: [
          { name: 'Written', kind: 'WRITTEN', full: 80, pass: 26 },
          { name: 'Viva', kind: 'WRITTEN', full: 20, pass: 7 },
        ],
      },
    ]);
  });

  it('Esc in a field discards unsaved edits', async () => {
    const { user } = setup();
    const name = await cell('Component');
    await user.type(name, 'X');
    expect(name.value).toBe('WrittenX');
    await user.keyboard('{Escape}');
    expect((await cell('Component')).value).toBe('Written');
  });

  it('adds a class grade and a subject to it', async () => {
    const { user, onSave } = setup(vi.fn(), []);
    await user.type(await screen.findByLabelText(/Class grade/), '3{Enter}');
    await user.click(await screen.findByRole('combobox', { name: /Subject to add to class 3/ }));
    await user.click(await screen.findByRole('option', { name: /ENG — English/ }));
    await user.click(screen.getByRole('button', { name: 'Add subject' }));
    expect(await screen.findByRole('heading', { name: 'ENG — English' })).toBeTruthy();
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
