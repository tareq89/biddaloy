import 'reflect-metadata';
import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsObject,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CommunicationMedium } from '@biddaloy/shared';
import type { ProviderDescriptor } from '@biddaloy/shared';
import { OptionalSetting } from './optional-setting.decorator';
import { descriptorsFor, isPlainObject, soleDescriptorFor } from './messaging-descriptors';

const MEDIUM_KEY = Symbol('messagingMedium');
const METERING = ['OFF', 'PLATFORM'];
type Block = Record<string, unknown>;

const isText = (v: unknown) => typeof v === 'string';
const isNonEmpty = (v: unknown) =>
  (typeof v === 'string' && v.length > 0) || (typeof v === 'number' && Number.isFinite(v));

function blockProblem(d: ProviderDescriptor, block: unknown): string | null {
  if (!isPlainObject(block)) return 'company settings must be an object.';
  const known = new Set(d.fields.map((f) => f.key));
  for (const key of Object.keys(block)) {
    if (!known.has(key)) return 'has a field this company does not use.';
  }
  for (const f of d.fields) {
    const v = block[f.key];
    if (v === undefined) continue;
    if (f.kind === 'secret') {
      if (v === null) continue;
      if (v === '') {
        return `${f.key} must not be empty: leave it out to keep the saved value, or send null to clear it.`;
      }
      if (!isText(v)) return `${f.key} must be text.`;
    } else if (!isText(v) && !(f.kind === 'text' && typeof v === 'number' && Number.isFinite(v))) {
      return `${f.key} must be text.`;
    }
  }
  return null;
}

/** First problem with a medium's settings, or null. Messages never echo a submitted key or value. */
export function problemWith(value: unknown, medium: CommunicationMedium): string | null {
  if (!isPlainObject(value)) return 'must be an object.';
  const descriptors = descriptorsFor(medium);
  const sole = soleDescriptorFor(medium);
  const names = descriptors.map((d) => d.name);
  const flat = new Set(sole?.fields.map((f) => f.key) ?? []);

  for (const key of Object.keys(value)) {
    const ok =
      key === 'provider' ||
      (key === 'metering' && medium === CommunicationMedium.SMS) ||
      names.includes(key) ||
      flat.has(key);
    if (!ok) return 'has a setting this channel does not use.';
  }
  const flatSent = sole ? Object.keys(value).filter((k) => flat.has(k) && !names.includes(k)) : [];
  if (sole && flatSent.length > 0 && Object.hasOwn(value, sole.name)) {
    return 'mixes the old flat layout with the per-company block; send one.';
  }
  const { provider, metering } = value;
  if (provider !== undefined && (typeof provider !== 'string' || !names.includes(provider))) {
    return 'names a company that is not available for this channel.';
  }
  if (provider === undefined && !sole) return 'must say which company to use (provider).';
  if (metering !== undefined && (typeof metering !== 'string' || !METERING.includes(metering))) {
    return 'metering must be OFF or PLATFORM.';
  }

  for (const d of descriptors) {
    if (Object.hasOwn(value, d.name)) {
      const p = blockProblem(d, value[d.name]);
      if (p) return p;
    }
  }
  const flatBlock: Block | undefined =
    sole && flatSent.length > 0
      ? Object.fromEntries(flatSent.map((k) => [k, value[k]]))
      : undefined;
  if (sole && flatBlock) {
    const p = blockProblem(sole, flatBlock);
    if (p) return p;
  }

  const selected = descriptors.find((d) => d.name === (provider ?? sole?.name));
  const chosen = selected
    ? ((Object.hasOwn(value, selected.name) ? value[selected.name] : flatBlock) as
        Block | undefined)
    : undefined;
  if (!selected || !chosen) return 'must include the settings of the chosen company.';
  for (const f of selected.fields) {
    if (f.required && f.kind !== 'secret' && !isNonEmpty(chosen[f.key])) {
      return `is missing the required field ${f.key}.`;
    }
  }
  return null;
}

@ValidatorConstraint({ name: 'messagingMediumSettings', async: false })
export class MessagingMediumSettingsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return problemWith(value, args.constraints[0] as CommunicationMedium) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const p = problemWith(args.value, args.constraints[0] as CommunicationMedium);
    return `communications.${args.property} ${p ?? 'is invalid.'}`;
  }
}

/** Validates one `communications.<medium>` blob against the registered provider descriptors. */
export function MessagingMediumSettings(medium: CommunicationMedium): PropertyDecorator {
  return (target, key) => {
    applyDecorators(
      OptionalSetting(),
      IsObject(),
      Validate(MessagingMediumSettingsConstraint, [medium]),
      ApiPropertyOptional({
        type: 'object',
        additionalProperties: true,
        description:
          'D6: { provider, <company>: {…}, metering? }; fields from GET …/settings/messaging/providers',
      }),
    )(target, key);
    Reflect.defineMetadata(MEDIUM_KEY, medium, target, key);
  };
}

export function getMessagingMedium(
  target: object,
  key: string | symbol,
): CommunicationMedium | undefined {
  return Reflect.getMetadata(MEDIUM_KEY, target, key) as CommunicationMedium | undefined;
}
