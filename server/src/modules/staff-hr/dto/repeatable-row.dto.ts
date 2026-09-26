import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** One family-member row in a `PUT /staff/:userId/family` replace body.
 * `id`/`staff_user_id` are server-assigned — the whole set is replaced
 * every call, so the client never needs to carry a row id (23.3). */
export class FamilyMemberRowInputDto {
  @IsString()
  @MaxLength(100)
  relation: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  occupation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  contact?: string;
}

export class ReplaceFamilyMembersDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => FamilyMemberRowInputDto)
  rows: FamilyMemberRowInputDto[];
}

/** One address row in a `PUT /staff/:userId/address` replace body. */
export class AddressRowInputDto {
  @IsIn(['PRESENT', 'PERMANENT'])
  type: 'PRESENT' | 'PERMANENT';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  village_street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  post_office?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  upazila?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;
}

export class ReplaceAddressesDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AddressRowInputDto)
  rows: AddressRowInputDto[];
}

/** One work-experience row in a `PUT /staff/:userId/experience` replace body. */
export class ExperienceRowInputDto {
  @IsString()
  @MaxLength(200)
  institution: string;

  @IsString()
  @MaxLength(200)
  designation: string;

  @IsDateString()
  from_date: string;

  @IsOptional()
  @IsDateString()
  to_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class ReplaceExperiencesDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => ExperienceRowInputDto)
  rows: ExperienceRowInputDto[];
}

/** One education row in a `PUT /staff/:userId/education` replace body. */
export class EducationRowInputDto {
  @IsString()
  @MaxLength(200)
  degree: string;

  @IsString()
  @MaxLength(200)
  institution: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  board_university?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  result?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  passing_year?: string;
}

export class ReplaceEducationDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => EducationRowInputDto)
  rows: EducationRowInputDto[];
}

/** One training row in a `PUT /staff/:userId/training` replace body. */
export class TrainingRowInputDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(200)
  institution: string;

  @IsDateString()
  from_date: string;

  @IsOptional()
  @IsDateString()
  to_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  certificate_no?: string;
}

export class ReplaceTrainingDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => TrainingRowInputDto)
  rows: TrainingRowInputDto[];
}

/** One achievement row in a `PUT /staff/:userId/achievement` replace body. */
export class AchievementRowInputDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  issued_by?: string;
}

export class ReplaceAchievementsDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AchievementRowInputDto)
  rows: AchievementRowInputDto[];
}

/** One language row in a `PUT /staff/:userId/language` replace body. */
export class LanguageRowInputDto {
  @IsString()
  @MaxLength(100)
  language_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  proficiency?: string;
}

export class ReplaceLanguagesDto {
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => LanguageRowInputDto)
  rows: LanguageRowInputDto[];
}
