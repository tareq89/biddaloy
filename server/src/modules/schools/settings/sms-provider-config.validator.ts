import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * `SmsSettingsDto.provider` names which gateway a school sends through,
 * but each gateway's own credential block is independently optional — so
 * without this, `{ provider: 'mimsms' }` with no `mimsms` block validates
 * and persists, and the resolver (#8.7.10) later looks up
 * `communications.sms[provider]` and finds nothing.
 *
 * That failure would surface at send time, inside a queued job, rather
 * than on the request that created it — so it's caught here instead.
 *
 * Only the *selected* gateway is required. A school that has both
 * configured and switches between them is a legitimate state, not an
 * error, so the unselected block is left alone rather than rejected.
 */
@ValidatorConstraint({ name: 'smsProviderIsConfigured', async: false })
export class SmsProviderIsConfiguredConstraint implements ValidatorConstraintInterface {
  validate(provider: unknown, args: ValidationArguments): boolean {
    // An unrecognised provider is `@IsIn()`'s error to report; checking
    // for its config block too would just add a second message about the
    // same wrong value.
    if (typeof provider !== 'string') return true;

    const settings = args.object as Record<string, unknown>;
    return settings[provider] !== undefined;
  }

  defaultMessage(args: ValidationArguments): string {
    return `sms.${String(args.value)} must be configured when provider is "${String(args.value)}"`;
  }
}
