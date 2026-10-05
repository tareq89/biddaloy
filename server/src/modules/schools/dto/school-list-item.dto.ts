import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/** Swagger-only shape for `GET /schools` — matching `SchoolsService
 * .findAll`'s actual return value. See `school-settings-response.dto.ts`'s
 * own comment on why this doesn't need a `fromEntity` constructor: nothing
 * serializes an instance of this class, it only documents the shape
 * already being returned.
 *
 * `slug`/`status`/`created_at` were added by #533 alongside `id`/`name`
 * (the original #8.7.13 picker fields) so the SUPER_ADMIN platform schools
 * list can render a status badge, a created date, and search by slug
 * without a second endpoint. */
export class SchoolListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  status: 'ACTIVE' | 'SUSPENDED';

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ nullable: true, type: String })
  country_code: string | null;

  /** NULL = no trial. */
  @ApiProperty({ nullable: true, type: Date })
  trial_ends_at: Date | null;

  /** NULL = unlimited. */
  @ApiProperty({ nullable: true, type: Number })
  seat_limit: number | null;

  @ApiProperty({ nullable: true, type: String })
  status_reason: string | null;
}

/** Query for `GET /schools` [13.3.4]: `active` = trial still running, `expired` = suspended by the trial job. */
export class ListSchoolsQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'expired'] })
  @IsOptional()
  @IsIn(['active', 'expired'])
  trial?: 'active' | 'expired';
}
