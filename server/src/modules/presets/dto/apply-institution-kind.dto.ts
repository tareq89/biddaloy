import { ApiProperty } from '@nestjs/swagger';

/** One kind as listed by `GET /institution-kinds`. */
export class InstitutionKindDto {
  @ApiProperty({ example: 'coaching' })
  id: string;

  @ApiProperty({ example: { en: 'Coaching centre', bn: 'কোচিং সেন্টার' } })
  name: { en: string; bn: string };

  @ApiProperty({ description: 'false = defaults not yet checked with a real school of this kind.' })
  verified: boolean;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'boolean' } })
  modules: Record<string, boolean>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  labels: Record<string, unknown>;
}

export class KindModuleChangeDto {
  @ApiProperty({ example: 'fines' })
  key: string;

  @ApiProperty({ description: 'The school switch before (on when nothing is stored).' })
  from: boolean;

  @ApiProperty()
  to: boolean;
}

export class KindLabelChangeDto {
  @ApiProperty({ example: 'class' })
  key: string;

  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  from: Record<string, unknown> | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  to: Record<string, unknown>;
}

/** What a kind changes (preview), or what apply just changed. Only real differences. */
export class InstitutionKindChangesDto {
  @ApiProperty({ type: [KindModuleChangeDto] })
  modules: KindModuleChangeDto[];

  @ApiProperty({ type: [KindLabelChangeDto] })
  labels: KindLabelChangeDto[];
}
