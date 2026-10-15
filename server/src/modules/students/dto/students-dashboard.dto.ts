import { ApiProperty } from '@nestjs/swagger';

/** Counts only: no guardian or student detail leaves these widgets. */
export class GuardiansIncompleteDto {
  @ApiProperty({ example: 23 }) incomplete_count!: number;
  @ApiProperty({ example: 1410 }) total_count!: number;
}

export class StudentsAddedTodayDto {
  @ApiProperty({ example: 3 }) added_today!: number;
  @ApiProperty({ example: '2026-10-07', description: 'Dhaka calendar day counted' }) as_of!: string;
}
