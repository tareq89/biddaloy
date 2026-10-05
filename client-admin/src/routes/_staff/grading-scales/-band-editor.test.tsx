import type { BandInput } from '@biddaloy/ui/hooks';
import { I18nProvider, REGION_BD_BN, i18n } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';

import { BandEditor } from './-band-editor';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

function Controlled({ initial }: { initial: BandInput[] }) {
  const [bands, setBands] = React.useState(initial);
  return (
    <I18nProvider>
      <BandEditor bands={bands} onChange={setBands} />
    </I18nProvider>
  );
}

const ONE_BAND: BandInput[] = [
  {
    percent_from: 80,
    percent_to: 89,
    grade: 'A+',
    gpa: 5,
    is_fail: false,
    sequence: 1,
    comment: null,
  },
];

const num = (n: number) => formatNumber(n, REGION_BD_BN);
// Every cell is labelled "Row <n> — <column>"; these match a column across rows.
const col = (name: string) => new RegExp(`— ${name.replace(/[()]/g, '\\$&')}$`);

describe('BandEditor', () => {
  it('Enter in the last row appends a band starting from the previous percent_to + 1', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={ONE_BAND} />);

    const gradeInputs = await screen.findAllByLabelText(col('Grade'));
    await user.click(gradeInputs[gradeInputs.length - 1]!);
    await user.keyboard('{Enter}');

    const fromInputs = screen.getAllByLabelText<HTMLInputElement>(col('From (%)'));
    expect(fromInputs).toHaveLength(2);
    expect(fromInputs[1]!.value).toBe(num(90));
  });

  it('Enter on a row that is not last does not append a new band', async () => {
    const user = userEvent.setup();
    const twoBands: BandInput[] = [
      ...ONE_BAND,
      {
        percent_from: 0,
        percent_to: 79,
        grade: 'A',
        gpa: 4,
        is_fail: false,
        sequence: 2,
        comment: null,
      },
    ];
    render(<Controlled initial={twoBands} />);

    const gradeInputs = await screen.findAllByLabelText(col('Grade'));
    await user.click(gradeInputs[0]!);
    await user.keyboard('{Enter}');

    expect(screen.getAllByLabelText(col('Grade'))).toHaveLength(2);
  });

  it('deleting a band leaves the resulting gap — does not renumber or re-close the range', async () => {
    const user = userEvent.setup();
    const threeBands: BandInput[] = [
      ONE_BAND[0]!,
      {
        percent_from: 60,
        percent_to: 79,
        grade: 'A',
        gpa: 4,
        is_fail: false,
        sequence: 2,
        comment: null,
      },
      {
        percent_from: 0,
        percent_to: 59,
        grade: 'B',
        gpa: 3,
        is_fail: false,
        sequence: 3,
        comment: null,
      },
    ];
    render(<Controlled initial={threeBands} />);

    const deleteButtons = await screen.findAllByRole('button', { name: col('Delete row') });
    await user.click(deleteButtons[1]!);

    const fromInputs = screen.getAllByLabelText<HTMLInputElement>(col('From (%)'));
    expect(fromInputs.map((input) => input.value)).toEqual([num(80), num(0)]);
  });

  it('Tab moves focus through a row in column order', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={ONE_BAND} />);

    const fromInput = (await screen.findAllByLabelText(col('From (%)')))[0]!;
    fromInput.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getAllByLabelText(col('To (%)'))[0]);
  });

  it('editing GPA updates the value, and clearing it stores null not a placeholder', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={ONE_BAND} />);

    const gpaInput = (await screen.findAllByLabelText<HTMLInputElement>(col('GPA')))[0]!;
    await user.clear(gpaInput);
    await user.type(gpaInput, '4.5');
    expect(gpaInput.value).toBe('4.5');

    await user.clear(gpaInput);
    expect(gpaInput.value).toBe('');
  });

  it('shows tenant numerals and accepts Bangla digits: typing ৮৫ stores 85', async () => {
    const user = userEvent.setup();
    const seen: BandInput[][] = [];
    render(
      <I18nProvider>
        <BandEditor bands={ONE_BAND} onChange={(next) => seen.push(next)} />
      </I18nProvider>,
    );

    const from = (await screen.findAllByLabelText<HTMLInputElement>(col('From (%)')))[0]!;
    expect(from.value).toBe(num(80));
    await user.clear(from);
    await user.type(from, '৮৫');
    expect(seen.at(-1)![0]!.percent_from).toBe(85);
  });

  it('ticking "Fail grade" clears the GPA and disables its input', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={ONE_BAND} />);

    const failCheckbox = (await screen.findAllByLabelText(col('Fail grade')))[0]!;
    expect(failCheckbox.getAttribute('aria-checked')).toBe('false');
    await user.click(failCheckbox);
    expect(failCheckbox.getAttribute('aria-checked')).toBe('true');
    const gpa = screen.getAllByLabelText<HTMLInputElement>(col('GPA'))[0]!;
    expect(gpa.value).toBe('');
    expect(gpa.disabled).toBe(true);

    await user.click(failCheckbox);
    expect(gpa.disabled).toBe(false);
  });

  it('editing the comment updates it, and clearing it stores null', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={ONE_BAND} />);

    const commentInput = (
      await screen.findAllByLabelText<HTMLInputElement>(col('Comment (optional)'))
    )[0]!;
    await user.type(commentInput, 'Distinction');
    expect(commentInput.value).toBe('Distinction');

    await user.clear(commentInput);
    expect(commentInput.value).toBe('');
  });

  it('editing To (%) updates the band', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={ONE_BAND} />);

    const toInput = (await screen.findAllByLabelText<HTMLInputElement>(col('To (%)')))[0]!;
    await user.clear(toInput);
    await user.type(toInput, '95');
    expect(toInput.value).toBe('95');
  });

  it('"Add row" appends a band continuing from the last one\'s percent_to', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={ONE_BAND} />);

    await user.click(screen.getByRole('button', { name: 'Add row' }));

    const fromInputs = screen.getAllByLabelText<HTMLInputElement>(col('From (%)'));
    expect(fromInputs).toHaveLength(2);
    expect(fromInputs[1]!.value).toBe(num(90));
  });

  it('shows the Enter shortcut hint', async () => {
    render(<Controlled initial={ONE_BAND} />);
    expect(await screen.findByText('Enter')).toBeTruthy();
  });
});
