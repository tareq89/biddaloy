import { describe, it, expect, vi } from 'vitest';
import { SchoolSettingsReader } from './school-settings-reader.service';
import type { SchoolsService } from '../schools.service';
import type { School } from '../entities/school.entity';
import type { Repository } from 'typeorm';

function buildReader(feesApprovalMode: string) {
  const schoolsService = {
    getResolvedSettings: vi.fn().mockResolvedValue({
      version: 1,
      fees: { approvalMode: feesApprovalMode },
    }),
  } as unknown as SchoolsService;

  return {
    reader: new SchoolSettingsReader(schoolsService, {} as Repository<School>),
    schoolsService,
  };
}

describe('SchoolSettingsReader.documentsSettings [48.1.03]', () => {
  it('returns the resolved settings.documents block', async () => {
    const documents = { withholdAdmitCardForDues: true, serialPrefix: 'DAHS' };
    const schoolsService = {
      getResolvedSettings: vi.fn().mockResolvedValue({ version: 1, documents }),
    } as unknown as SchoolsService;

    expect(
      await new SchoolSettingsReader(schoolsService, {} as Repository<School>).documentsSettings(
        'tenant-1',
      ),
    ).toEqual(documents);
    expect(schoolsService.getResolvedSettings).toHaveBeenCalledWith('tenant-1');
  });
});

describe('SchoolSettingsReader.feesApprovalMode [16.2.1]', () => {
  it('returns the tenant’s resolved settings.fees.approvalMode', async () => {
    const { reader, schoolsService } = buildReader('OTP_OR_PASSWORD');

    const mode = await reader.feesApprovalMode('tenant-1');

    expect(mode).toBe('OTP_OR_PASSWORD');
    expect(schoolsService.getResolvedSettings).toHaveBeenCalledWith('tenant-1');
  });

  it('defaults to OTP when the tenant has never configured it', async () => {
    const { reader } = buildReader('OTP');

    expect(await reader.feesApprovalMode('tenant-2')).toBe('OTP');
  });
});

describe('SchoolSettingsReader.studyPlansSettings [66.1.04]', () => {
  it('returns the resolved studyPlans block', async () => {
    const studyPlans = { statusDeadline: '17:30' };
    const schoolsService = {
      getResolvedSettings: vi.fn().mockResolvedValue({ version: 1, studyPlans }),
    } as unknown as SchoolsService;

    const out = await new SchoolSettingsReader(
      schoolsService,
      {} as Repository<School>,
    ).studyPlansSettings('t1');

    expect(out).toBe(studyPlans);
    expect(schoolsService.getResolvedSettings).toHaveBeenCalledWith('t1');
  });
});

describe('SchoolSettingsReader.dashboardSettings [8.10.7]', () => {
  it('returns the resolved dashboard block', async () => {
    const dashboard = { digestTime: '07:30' };
    const schoolsService = {
      getResolvedSettings: vi.fn().mockResolvedValue({ version: 1, dashboard }),
    } as unknown as SchoolsService;

    const out = await new SchoolSettingsReader(
      schoolsService,
      {} as Repository<School>,
    ).dashboardSettings('t1');

    expect(out).toBe(dashboard);
    expect(schoolsService.getResolvedSettings).toHaveBeenCalledWith('t1');
  });
});

describe('SchoolSettingsReader.supportAccessFresh [99.1.04]', () => {
  it('reads the school row and ignores a stale cache entry', async () => {
    const schoolsService = {
      getResolvedSettings: vi.fn().mockResolvedValue({ supportAccess: { mode: 'allowed' } }),
    } as unknown as SchoolsService;
    const schoolRepo = {
      findOne: vi.fn().mockResolvedValue({ settings: { supportAccess: { mode: 'blocked' } } }),
    } as unknown as Repository<School>;
    const reader = new SchoolSettingsReader(schoolsService, schoolRepo);

    expect((await reader.supportAccessFresh('t1')).mode).toBe('blocked');
    expect(schoolsService.getResolvedSettings).not.toHaveBeenCalled();
  });

  it('defaults when the row is missing', async () => {
    const schoolRepo = {
      findOne: vi.fn().mockResolvedValue(null),
    } as unknown as Repository<School>;
    const reader = new SchoolSettingsReader({} as SchoolsService, schoolRepo);
    expect((await reader.supportAccessFresh('t1')).mode).toBe('allowed');
  });

  it('supportAccess uses the cached resolved settings', async () => {
    const schoolsService = {
      getResolvedSettings: vi.fn().mockResolvedValue({ supportAccess: { mode: 'ask' } }),
    } as unknown as SchoolsService;
    const reader = new SchoolSettingsReader(schoolsService, {} as Repository<School>);
    expect((await reader.supportAccess('t1')).mode).toBe('ask');
  });
});
