import { expect, type Page } from '@playwright/test';

import { t } from '../i18n';

/**
 * The one bespoke flow: `/payments/record`
 * (`record-payment-wizard.tsx` on `WizardShell`). One method per step,
 * each asserting the step is current (`aria-current="step"` on the
 * stepper) before acting — a spec that gets out of sync with the flow
 * fails at the step boundary, not three steps later.
 */
export class RecordPaymentWizardPage {
  constructor(readonly page: Page) {}

  async expectStep(stepLabelKey: string): Promise<void> {
    await expect(this.page.locator('[aria-current="step"]')).toHaveText(t(stepLabelKey));
  }

  async findStudent(query: string, resultText: string): Promise<void> {
    await this.expectStep('payments.record.steps.findStudent');
    await this.page.getByRole('combobox').first().fill(query);
    await this.page.getByRole('option', { name: resultText }).click();
  }

  async expectOutstandingFees(): Promise<void> {
    await this.expectStep('payments.record.steps.outstandingFees');
  }

  async expectAllocateStep(): Promise<void> {
    await this.expectStep('payments.record.steps.allocate');
  }

  async expectMethodStep(): Promise<void> {
    await this.expectStep('payments.record.steps.method');
  }

  async expectConfirmStep(): Promise<void> {
    await this.expectStep('payments.record.steps.confirm');
  }

  async confirm(): Promise<void> {
    await this.expectConfirmStep();
    await this.page
      .getByRole('button', { name: t('payments.record.confirm.submitAction') })
      .click();
  }
}
