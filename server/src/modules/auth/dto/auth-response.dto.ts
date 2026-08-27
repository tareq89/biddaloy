import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@biddaloy/shared';
import type { JwtMembership, LoginResponse } from '@biddaloy/shared';

/**
 * Swagger cannot reflect a TypeScript `interface` — it erases at compile
 * time, so declaring `Promise<LoginResponse>` on a handler left the OpenAPI
 * document with an empty 200 body and generated `Record<string, never>` in
 * `ui/src/api/schema.d.ts`. A typed client therefore could not read
 * `access_token` off a login, refresh, or password change without casting.
 *
 * These classes exist purely to carry `@ApiProperty` metadata. They
 * `implements` the shared interfaces so the two shapes cannot drift: change
 * `LoginResponse` and this stops compiling.
 */
export class MembershipResponseDto implements JwtMembership {
  @ApiProperty({ format: 'uuid', description: 'The school this membership is in.' })
  tenantId: string;

  @ApiProperty({ enum: UserRole, description: 'The role held in that school.' })
  role: UserRole;

  @ApiProperty({
    required: false,
    description:
      "The school's display name. Absent on tokens issued before this field existed, so " +
      'consumers must fall back to a placeholder rather than assume it is present.',
  })
  name?: string;
}

export class LoginResponseDto implements LoginResponse {
  @ApiProperty({ description: 'Short-lived bearer token for the Authorization header.' })
  access_token: string;

  @ApiProperty({
    type: [MembershipResponseDto],
    description: 'Every school/role pair the caller holds, for the tenant picker.',
  })
  memberships: MembershipResponseDto[];
}
