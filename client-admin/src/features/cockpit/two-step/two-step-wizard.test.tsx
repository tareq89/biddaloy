import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/ownerSecurity.json';
import en from '../../../../../ui/src/i18n/locales/en/ownerSecurity.json';

import { TwoStepWizard } from './two-step-wizard';

const HANDOFF = {
  enrolToken: 'enrol-token',
  otpauthUri: 'otpauth://totp/Biddaloy:owner?secret=JBSWY3DPEHPK3PXP',
  secret: 'JBSWY3DPEHPK3PXP',
  rememberDevice: true,
};
const body = (statusCode: number) => ({
  statusCode,
  message: 'x',
  timestamp: '',
  path: '/',
  requestId: 'r',
});
const CODES = ['AAAA-BBBB-CCCC-DDDD', 'EEEE-FFFF-GGGG-HHHH'];

function setPhone(phone: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: phone,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

const view = (props: Partial<React.ComponentProps<typeof TwoStepWizard>> = {}) =>
  renderWithProviders(
    <TwoStepWizard
      handoff={HANDOFF}
      onDone={props.onDone ?? vi.fn()}
      onStartAgain={props.onStartAgain ?? vi.fn()}
      {...props}
    />,
    { locale: 'en' },
  );

afterEach(async () => {
  setPhone(false);
  await cleanupTestState();
});

describe('TwoStepWizard', () => {
  it('has the same keys in en and bn', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' ? keys(v as object, `${p}${k}.`) : [`${p}${k}`],
      );
    expect(keys(bn)).toEqual(keys(en));
  });

  it('shows start again when the hand-off is missing', async () => {
    const onStartAgain = vi.fn();
    view({ handoff: null, onStartAgain });
    await userEvent.click(await screen.findByRole('button', { name: 'Start again' }));
    expect(onStartAgain).toHaveBeenCalled();
  });

  it('a wrong code shows the error and stays on step 1', async () => {
    server.use(
      http.post('*/auth/cockpit/enrol/confirm', () =>
        HttpResponse.json({ message: 'no' }, { status: 400 }),
      ),
    );
    view();
    await userEvent.type(await screen.findByLabelText(/6-digit code/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Code did not match, use the new 30-second code.')).toBeTruthy();
    expect(screen.queryByText('Save your recovery codes')).toBeNull();
  });

  it('cannot finish without the tick, then finishes', async () => {
    let body: unknown;
    server.use(
      http.post('*/auth/cockpit/enrol/confirm', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ step: 'done', access_token: 'tok', recoveryCodes: CODES });
      }),
    );
    const onDone = vi.fn();
    view({ onDone });
    await userEvent.type(await screen.findByLabelText(/6-digit code/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('AAAA-BBBB-CCCC-DDDD')).toBeTruthy();
    expect(body).toEqual({ enrolToken: 'enrol-token', code: '123456', rememberDevice: true });
    const finish = screen.getByRole('button', { name: 'Finish' });
    expect(finish).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'I saved them' }));
    await waitFor(() => expect(finish).toHaveProperty('disabled', false));
    await userEvent.click(finish);
    expect(onDone).toHaveBeenCalled();
  });

  it('desktop draws the QR, phone shows the open-app button instead', async () => {
    view();
    expect(await screen.findByRole('img', { name: /QR/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open authenticator app' })).toBeNull();
    await cleanupTestState();
    setPhone(true);
    view();
    const link = await screen.findByRole('link', { name: 'Open authenticator app' });
    expect(link.getAttribute('href')).toBe(HANDOFF.otpauthUri);
    expect(screen.getByRole('button', { name: 'Copy key' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /QR/ })).toBeNull();
  });

  it('keeps no recovery code in browser storage', async () => {
    server.use(
      http.post('*/auth/cockpit/enrol/confirm', () =>
        HttpResponse.json({ step: 'done', access_token: 'tok', recoveryCodes: CODES }),
      ),
    );
    view();
    await userEvent.type(await screen.findByLabelText(/6-digit code/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('AAAA-BBBB-CCCC-DDDD');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('AAAA');
  });

  it.each([401, 410])(
    'an expired enrolment (%i) offers start again, not the wrong-code line',
    async (status) => {
      server.use(
        http.post('*/auth/cockpit/enrol/confirm', () =>
          HttpResponse.json(body(status), { status }),
        ),
      );
      const onStartAgain = vi.fn();
      view({ onStartAgain });
      await userEvent.type(await screen.findByLabelText(/6-digit code/), '123456');
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Start again' }));
      expect(onStartAgain).toHaveBeenCalled();
      expect(screen.queryByText('Code did not match, use the new 30-second code.')).toBeNull();
    },
  );

  it('a 429 says to slow down', async () => {
    server.use(
      http.post('*/auth/cockpit/enrol/confirm', () =>
        HttpResponse.json(body(429), { status: 429, headers: { 'Retry-After': '5' } }),
      ),
    );
    view();
    await userEvent.type(await screen.findByLabelText(/6-digit code/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Too many tries. Wait a little and try again.')).toBeTruthy();
  });

  it('Close asks before leaving while the codes are unsaved', async () => {
    server.use(
      http.post('*/auth/cockpit/enrol/confirm', () =>
        HttpResponse.json({ step: 'done', access_token: 'tok', recoveryCodes: CODES }),
      ),
    );
    const onDone = vi.fn();
    view({ onDone });
    await userEvent.type(await screen.findByLabelText(/6-digit code/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('AAAA-BBBB-CCCC-DDDD');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
