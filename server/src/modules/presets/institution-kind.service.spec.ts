import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AuditAction, INSTITUTION_KINDS } from '@biddaloy/shared';
import {
  findLabelsReason,
  findModulesReason,
} from '../schools/settings/modules-settings.validator';
import { InstitutionKindService, UNKNOWN_KIND } from './institution-kind.service';

const CTX = { ip: null, userAgent: null };

/** Fake school: one stored modules/labels block; updateSettings deep-merges like the real one. */
function make(modules: Record<string, unknown> = {}, labels: Record<string, unknown> = {}) {
  const stored = { modules, labels };
  const schools = {
    getSchoolModules: vi.fn(async () => stored.modules),
    getSchoolLabels: vi.fn(async () => stored.labels),
    updateSettings: vi.fn(async (_t: string, patch: any) => {
      for (const [k, v] of Object.entries<any>(patch.modules ?? {})) {
        stored.modules[k] = { ...(stored.modules[k] as object), ...v };
      }
      Object.assign(stored.labels, patch.labels ?? {});
      return {};
    }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  return {
    svc: new InstitutionKindService(schools as never, audit as never),
    schools,
    audit,
    stored,
  };
}

describe('InstitutionKindService', () => {
  it('every shared kind builds a patch the settings validators accept', () => {
    for (const kind of INSTITUTION_KINDS) {
      const modules = Object.fromEntries(
        Object.entries(kind.modules).map(([k, on]) => [k, { on }]),
      );
      expect(findModulesReason(modules), kind.id).toBeNull();
      expect(findLabelsReason(kind.labels), kind.id).toBeNull();
    }
  });

  it('unknown id is a 400 with a fixed sentence that does not echo the id', async () => {
    const { svc } = make();
    const err = await svc.preview('t1', 'nope<script>').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(UNKNOWN_KIND);
    await expect(svc.apply('t1', 'u1', 'nope', CTX)).rejects.toThrow(UNKNOWN_KIND);
  });

  it('preview lists only real changes and writes nothing', async () => {
    // seatPlans already off, so only evaluations changes for "primary".
    const { svc, schools, audit } = make({ seatPlans: { on: false } });
    const res = await svc.preview('t1', 'primary');
    expect(res.modules).toEqual([{ key: 'evaluations', from: true, to: false }]);
    expect(res.labels).toEqual([]);
    expect(schools.updateSettings).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('apply keeps offForRoles and lock: it only sends `on` for changed modules', async () => {
    const { svc, schools, stored } = make({
      fines: { on: true, offForRoles: ['TEACHER'], lock: 'on' },
    });
    await svc.apply('t1', 'u1', 'coaching', CTX);
    const patch = schools.updateSettings.mock.calls[0][1] as any;
    expect(patch.modules.fines).toEqual({ on: false }); // no offForRoles, no lock sent
    expect(JSON.stringify(patch)).not.toContain('lock');
    expect(JSON.stringify(patch)).not.toContain('offForRoles');
    expect(stored.modules.fines).toEqual({ on: false, offForRoles: ['TEACHER'], lock: 'on' });
  });

  it('apply leaves modules and words the kind does not define alone', async () => {
    const { svc, stored } = make({ fees: { on: false } }, { teacher: { bn: 'শিক্ষক' } });
    await svc.apply('t1', 'u1', 'coaching', CTX);
    expect(stored.modules.fees).toEqual({ on: false });
    expect(stored.labels.teacher).toEqual({ bn: 'শিক্ষক' });
    expect(stored.labels.class).toBeDefined(); // the kind's own word was written
  });

  it('apply audits INSTITUTION_KIND_APPLIED once with the kind id and old/new of the blocks', async () => {
    const { svc, audit } = make();
    await svc.apply('t1', 'u1', 'coaching', CTX);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const row = audit.record.mock.calls[0][0];
    expect(row.action).toBe(AuditAction.INSTITUTION_KIND_APPLIED);
    expect(row.tenant_id).toBe('t1');
    expect(row.new_values.kind).toBe('coaching');
    expect(row.old_values.modules.fines).toEqual({ on: true });
    expect(row.new_values.modules.fines).toEqual({ on: false });
  });

  it('apply is idempotent: the second run changes and audits nothing', async () => {
    const { svc, schools, audit } = make();
    await svc.apply('t1', 'u1', 'coaching', CTX);
    const second = await svc.apply('t1', 'u1', 'coaching', CTX);
    expect(second).toEqual({ modules: [], labels: [] });
    expect(schools.updateSettings).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});
