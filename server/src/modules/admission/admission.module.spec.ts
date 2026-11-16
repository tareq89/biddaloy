import { MODULE_METADATA } from '@nestjs/common/constants';
import { AdmissionModule } from './admission.module';
import { AdmissionFeeService } from './admission-fee.service';
import { AdmissionRollService } from './admission-roll.service';
import { AdmissionStageResultService } from './admission-stage-result.service';
import { AdmissionLotteryService } from './admission-lottery.service';
import { AdmissionListService } from './admission-list.service';
import { AdmissionPublicationService } from './admission-publication.service';
import { AdmissionApplicantStaffController } from './admission-applicant-staff.controller';
import { AdmissionNotificationService } from './admission-notification.service';

// The wave-2 stubs are dependency-free, so wiring is checked on module metadata.
describe('AdmissionModule wave 2 wiring', () => {
  const meta = (k: string): unknown[] => Reflect.getMetadata(k, AdmissionModule) ?? [];

  it.each([
    AdmissionFeeService,
    AdmissionRollService,
    AdmissionStageResultService,
    AdmissionLotteryService,
    AdmissionListService,
    AdmissionPublicationService,
  ])('provides and exports %p', (svc) => {
    expect(meta(MODULE_METADATA.PROVIDERS)).toContain(svc);
    expect(meta(MODULE_METADATA.EXPORTS)).toContain(svc);
    expect(new (svc as new () => object)()).toBeDefined();
  });

  it('registers the staff applicant controller', () => {
    expect(meta(MODULE_METADATA.CONTROLLERS)).toContain(AdmissionApplicantStaffController);
  });

  it('notification service has the four no-op methods', () => {
    const p = AdmissionNotificationService.prototype;
    for (const m of ['notifyFeeSentBack', 'notifyListOffer', 'notifyStageSchedule', 'notifyResult'])
      expect(typeof (p as unknown as Record<string, unknown>)[m]).toBe('function');
  });
});
