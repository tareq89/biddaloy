import { IsString, IsOptional, IsBoolean, IsNotEmpty, MaxLength } from 'class-validator';
import {
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { SanitizeText } from '../../../common/decorators/sanitize-text.decorator';
import { IsRealDate } from '../../../common/decorators/is-real-date.decorator';

@ValidatorConstraint({ name: 'isBefore', async: false })
export class IsBeforeConstraint implements ValidatorConstraintInterface {
  validate(propertyValue: string, args: ValidationArguments) {
    return (
      new Date(propertyValue) <
      new Date((args.object as Record<string, string>)[args.constraints[0]])
    );
  }
  defaultMessage(args: ValidationArguments) {
    return `"${args.property}" must be earlier than "${args.constraints[0]}"`;
  }
}

export class CreateAcademicYearDto {
  @IsString()
  @MaxLength(50)
  @IsNotEmpty()
  @SanitizeText()
  name: string;

  @IsRealDate()
  @Validate(IsBeforeConstraint, ['end_date'])
  start_date: string;

  @IsRealDate()
  end_date: string;

  @IsOptional()
  @IsBoolean()
  is_current?: boolean;
}
