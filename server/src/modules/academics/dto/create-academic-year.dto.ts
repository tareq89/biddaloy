import { IsString, IsOptional, IsBoolean, IsDateString, IsNotEmpty } from 'class-validator';
import { Validate, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'isBefore', async: false })
export class IsBeforeConstraint implements ValidatorConstraintInterface {
  validate(propertyValue: string, args: ValidationArguments) {
    return new Date(propertyValue) < new Date((args.object as Record<string, string>)[args.constraints[0]]);
  }
  defaultMessage(args: ValidationArguments) {
    return `"${args.property}" must be earlier than "${args.constraints[0]}"`;
  }
}

export class CreateAcademicYearDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsDateString()
  @Validate(IsBeforeConstraint, ['end_date'])
  start_date: string;

  @IsDateString()
  end_date: string;

  @IsOptional()
  @IsBoolean()
  is_current?: boolean;
}