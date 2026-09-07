import { IsIn, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for `PATCH /schools/:id/status` (#530). A reason is mandatory in
 * both directions — suspending *and* reactivating a school are audited
 * actions a SUPER_ADMIN should be able to explain later, not just the
 * suspend half.
 */
export class UpdateSchoolStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status: 'ACTIVE' | 'SUSPENDED';

  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @Length(5, 500)
  reason: string;
}
