import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY } from './allow-when-suspended-for-billing.decorator';
import { BillingController } from '../../billing/billing.controller';
import { WorkbookController } from '../../workbook/export/workbook.controller';
import { ALLOW_WHEN_READ_ONLY_KEY } from './allow-when-read-only.decorator';
import { AttentionController } from '../../attention/api/attention.controller';
import { PushSubscriptionsController } from '../../push/push-subscriptions.controller';
import { UserController } from '../../users/users.controller';
import { StepUpController } from '../step-up.controller';
import { FeeController } from '../../fees/fees.controller';
import { FineSweepController } from '../../fees/fines/fine-sweep.controller';
import { PrintJobsController } from '../../print/jobs/print-jobs.controller';

/**
 * #2399 A3: every handler marked @AllowWhenSuspendedForBilling is open to a school whose trial ended.
 * These two tests pin that allowlist to exactly the backup export, poll and download routes, so
 * adding a fourth needs a deliberate edit here.
 */
const SRC = join(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.ts$/.test(e.name) && !/\.(spec|e2e-spec)\.ts$/.test(e.name) ? [p] : [];
  });
}

describe('@AllowWhenSuspendedForBilling allowlist', () => {
  it('only the decorator, ContextGuard, BillingController and WorkbookController use the marker', () => {
    const users = sourceFiles(SRC)
      .filter((f) =>
        /@AllowWhenSuspendedForBilling\(|ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY|'allowWhenSuspendedForBilling'/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => relative(SRC, f))
      .sort();

    expect(users).toEqual([
      'modules/auth/decorators/allow-when-suspended-for-billing.decorator.ts',
      'modules/auth/guards/context.guard.ts',
      'modules/billing/billing.controller.ts',
      'modules/workbook/export/workbook.controller.ts',
    ]);
  });

  it('WorkbookController marks exactly requestExport, get and download', () => {
    const proto = WorkbookController.prototype as unknown as Record<string, unknown>;
    const marked = Object.getOwnPropertyNames(proto)
      .filter((name) => typeof proto[name] === 'function')
      .filter((name) =>
        Reflect.getMetadata(ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY, proto[name] as object),
      )
      .sort();

    expect(marked).toEqual(['download', 'get', 'requestExport']);
  });
});

describe('BillingController marker', () => {
  it('marks exactly orders (get, create) and summary so a suspended school can still pay', () => {
    const proto = BillingController.prototype as unknown as Record<string, unknown>;
    const marked = Object.getOwnPropertyNames(proto)
      .filter((k) => k !== 'constructor' && typeof proto[k] === 'function')
      .filter((k) => Reflect.getMetadata(ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY, proto[k] as object))
      .sort();
    expect(marked).toEqual(
      Object.getOwnPropertyNames(proto)
        .filter((k) => k !== 'constructor')
        .sort(),
    );
  });
});

/**
 * Epic 49 D9: @AllowWhenReadOnly keeps a user's own writes open while the school is read-only.
 * Pinned to exactly these handlers, so a new one is a deliberate edit (and a docs line in
 * 34-onboarding.md "Writes that stay open").
 */
describe('@AllowWhenReadOnly allowlist', () => {
  const markedOn = (cls: { prototype: object }) => {
    const proto = cls.prototype as unknown as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .filter((k) => k !== 'constructor' && typeof proto[k] === 'function')
      .filter((k) => Reflect.getMetadata(ALLOW_WHEN_READ_ONLY_KEY, proto[k] as object))
      .sort();
  };

  it('only the decorator, ContextGuard and the seven controllers use the marker', () => {
    const users = sourceFiles(SRC)
      .filter((f) =>
        /@AllowWhenReadOnly\(|ALLOW_WHEN_READ_ONLY_KEY|'allowWhenReadOnly'/.test(
          readFileSync(f, 'utf8'),
        ),
      )
      .map((f) => relative(SRC, f))
      .sort();
    expect(users).toEqual([
      'modules/attention/api/attention.controller.ts',
      'modules/auth/decorators/allow-when-read-only.decorator.ts',
      'modules/auth/guards/context.guard.ts',
      'modules/auth/step-up.controller.ts',
      'modules/fees/fees.controller.ts',
      'modules/fees/fines/fine-sweep.controller.ts',
      'modules/legal/legal.controller.ts',
      'modules/print/jobs/print-jobs.controller.ts',
      'modules/push/push-subscriptions.controller.ts',
      'modules/users/users.controller.ts',
    ]);
  });

  it('marks exactly the user-level writes and the read-only previews', () => {
    expect(markedOn(AttentionController)).toEqual(['hide', 'seen', 'snooze']);
    expect(markedOn(StepUpController)).toEqual(['requestOtp', 'verify']);
    expect(markedOn(PushSubscriptionsController)).toEqual(['remove', 'removeAll', 'subscribe']);
    // #4112: read-shaped POST previews write nothing, so a read-only school may still run them.
    expect(markedOn(FeeController)).toEqual(['previewGenerateFees']);
    expect(markedOn(FineSweepController)).toEqual(['preview']);
    expect(markedOn(PrintJobsController)).toEqual(['preview']);
    expect(markedOn(UserController)).toEqual([
      'updateDashboardLayout',
      'updateDigestPreference',
      'updateNotificationPrefs',
    ]);
  });
});
