import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, within } from 'storybook/test';

import { TwoStepWizard } from './two-step-wizard';

/**
 * [98.4.04] The owner two-step set-up wizard, mockup section b. The phone story is the 390 px
 * layout: the QR is replaced by the "Open authenticator app" button and Copy key. Same
 * "client-admin isn't globbed into a running Storybook yet" gap the other client-admin stories note.
 */
const meta: Meta<typeof TwoStepWizard> = {
  title: 'Features/Cockpit/TwoStepWizard',
  component: TwoStepWizard,
  args: {
    handoff: {
      enrolToken: 'story',
      otpauthUri: 'otpauth://totp/Biddaloy:owner?secret=JBSWY3DPEHPK3PXP',
      secret: 'JBSWY3DPEHPK3PXP',
      rememberDevice: false,
    },
    onDone: fn(),
    onStartAgain: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof TwoStepWizard>;

export const Desktop: Story = {};

export const Phone390: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const RecoveryCodes: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('*/auth/cockpit/enrol/confirm', () =>
          HttpResponse.json({
            step: 'done',
            access_token: 'story',
            recoveryCodes: ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'],
          }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement.ownerDocument.body);
    await userEvent.type(await c.findByLabelText(/6-digit code/), '123456');
    await userEvent.click(c.getByRole('button', { name: 'Next' }));
    await expect(await c.findByText('AAAA-BBBB-CCCC-DDDD')).toBeTruthy();
  },
};

export const StartAgain: Story = { args: { handoff: null } };
