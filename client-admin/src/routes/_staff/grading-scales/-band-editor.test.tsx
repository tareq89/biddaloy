import type { BandInput } from '@biddaloy/ui/hooks';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
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

describe('BandEditor', () => {
  it('Enter in the last row appends a band starting from the previous percent_to + 1', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={ONE_BAND} />);

    const gradeInputs = await screen.findAllByLabelText('Grade');
    await user.click(gradeInputs[gradeInputs.length - 1]!);
    await user.keyboard('{Enter}');

    const fromInputs = screen.getAllByLabelText<HTMLInputElement>('From %');
    expect(fromInputs).toHaveLength(2);
    expect(fromInputs[1]!.value).toBe('90');
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

    const gradeInputs = await screen.findAllByLabelText('Grade');
    await user.click(gradeInputs[0]!);
    await user.keyboard('{Enter}');

    expect(screen.getAllByLabelText('Grade')).toHaveLength(2);
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

    const deleteButtons = await screen.findAllByRole('button', { name: 'Delete' });
    await user.click(deleteButtons[1]!);

    const fromInputs = screen.getAllByLabelText<HTMLInputElement>('From %');
    expect(fromInputs.map((input) => input.value)).toEqual(['80', '0']);
  });

  it('Tab moves focus through a row in column order', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={ONE_BAND} />);

    const fromInput = (await screen.findAllByLabelText('From %'))[0]!;
    fromInput.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getAllByLabelText('To %')[0]);
  });
});
