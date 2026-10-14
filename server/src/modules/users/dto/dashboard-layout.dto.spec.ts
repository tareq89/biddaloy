import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DASHBOARD_LAYOUT_MAX_WIDGETS, DashboardWidgetKey } from '@biddaloy/shared';
import { DashboardLayoutDto } from './dashboard-layout.dto';

// Same options as the global pipe (server/src/validation-pipe.ts).
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true } as const;

const errorsFor = (plain: Record<string, unknown>) =>
  validate(plainToInstance(DashboardLayoutDto, plain), OPTIONS);

const KEYS = Object.values(DashboardWidgetKey);

describe('DashboardLayoutDto', () => {
  it('accepts an empty list', async () => {
    expect(await errorsFor({ widgets: [] })).toEqual([]);
  });

  it('accepts an item with only a key', async () => {
    expect(await errorsFor({ widgets: [{ key: KEYS[0] }] })).toEqual([]);
  });

  it('accepts hidden and size', async () => {
    expect(await errorsFor({ widgets: [{ key: KEYS[0], hidden: true, size: 'M' }] })).toEqual([]);
  });

  it('rejects an unknown key', async () => {
    expect((await errorsFor({ widgets: [{ key: 'nope' }] })).length).toBeGreaterThan(0);
  });

  it('rejects an unknown size', async () => {
    expect((await errorsFor({ widgets: [{ key: KEYS[0], size: 'XL' }] })).length).toBeGreaterThan(
      0,
    );
  });

  it('rejects a non-boolean hidden', async () => {
    expect(
      (await errorsFor({ widgets: [{ key: KEYS[0], hidden: 'yes' }] })).length,
    ).toBeGreaterThan(0);
  });

  it('accepts every widget in the catalogue at once', async () => {
    // The cap (40) is above the catalogue size (39), so a full layout always saves.
    expect(KEYS.length).toBeLessThanOrEqual(DASHBOARD_LAYOUT_MAX_WIDGETS);
    expect(await errorsFor({ widgets: KEYS.map((key) => ({ key })) })).toEqual([]);
  });

  it('rejects the same key twice', async () => {
    expect(
      (await errorsFor({ widgets: [{ key: KEYS[0] }, { key: KEYS[0] }] })).length,
    ).toBeGreaterThan(0);
  });

  it('rejects an extra field (forbidNonWhitelisted)', async () => {
    expect(
      (await errorsFor({ widgets: [{ key: KEYS[0], colour: 'red' }] })).length,
    ).toBeGreaterThan(0);
  });

  it('rejects a null element with a validation error, not a crash', async () => {
    expect((await errorsFor({ widgets: [null] })).length).toBeGreaterThan(0);
  });

  it('rejects a missing widgets array', async () => {
    expect((await errorsFor({})).length).toBeGreaterThan(0);
  });
});
