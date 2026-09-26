import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** A staff designation (job title), tenant-scoped. 23.1. */
export class DesignationDto {
  @IsUUID()
  id: string;

  @IsUUID()
  tenant_id: string;

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
