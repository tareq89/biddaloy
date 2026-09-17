import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const COUNTRY_CODE = /^[A-Z]{2}$/;

export class FetchHolidaySetDto {
  @IsString()
  @Matches(COUNTRY_CODE, { message: 'country must be an ISO 3166-1 alpha-2 code, e.g. "BD"' })
  country: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}

export class HolidayEntryInputDto {
  /** Present when editing an existing entry; omitted for a brand-new one —
   * `updateEntries` treats the whole array as the next full state either
   * way (full replace, not a patch). */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsDateString()
  date: string;

  @IsDateString()
  end_date: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name_bn?: string | null;
}

export class UpdateHolidaySetEntriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HolidayEntryInputDto)
  entries: HolidayEntryInputDto[];
}

export class SuggestHolidaysQueryDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Type(() => Number)
  year: number;
}

export class BulkAddHolidaysDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  entry_ids: string[];
}
