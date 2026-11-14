import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { ds, check, stranded, rebuild } = vi.hoisted(() => ({
  ds: {
    initialize: vi.fn(),
    destroy: vi.fn(),
    query: vi.fn(),
    getRepository: vi.fn(() => ({})),
  },
  check: vi.fn(),
  stranded: vi.fn(),
  rebuild: vi.fn(),
}));

vi.mock('../data-source', () => ({ default: ds }));
vi.mock('../modules/communications/credits/sms-credit-lot-invariants', async (orig) => ({
  ...(await orig<object>()),
  checkLotInvariants: check,
}));
vi.mock('../modules/communications/credits/sms-credit-reconcile', () => ({
  reconcileStrandedSmsCredit: stranded,
}));
vi.mock('../modules/communications/credits/sms-credit.service', () => ({
  SmsCreditService: class {
    rebuildBalanceFromLots = rebuild;
  },
}));

import { applyGuardError, main } from './reconcile-sms-credit';

describe('applyGuardError (#1317 wrong-DB guard)', () => {
  it('never blocks a dry run', () => {
    expect(applyGuardError(false, undefined, 'biddaloy')).toBeNull();
    expect(applyGuardError(false, 'other', 'biddaloy')).toBeNull();
  });

  it('refuses --apply without --confirm-db', () => {
    expect(applyGuardError(true, undefined, 'biddaloy')).toContain('--confirm-db=biddaloy');
  });

  it('refuses --apply when --confirm-db names a different database', () => {
    expect(applyGuardError(true, 'biddaloy_staging', 'biddaloy')).toContain('"biddaloy"');
  });

  it('allows --apply when --confirm-db equals current_database()', () => {
    expect(applyGuardError(true, 'biddaloy', 'biddaloy')).toBeNull();
  });
});

describe('main lot check (#3853)', () => {
  const T = '11111111-1111-4111-8111-111111111111';
  const ok = { tenantId: T, available: 5, lotsRemaining: 5, reserved: 1, openDraws: 1, lotsBroken: [] };
  const drift = { ...ok, available: 9 };
  const broken = { ...ok, lotsBroken: ['lot-1'] };
  let out: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    ds.query.mockResolvedValue([{ current_database: 'biddaloy' }]);
    stranded.mockResolvedValue(undefined);
    out = [];
    vi.spyOn(console, 'log').mockImplementation((m: string) => void out.push(String(m)));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('dry run reports drift, never repairs, exits 1', async () => {
    check.mockResolvedValue([drift]);
    expect(await main([])).toBe(1);
    expect(rebuild).not.toHaveBeenCalled();
    expect(out.join('\n')).toContain(`lots tenant=${T} available=9 lots=5 reserved=1 draws=1 broken=0 status=DRIFT`);
    expect(out).toContain('lots schools=1 drift=1');
  });

  it('--apply without --confirm-db is refused before any lot check', async () => {
    expect(await main(['--apply'])).toBe(2);
    expect(check).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('--apply repairs balance drift through the service and exits 0', async () => {
    check.mockResolvedValueOnce([drift]).mockResolvedValueOnce([ok]);
    expect(await main(['--apply', '--confirm-db=biddaloy'])).toBe(0);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(rebuild.mock.calls[0][0]).toBe(T);
    expect(out).toContain('lots schools=1 drift=0');
  });

  it('a broken lot is never repaired and exits 1 even with --apply', async () => {
    check.mockResolvedValue([broken]);
    expect(await main(['--apply', '--confirm-db=biddaloy'])).toBe(1);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('drift that survives the rebuild exits 1', async () => {
    check.mockResolvedValue([drift]);
    expect(await main(['--apply', '--confirm-db=biddaloy'])).toBe(1);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('lists at most 20 lot ids and prints no reason text', async () => {
    const many = { ...ok, lotsBroken: Array.from({ length: 30 }, (_, i) => `lot-${i}`) };
    check.mockResolvedValue([many]);
    await main([]);
    const line = out.find((l) => l.startsWith('lots tenant='))!;
    expect(line.split('lot_ids=')[1].split(',')).toHaveLength(20);
    expect(out.join('\n')).not.toContain('reconcile-sms-credit --apply');
  });
});
