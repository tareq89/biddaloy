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
