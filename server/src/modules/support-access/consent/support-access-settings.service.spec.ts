import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import {
  ImpersonationEndedBy,
  SUPPORT_ACCESS_TEXT_VERSION,
  SupportAccessMode,
} from '@biddaloy/shared';
import { SupportAccessSettingsService } from './support-access-settings.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';

describe('SupportAccessSettingsService', () => {
  let school: { id: string; settings: Record<string, unknown> | null };
  const save = vi.fn();
  const record = vi.fn();
  const invalidate = vi.fn();
  const revokeAllForSchool = vi.fn();
  const modeChanged = vi.fn();
  let svc: SupportAccessSettingsService;

  const setSettings = (supportAccess: Record<string, unknown> | null) => {
    school = { id: SCHOOL, settings: supportAccess ? { other: 1, supportAccess } : { other: 1 } };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setSettings(null);
    const qb = {
      where: () => qb,
      setLock: () => qb,
      getOne: async () => school,
    };
    const manager = {
      getRepository: () => ({ createQueryBuilder: () => qb, save }),
    };
    const schools = {
      manager: { transaction: (fn: (m: unknown) => unknown) => fn(manager) },
      findOne: async () => school,
    };
    const users = { findOne: async () => ({ id: ADMIN, full_name: 'Amina' }) };
    svc = new SupportAccessSettingsService(
      schools as never,
      users as never,
      { record } as never,
      { invalidate } as never,
      { revokeAllForSchool } as never,
      { modeChanged } as never,
    );
  });

  it('confirm ticked stores allowed, unticked stores blocked', async () => {
    await svc.confirm(SCHOOL, ADMIN, { allowed: true, textVersion: SUPPORT_ACCESS_TEXT_VERSION });
    expect((school.settings!.supportAccess as { mode: string }).mode).toBe('allowed');
    setSettings(null);
    await svc.confirm(SCHOOL, ADMIN, { allowed: false, textVersion: SUPPORT_ACCESS_TEXT_VERSION });
    const sa = school.settings!.supportAccess as Record<string, unknown>;
    expect(sa.mode).toBe('blocked');
    expect(sa.confirmedBy).toBe(ADMIN);
    expect(sa.textVersion).toBe(SUPPORT_ACCESS_TEXT_VERSION);
    expect(school.settings!.other).toBe(1); // other keys kept
  });

  it('a stale text version is 409 TEXT_VERSION_STALE and writes nothing', async () => {
    const err = await svc
      .confirm(SCHOOL, ADMIN, { allowed: true, textVersion: 99 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('TEXT_VERSION_STALE');
    expect(save).not.toHaveBeenCalled();
  });

  it('confirming the same state again writes no audit row', async () => {
    setSettings({
      mode: 'allowed',
      confirmedAt: '2026-01-01T00:00:00.000Z',
      confirmedBy: ADMIN,
      textVersion: SUPPORT_ACCESS_TEXT_VERSION,
    });
    await svc.confirm(SCHOOL, ADMIN, { allowed: true, textVersion: SUPPORT_ACCESS_TEXT_VERSION });
    expect(save).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('a change to blocked revokes once with MODE_BLOCKED and emails; other changes never revoke', async () => {
    await svc.changeMode(SCHOOL, ADMIN, SupportAccessMode.BLOCKED);
    expect(revokeAllForSchool).toHaveBeenCalledTimes(1);
    expect(revokeAllForSchool).toHaveBeenCalledWith(SCHOOL, ImpersonationEndedBy.MODE_BLOCKED);
    expect(modeChanged).toHaveBeenCalledWith(
      SCHOOL,
      expect.objectContaining({ mode: 'off', changedByUserId: ADMIN }),
    );
    expect(invalidate).toHaveBeenCalledWith(SCHOOL);

    revokeAllForSchool.mockClear();
    await svc.changeMode(SCHOOL, ADMIN, SupportAccessMode.ASK);
    await svc.changeMode(SCHOOL, ADMIN, SupportAccessMode.ALLOWED);
    expect(revokeAllForSchool).not.toHaveBeenCalled();
  });

  it('an unchanged PUT writes, audits, revokes and emails nothing', async () => {
    await svc.changeMode(SCHOOL, ADMIN, SupportAccessMode.ALLOWED); // default is allowed
    expect(save).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(modeChanged).not.toHaveBeenCalled();
  });

  it('a repeat PUT blocked still revokes (retry after a failed revoke), with no audit row', async () => {
    setSettings({ mode: 'blocked', confirmedAt: null, confirmedBy: null, textVersion: 0 });
    await svc.changeMode(SCHOOL, ADMIN, SupportAccessMode.BLOCKED);
    expect(record).not.toHaveBeenCalled();
    expect(revokeAllForSchool).toHaveBeenCalledWith(SCHOOL, ImpersonationEndedBy.MODE_BLOCKED);
  });

  it('get flags needsConfirmation until confirmed at the current version', async () => {
    expect((await svc.get(SCHOOL)).needsConfirmation).toBe(true);
    setSettings({
      mode: 'ask',
      confirmedAt: '2026-01-01T00:00:00.000Z',
      confirmedBy: ADMIN,
      textVersion: SUPPORT_ACCESS_TEXT_VERSION,
    });
    const r = await svc.get(SCHOOL);
    expect(r).toMatchObject({ needsConfirmation: false, confirmedByName: 'Amina', mode: 'ask' });
  });
});
