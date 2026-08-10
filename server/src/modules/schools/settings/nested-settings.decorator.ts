import 'reflect-metadata';
import { Type } from 'class-transformer';
import { IsDefined, ValidateNested } from 'class-validator';

const NESTED_TYPE_METADATA_KEY = Symbol('tenant-settings:nested-type');

type ClassRef = new (...args: unknown[]) => object;

/**
 * Declares a nested settings object (`region`, `communications.sms`, ...).
 * Wraps `@ValidateNested()` + `@Type()` so validation cascades into the
 * nested class, and separately records the nested class under its own
 * metadata key so `secret-paths.util.ts` can walk the tree without
 * depending on class-transformer's internal metadata storage.
 */
export function NestedSettings(typeFn: () => ClassRef): PropertyDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(NESTED_TYPE_METADATA_KEY, typeFn, target, propertyKey);
    // ValidateNested() alone does not fail when the property is missing —
    // it only recurses when a value is present. IsDefined() is what makes
    // an entirely absent required section (e.g. `region` with no
    // `currency`) actually reject. A property that's genuinely optional
    // still works: an explicit @IsOptional() on it short-circuits every
    // other validator, IsDefined() included, when the value is undefined.
    IsDefined()(target, propertyKey);
    ValidateNested()(target, propertyKey);
    Type(typeFn)(target, propertyKey);
  };
}

export function getNestedType(target: object, propertyKey: string): (() => ClassRef) | undefined {
  return Reflect.getMetadata(NESTED_TYPE_METADATA_KEY, target, propertyKey);
}
