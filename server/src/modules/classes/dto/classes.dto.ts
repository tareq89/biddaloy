import { IsString, IsUUID, IsOptional, IsInt, Min, MaxLength, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';

export class CreateClassDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  name: string;

  @IsOptional()
  @IsInt()
  numeric_grade?: number;

  @IsNotEmpty()
  @IsUUID()
  academic_year_id: string;
}

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  @SanitizeText()
  name?: string;

  // `| null`, not just `?: number` — a form clearing a previously-set
  // grade needs to send an explicit `null` to actually clear the column;
  // omitting the key (the shape `?: number` alone implies) leaves the old
  // value in place, since `ClassService.update` passes `dto` straight
  // into `repo.update()`, which only ever touches keys present in the
  // object. `@IsOptional()` already treats `null` as "skip validation",
  // so no `@ValidateIf`/`@IsNull()` pairing is needed for `@IsInt()` to
  // accept it.
  @IsOptional()
  @IsInt()
  numeric_grade?: number | null;
}

export class QueryClassDto {
  @IsOptional()
  @IsUUID()
  academic_year_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}

export class CreateSectionDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  @SanitizeText()
  section_name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class UpdateSectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @SanitizeText()
  section_name?: string;

  // `| null`, not just `?: number` — same reasoning as
  // `UpdateClassDto.numeric_grade` above: clearing a previously-set
  // capacity needs an explicit `null` to actually clear the column,
  // since `SectionService.update` passes the DTO straight into
  // `repo.update()`.
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number | null;
}
