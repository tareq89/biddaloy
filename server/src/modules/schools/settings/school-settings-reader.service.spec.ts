import { describe, it, expect, vi } from 'vitest';
import { SchoolSettingsReader } from './school-settings-reader.service';
import type { SchoolsService } from '../schools.service';

function buildReader(feesApprovalMode: string) {
  const schoolsService = {
    getResolvedSettings: vi.fn().mockResolvedValue({
      version: 1,
      fees: { approvalMode: feesApprovalMode },
    }),
  } as unknown as SchoolsService;

  return { reader: new SchoolSettingsReader(schoolsService), schoolsService };
}

describe('SchoolSettingsReader.documentsSettings [48.1.03]', () => {
  it('returns the resolved settings.documents block', async () => {
    const documents = { withholdAdmitCardForDues: true, serialPrefix: 'DAHS' };
    const schoolsService = {
      getResolvedSettings: vi.fn().mockResolvedValue({ version: 1, documents }),
    } as unknown as SchoolsService;

    expect(await new SchoolSettingsReader(schoolsService).documentsSettings('tenant-1')).toEqual(
      documents,
    );
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

    const out = await new SchoolSettingsReader(schoolsService).studyPlansSettings('t1');

    expect(out).toBe(studyPlans);
    expect(schoolsService.getResolvedSettings).toHaveBeenCalledWith('t1');
  });
});
