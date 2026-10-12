import { ApiProperty } from '@nestjs/swagger';

// Swagger needs a class to introspect; the shared `AdmissionGuardianMatchDto`
// interface has no runtime form, so the generated schema would be `{}`.
export class GuardianMatchGuardianDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  full_name: string;

  @ApiProperty()
  phone: string;

  @ApiProperty({ type: [String] })
  student_names: string[];
}

export class GuardianMatchResponseDto {
  @ApiProperty({ type: GuardianMatchGuardianDto, nullable: true })
  guardian: GuardianMatchGuardianDto | null;
}
