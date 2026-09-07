import { ApiProperty } from '@nestjs/swagger';

/** One live refresh-token family — see `GET /auth/sessions`. */
export class SessionDto {
  @ApiProperty({
    description: 'The refresh-token family id. Used as the id in DELETE /auth/sessions/:id.',
  })
  id: string;

  @ApiProperty({
    description: 'When this family was first created (i.e. when the device signed in), ISO 8601.',
  })
  started_at: string;

  @ApiProperty({ description: 'When this family last refreshed, ISO 8601.' })
  last_used_at: string;

  @ApiProperty({
    description: 'The User-Agent header captured at issue/rotation time, or null.',
    nullable: true,
  })
  user_agent: string | null;

  @ApiProperty({
    description: 'The IP address captured at issue/rotation time, or null.',
    nullable: true,
  })
  ip_address: string | null;

  @ApiProperty({
    description: "Whether this is the family behind the caller's own refresh cookie.",
  })
  current: boolean;
}

export class SessionListDto {
  @ApiProperty({ type: [SessionDto] })
  data: SessionDto[];
}
