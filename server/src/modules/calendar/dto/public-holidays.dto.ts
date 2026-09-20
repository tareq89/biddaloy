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
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';

@ValidatorConstraint({ name: 'isOnOrAfter', async: false })
export class IsOnOrAfterConstraint implements ValidatorConstraintInterface {
  validate(propertyValue: string, args: ValidationArguments) {
    return (
      new Date(propertyValue) >=
      new Date((args.object as Record<string, string>)[args.constraints[0]])
    );
  }
  defaultMessage(args: ValidationArguments) {
    return `"${args.property}" must be on or after "${args.constraints[0]}"`;
  }
}

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
  @Validate(IsOnOrAfterConstraint, ['date'])
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
