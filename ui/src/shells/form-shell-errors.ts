import type { FormShellError } from './form-shell';

// react-hook-form's `FieldError` carries `ref`/`type`/`types` alongside
// `message` on a leaf error; `root` is its own top-level bucket for
// non-field errors. None of these are field names — walking into them
// would recurse into a DOM element (`ref`) or treat metadata as a nested
// section.
const RHF_ERROR_METADATA_KEYS = new Set(['ref', 'type', 'types', 'message', 'root']);

function collectErrorPaths(
  prefix: string,
  error: unknown,
): Array<{ path: string; message: string }> {
  if (!error || typeof error !== 'object') return [];
  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return [{ path: prefix, message: (error as { message: string }).message }];
  }
  return Object.entries(error as Record<string, unknown>)
    .filter(([key]) => !RHF_ERROR_METADATA_KEYS.has(key))
    .flatMap(([key, nested]) => collectErrorPaths(prefix ? `${prefix}.${key}` : key, nested));
}

/**
 * Turns `form.formState.errors` into `FormShellError[]`, the shape
 * `FormShell`'s error summary needs — walking nested field groups
 * (`errors.currency.code`) the same way a flat field (`errors.host`)
 * already works, since a flat field is just a one-level nested walk.
 *
 * `mapFieldToId` is required, not defaulted to the raw RHF field name,
 * because every section's real DOM `id`s are prefixed
 * (`whatsapp-accessToken`, `regional-currency-code`, or an explicit map
 * for SMS's `sms-greenweb-apiUrl`/`sms-mimsms-senderId`) — passing the
 * bare field name straight through here previously left
 * `FormShellError.field` pointing at an id nothing on the page has, so
 * the summary's links and focus-on-submit silently did nothing.
 */
export function buildFormShellErrors(
  errors: Record<string, unknown>,
  mapFieldToId: (dottedFieldPath: string) => string,
): FormShellError[] {
  return Object.entries(errors).flatMap(([field, error]) =>
    collectErrorPaths(field, error).map(({ path, message }) => ({
      field: mapFieldToId(path),
      message,
    })),
  );
}
