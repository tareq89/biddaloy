import { ApiProperty } from '@nestjs/swagger';

export class CommitteeAttendanceMonthDto {
  @ApiProperty({ example: '2026-10' }) month!: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 89,
    description: 'null = no register that month',
  })
  percentage!: number | null;
}

export class CommitteeAttendanceDto {
  @ApiProperty({
    type: [CommitteeAttendanceMonthDto],
    description: 'Academic-year start month to this month',
  })
  months!: CommitteeAttendanceMonthDto[];
  @ApiProperty({ type: Number, nullable: true, example: 89 }) current_month_percentage!:
    number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 88.1,
    description: 'From summed counts, not a mean of months',
  })
  year_percentage!: number | null;
  @ApiProperty({ example: 90 }) target_percentage!: number;
}
