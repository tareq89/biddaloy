import { ApiProperty } from '@nestjs/swagger';
import { AdmissionApplicantStatus } from '@biddaloy/shared';

/** One of the five newest applicants. Names only: no phone, no guardian. */
export class AdmissionLatestApplicantDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'ADM-2026-0042' }) reference_number: string;
  @ApiProperty() applicant_name: string;
  @ApiProperty({ example: '2026-10-07T03:12:00.000Z', description: 'ISO instant' })
  created_at: string;
  @ApiProperty({ enum: AdmissionApplicantStatus, enumName: 'AdmissionApplicantStatus' })
  status: AdmissionApplicantStatus;
}

/** `GET /dashboard/widgets/admissions-today` */
export class AdmissionsTodayDto {
  @ApiProperty({ description: 'Applications created in the school day (Asia/Dhaka)' })
  new_today: number;
  @ApiProperty({ description: 'PENDING applications, any day' })
  pending_total: number;
  @ApiProperty({ type: [AdmissionLatestApplicantDto], description: 'Up to 5 newest, any status' })
  latest: AdmissionLatestApplicantDto[];
}
