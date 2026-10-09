import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Request body for `POST /designations`. 23.2.1. */
export class CreateDesignationDto {
  @IsString()
  @MaxLength(200)
  title_en: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title_bn?: string;

  @IsBoolean()
  is_teaching: boolean;
}

/** Request body for `PATCH /designations/:id`. 23.2.1. */
export class UpdateDesignationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title_en?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title_bn?: string;

  @IsOptional()
  @IsBoolean()
  is_teaching?: boolean;
}
