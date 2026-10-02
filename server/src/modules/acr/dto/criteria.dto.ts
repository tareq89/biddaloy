import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { AcrCriterionBlock } from '../entities/acr-criterion.entity';

/** One criterion line in `PUT /acr/criteria`. 28.2.1. */
export class AcrCriterionInputDto {
  @IsIn(['BLOCK_2', 'BLOCK_3'])
  block: AcrCriterionBlock;

  @IsString()
  @Matches(/^\S+$/, { message: 'code must not contain whitespace' })
  @MaxLength(50)
  code: string;

  @IsString()
  @MinLength(1)
  label_en: string;

  @IsString()
  @MinLength(1)
  label_bn: string;

  @IsInt()
  @Min(0)
  sort_order: number;
}

/**
 * Request body for `PUT /acr/criteria`: the FULL desired list. Count is
 * deliberately not fixed (schools may change it); only an upper sanity cap.
 */
export class SaveAcrCriteriaDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AcrCriterionInputDto)
  criteria: AcrCriterionInputDto[];
}

export class AcrCriterionResponseDto {
  id: string;
  block: AcrCriterionBlock;
  code: string;
  label_en: string;
  label_bn: string;
  sort_order: number;
}

/** `version` 0 and `id` null when the tenant has no version yet. */
export class AcrCriteriaSetResponseDto {
  id: string | null;
  version: number;
  criteria: AcrCriterionResponseDto[];
}
