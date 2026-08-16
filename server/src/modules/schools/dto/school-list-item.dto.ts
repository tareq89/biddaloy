import { ApiProperty } from '@nestjs/swagger';

/** Swagger-only shape for `GET /schools` — the school picker's `{ id,
 * name }` entries, matching `SchoolsService.findAll`'s actual return
 * value. See `school-settings-response.dto.ts`'s own comment on why this
 * doesn't need a `fromEntity` constructor: nothing serializes an instance
 * of this class, it only documents the shape already being returned. */
export class SchoolListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}
