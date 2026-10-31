import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ExportFormat } from '@biddaloy/shared';

/** Shown for a student whose gender or religion was never recorded. */
export const NOT_GIVEN_BN = 'উল্লেখ নেই';

export class StudentCountQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Defaults to the current academic year.' })
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;
}

export class StudentCountExportQueryDto extends StudentCountQueryDto {
  @ApiPropertyOptional({ enum: ExportFormat, default: ExportFormat.XLSX })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsEnum(ExportFormat)
  format?: ExportFormat;

  @ApiPropertyOptional({ enum: ['students', 'staff'], default: 'students' })
  @IsOptional()
  @IsEnum({ students: 'students', staff: 'staff' })
  table?: 'students' | 'staff';
}

export class StudentCountRowDto {
  @ApiProperty() class_name: string;
  @ApiProperty({ description: 'The class number, for ordering.' }) class_order: number;
  @ApiProperty({ description: 'Recorded gender, or the "not given" label.' }) gender: string;
  @ApiProperty({ description: 'Recorded religion, or the "not given" label.' }) religion: string;
  @ApiProperty({ type: Number, nullable: true, description: 'null when hidden (small-cell rule).' })
  count: number | null;
  @ApiProperty() suppressed: boolean;
}

export class StudentCountTotalsDto {
  @ApiProperty({ description: 'True total of active students. Never hidden (D14).' })
  students: number;
}

export class StaffCountRowDto {
  @ApiProperty({ enum: ['TEACHING', 'NON_TEACHING', 'UNASSIGNED'] })
  staff_type: 'TEACHING' | 'NON_TEACHING' | 'UNASSIGNED';
  @ApiProperty({ type: Number, nullable: true }) count: number | null;
  @ApiProperty() suppressed: boolean;
}

export class StaffCountDto {
  @ApiProperty({ type: [StaffCountRowDto] }) rows: StaffCountRowDto[];
  @ApiProperty({ description: 'True total of staff. Never hidden (D14).' }) total: number;
}

/** BANBEIS-style head count for one academic year: students by class, gender and religion; staff by type. */
export class StudentCountDto {
  @ApiProperty({ format: 'uuid', nullable: true }) academic_year_id: string | null;
  @ApiProperty({ nullable: true }) academic_year_name: string | null;
  @ApiProperty({ type: [StudentCountRowDto] }) rows: StudentCountRowDto[];
  @ApiProperty({ type: StudentCountTotalsDto }) totals: StudentCountTotalsDto;
  @ApiProperty({ type: StaffCountDto }) staff: StaffCountDto;
}
