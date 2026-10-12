import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@biddaloy/shared';

/** One pending "join this school" request addressed to the signed-in user. */
export class SchoolInviteDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  school_id: string;

  @ApiProperty()
  school_name: string;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole' })
  role: UserRole;

  @ApiProperty({ type: String, format: 'date-time' })
  expires_at: Date;
}
