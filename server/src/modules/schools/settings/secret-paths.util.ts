import { getMetadataStorage } from 'class-validator';
import { isSecretProperty } from './secret-field.decorator';
import { getNestedType } from './nested-settings.decorator';

type ClassRef = new (...args: unknown[]) => object;

/**
 * Walks a tenant-settings DTO class tree and returns the dot-paths of every
 * `@Secret()`-marked property, e.g. `communications.whatsapp.accessToken`.
 * Generic over any DTO built from `@Secret()` and `@NestedSettings()` —
 * adding a new credential field to the schema is enough for encryption and
 * audit redaction to pick it up, no separate list to update.
 */
export function getSecretPaths(cls: ClassRef, prefix = ''): string[] {
  const paths: string[] = [];
  const propertyNames = new Set(
    getMetadataStorage()
      .getTargetValidationMetadatas(cls, '', false, false)
      .map((metadata) => metadata.propertyName),
  );

  for (const propertyName of propertyNames) {
    const path = prefix ? `${prefix}.${propertyName}` : propertyName;

    if (isSecretProperty(cls.prototype as object, propertyName)) {
      paths.push(path);
      continue;
    }

    const nestedTypeFn = getNestedType(cls.prototype as object, propertyName);
    if (nestedTypeFn) {
      paths.push(...getSecretPaths(nestedTypeFn(), path));
    }
  }

  return paths;
}
