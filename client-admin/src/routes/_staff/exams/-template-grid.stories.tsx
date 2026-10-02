import type { Meta, StoryObj } from '@storybook/react-vite';

import { TemplateGrid, type TemplateGridProps } from './-template-grid';

const SUBJECTS = [
  { code: 'BAN', name: 'Bangla' },
  { code: 'ENG', name: 'English' },
  { code: 'MAT', name: 'Mathematics' },
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

function Grid(props: Partial<TemplateGridProps>) {
  return <TemplateGrid rows={ROWS} subjects={SUBJECTS} onSave={() => undefined} {...props} />;
}

const meta: Meta<typeof TemplateGrid> = { component: TemplateGrid };
export default meta;
type Story = StoryObj<typeof TemplateGrid>;

/** One section per class grade, one table per subject. */
export const Populated: Story = { render: () => <Grid /> };

/** Nothing yet — only the "add class grade" control. */
export const Empty: Story = { render: () => <Grid rows={[]} /> };

/** Save in flight. */
export const Saving: Story = {
  render: () => <Grid saving />,
};

/** The server rejected the save (e.g. a 400/409 message). */
export const ServerError: Story = {
  render: () => <Grid error='Duplicate component name "Written" for class 5, BAN.' />,
};

/** pass > full: Save is blocked and the field explains why. */
export const InvalidPassMarks: Story = {
  render: () => <Grid />,
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('storybook/test');
    const canvas = within(canvasElement);
    const pass = await canvas.findByLabelText('Pass marks — BAN — Bangla, class 5, row 1');
    await userEvent.clear(pass);
    await userEvent.type(pass, '90');
    await userEvent.click(canvas.getByRole('button', { name: 'Save template' }));
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
