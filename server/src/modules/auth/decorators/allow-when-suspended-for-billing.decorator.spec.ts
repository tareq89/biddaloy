import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY } from './allow-when-suspended-for-billing.decorator';
import { WorkbookController } from '../../workbook/export/workbook.controller';

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
  it('only the decorator, ContextGuard and WorkbookController use the marker', () => {
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
