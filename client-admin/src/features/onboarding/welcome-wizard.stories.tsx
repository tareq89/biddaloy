import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, userEvent, within } from 'storybook/test';

import { withMemoryRouter } from '../../../../ui/.storybook/router-decorator';

import { WelcomeWizard } from './welcome-wizard';

/**
 * [13.6.1] The welcome wizard frame. The step bodies are other tickets'
 * slots, so every story fills them with a labelled placeholder. Switch the
 * toolbar locale to see Bangla. Same "client-admin isn't globbed into a
 * running Storybook yet" gap the other `client-admin` feature stories note.
 */
const status = (supportUrl: string | null) =>
  http.get('/api/v1/onboarding/status', () =>
    HttpResponse.json({
      finished_at: null,
      dismissed_at: null,
      seen: true,
      setup_path: null,
      items: [],
      counts: { classes: 0, sections: 0, students: 0, staff: 1 },
      trial: null,
      support_url: supportUrl,
    }),
  );
const patch = http.patch('/api/v1/onboarding', () => HttpResponse.json({}));

const placeholder = (name: string) => (
  <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
    {`${name} slot placeholder`}
  </div>
);

const meta: Meta<typeof WelcomeWizard> = {
  title: 'Features/Onboarding/WelcomeWizard',
  component: WelcomeWizard,
  args: {
    guided: placeholder('Guided'),
    excel: placeholder('Excel'),
    people: placeholder('People'),
    summary: placeholder('Summary'),
  },
  parameters: {
    layout: 'fullscreen',
    msw: { handlers: [status('https://example.com/help'), patch] },
  },
};
export default meta;
type Story = StoryObj<typeof WelcomeWizard>;

export const Doors: Story = {
  decorators: [withMemoryRouter(['/welcome?step=setup'])],
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('radio', { name: /Step by step/ })).toBeChecked();
    await userEvent.keyboard('{ArrowDown}');
    await expect(body.getByRole('radio', { name: /Excel/ })).toBeChecked();
  },
};

export const DoorsPhone: Story = {
  ...Doors,
  parameters: { ...meta.parameters, viewport: { defaultViewport: 'mobile1' } },
};

export const DoorsWithoutSupportLink: Story = {
  decorators: [withMemoryRouter(['/welcome?step=setup'])],
  parameters: { layout: 'fullscreen', msw: { handlers: [status(null), patch] } },
};

export const GuidedSlot: Story = {
  decorators: [withMemoryRouter(['/welcome?step=setup&path=guided'])],
};

export const ExcelSlot: Story = {
  decorators: [withMemoryRouter(['/welcome?step=setup&path=excel'])],
};

export const PeopleSlot: Story = {
  decorators: [withMemoryRouter(['/welcome?step=people'])],
};

export const DoneSlot: Story = {
  decorators: [withMemoryRouter(['/welcome?step=done'])],
};

export const DoneSlotPhone: Story = {
  ...DoneSlot,
  parameters: { ...meta.parameters, viewport: { defaultViewport: 'mobile1' } },
};
