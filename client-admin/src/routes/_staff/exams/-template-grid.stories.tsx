import { useTranslation } from '@biddaloy/ui/i18n';
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { TemplateGrid, type TemplateGridHandle, type TemplateGridProps } from './-template-grid';

const SUBJECTS = [
  { code: 'BAN', name: 'Bangla', label: 'Bangla' },
  { code: 'ENG', name: 'English', label: 'English' },
  { code: 'MAT', name: 'Mathematics', label: 'Mathematics' },
];

const ROWS: TemplateGridProps['rows'] = [
  {
    classGrade: 5,
    subjectCode: 'BAN',
    subjectName: 'Bangla',
    components: [
      { name: 'Written', kind: 'WRITTEN', full: 70, pass: 23, sequence: 1 },
      { name: 'MCQ', kind: 'MCQ', full: 30, pass: 10, sequence: 2 },
    ],
  },
  {
    classGrade: 5,
    subjectCode: 'ENG',
    subjectName: 'English',
    components: [{ name: 'Written', kind: 'WRITTEN', full: 100, pass: 33, sequence: 1 }],
  },
  {
    classGrade: 6,
    subjectCode: 'MAT',
    subjectName: 'Mathematics',
    components: [{ name: 'Written', kind: 'WRITTEN', full: 100, pass: 33, sequence: 1 }],
  },
];

/** The page header owns Save / Discard; the story stands in for it. */
function Grid(props: Partial<TemplateGridProps>) {
  const { t } = useTranslation('examTemplates');
  const ref = React.useRef<TemplateGridHandle>(null);
  const [grade, setGrade] = React.useState<number | undefined>(props.selectedGrade);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button type="button" onClick={() => ref.current?.discard()}>
          {t('detail.discard')}
        </button>
        <button type="button" onClick={() => ref.current?.save()}>
          {t('detail.save')}
        </button>
      </div>
      <TemplateGrid
        ref={ref}
        rows={ROWS}
        subjects={SUBJECTS}
        onSave={() => undefined}
        {...props}
        selectedGrade={grade}
        onGradeChange={setGrade}
      />
    </div>
  );
}

const meta: Meta<typeof TemplateGrid> = { component: TemplateGrid };
export default meta;
type Story = StoryObj<typeof TemplateGrid>;

/** One tab per class, one Card per subject of the selected class. */
export const Populated: Story = { render: () => <Grid /> };

/** The second class selected. */
export const SecondClass: Story = { render: () => <Grid selectedGrade={6} /> };

/** Nothing yet — an empty state whose action adds the first class. */
export const Empty: Story = { render: () => <Grid rows={[]} /> };

/** pass > full: Save is blocked and the field explains why. */
export const InvalidPassMarks: Story = {
  render: () => <Grid />,
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('storybook/test');
    const canvas = within(canvasElement);
    const pass = await canvas.findByLabelText('Pass marks — BAN — Bangla, class 5, row 1');
    await userEvent.clear(pass);
    await userEvent.type(pass, '90');
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
  },
};

/** Enter in a block's last cell appends a row and focuses its name. */
export const EnterAppendsRow: Story = {
  render: () => <Grid />,
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('storybook/test');
    const canvas = within(canvasElement);
    const pass = await canvas.findByLabelText('Pass marks — BAN — Bangla, class 5, row 2');
    await userEvent.click(pass);
    await userEvent.keyboard('{Enter}');
  },
};

/** Subject list not loaded yet (or empty): the picker has nothing to offer. */
export const NoSubjects: Story = { render: () => <Grid subjects={[]} /> };
