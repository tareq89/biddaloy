import type { Page } from '@playwright/test';

import { t } from '../i18n';

/**
 * [16.2.5] `ui/src/components/admin-verification-modal.tsx` — the step-up
 * approval overlay `ui/src/hooks/approval.tsx` opens whenever a mutation
 * comes back `APPROVAL_REQUIRED`.
 *
 * Not a route archetype (see this folder's README), but the same
 * justification as `AppShellPage`: one component shared by every gated
 * route, so the knowledge of how to drive it belongs in one place rather
 * than copied into each journey that trips a `@RequireApproval` guard.
 */
export class ApprovalModalPage {
  constructor(private readonly page: Page) {}

  /**
   * The modal renders a single request button whose label walks
   * `otp.sendCode` → `otp.resendIn` (disabled, counting down) →
   * `otp.resend` (`admin-verification-modal.tsx`'s `secondsLeft`/
   * `codeSent` branches). A retry past the cooldown is therefore clicking
   * the *resend* label, not the send one, so this matches either —
   * anchored on the catalog rather than a hand-written pattern, since the
   * default `bn` labels ("কোড পাঠান" / "কোড আবার পাঠান") are neither a
   * substring of the other nor a match for an English `/code/i`.
   */
  private requestButton() {
    const labels = [t('approval.otp.sendCode'), t('approval.otp.resend')];
    return this.page.getByRole('button', {
      name: new RegExp(
        labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      ),
    });
  }

  /**
   * Fills the identifier, requests a code, and submits it — retried past
   * `OtpService`'s 60s-per-identifier cooldown, which `StepUpService.
   * requestOtp` (16.2.2) swallows into the same uniform 202 it always
   * returns. A second journey requesting a code for the same seeded admin
   * within that window gets a 202 with no `debug` block at all: not a
   * failure, just "wait out the cooldown". The 65s timeout on later
   * attempts is what waits out the modal's own disabled countdown in
   * between — see `requestButton()`.
   *
   * `e2e/api.ts`'s `requestStepUpOtp` is this flow's API-only twin, for
   * journeys that never open the modal.
   */
  async complete(identifier: string): Promise<void> {
    await this.page.getByLabel(t('approval.identifierLabel')).fill(identifier);

    let otp: string | undefined;
    for (let attempt = 0; attempt < 4 && !otp; attempt += 1) {
      // `waitForResponse` defaults to Playwright's 30s action timeout,
      // shorter than the up-to-65s the paired `click()` is allowed to
      // wait out the cooldown for — without an explicit matching timeout
      // here, a real cooldown wait made the response wait lose the race
      // and throw first, even though the click would have gone through.
      const [otpResponse] = await Promise.all([
        this.page.waitForResponse('**/auth/step-up/otp/request', { timeout: 65_000 }),
        this.requestButton().click({ timeout: attempt === 0 ? 5000 : 65_000 }),
      ]);
      const body = (await otpResponse.json()) as { debug?: { otp?: string } };
      otp = body.debug?.otp;
    }
    if (!otp) {
      throw new Error(
        'No debug.otp on step-up otp/request response after retrying the cooldown — ' +
          'ACCOUNT_ACCESS_ECHO_SECRETS=true set?',
      );
    }

    await this.page.getByLabel(t('approval.otp.codeLabel')).fill(otp);
    await this.page.getByRole('button', { name: t('approval.submit') }).click();
  }
}
