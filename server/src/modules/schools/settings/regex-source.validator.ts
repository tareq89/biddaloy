import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * A settings field that travels as a regex *source* string (`region`'s
 * `phone.pattern` and both `identifiers` patterns) and is compiled with
 * `new RegExp()` by whoever consumes it.
 *
 * Without this, any string at all persists, and a typo saved once breaks
 * phone/identifier validation for the whole tenant at *read* time, in
 * every consumer that compiles it — each of which then needs its own
 * try/catch to survive. Checking compilability here turns that into a 400
 * on the request that caused it, at the one boundary the value enters
 * through.
 *
 * Deliberately only checks that the pattern compiles, not that it is
 * sensible: which shapes a school wants to accept for its own national ID
 * or phone numbers is its business, whereas a pattern no engine can parse
 * is never anyone's intent.
 */
@ValidatorConstraint({ name: 'isRegexSource', async: false })
export class IsRegexSourceConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    // A non-string is `@IsString()`'s error to report, not this one's —
    // returning true here keeps a single wrong-type value from producing
    // two overlapping messages.
    if (typeof value !== 'string') return true;

    try {
      new RegExp(value);
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `"${args.property}" must be a valid regular expression source`;
  }
}
