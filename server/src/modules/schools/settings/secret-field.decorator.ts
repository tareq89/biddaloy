import 'reflect-metadata';

const SECRET_METADATA_KEY = Symbol('tenant-settings:secret-field');

/**
 * Marks a tenant-settings DTO property as credential-bearing. This is the
 * single source of truth secret-handling code reads from — encryption
 * (#8.7.8) and audit redaction (#8.7.11) discover secret fields by walking
 * the DTO tree (see `secret-paths.util.ts`) rather than each maintaining
 * its own hardcoded path list that could drift out of sync with the schema.
 */
export function Secret(): PropertyDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(SECRET_METADATA_KEY, true, target, propertyKey);
  };
}

export function isSecretProperty(target: object, propertyKey: string): boolean {
  return Reflect.getMetadata(SECRET_METADATA_KEY, target, propertyKey) === true;
}
