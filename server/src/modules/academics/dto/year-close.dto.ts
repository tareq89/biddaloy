import { ApiProperty } from '@nestjs/swagger';

/** [69.3.01] Response shapes for the year close preview and readiness routes (mirror `@biddaloy/shared`). */
export class YearCloseCountDto {
  @ApiProperty({ example: 'DRAFT_PROMOTION_RUN_OPEN' })
  code: string;

  @ApiProperty({ example: 2 })
  count: number;
}

export class YearCloseFreezeDto {
  @ApiProperty({ example: 'exams' })
  table: string;

  @ApiProperty({ example: 12 })
  count: number;
}

export class YearClosePreviewDto {
  @ApiProperty({ type: [YearCloseCountDto] })
  blocks: YearCloseCountDto[];

  @ApiProperty({
    type: [YearCloseCountDto],
    description:
      'Warning counts. DUES_OUTSTANDING is whole paisa; every other count is a number of rows.',
  })
  warnings: YearCloseCountDto[];

  @ApiProperty({ type: [YearCloseFreezeDto] })
  freezes: YearCloseFreezeDto[];
}

export class YearReadinessDto {
  @ApiProperty({ example: 12 })
  classes: number;

  @ApiProperty({ example: 30 })
  teacher_assignments: number;

  @ApiProperty({ example: 12 })
  committed_promotion_runs: number;
}
