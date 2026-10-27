import { ImportFileErrorCode } from '@biddaloy/shared';

const KEY: Record<ImportFileErrorCode, string> = {
  [ImportFileErrorCode.UNREADABLE]: 'unreadable',
  [ImportFileErrorCode.UNSUPPORTED_TYPE]: 'unsupportedType',
  [ImportFileErrorCode.MISSING_COLUMNS]: 'missingColumns',
  [ImportFileErrorCode.TOO_MANY_ROWS]: 'tooManyRows',
  [ImportFileErrorCode.NO_ROWS]: 'noRows',
  [ImportFileErrorCode.TOO_LARGE]: 'tooLarge',
};

/**
 * The i18n key (`common:importFileErrors.<key>`) for a whole-file import 400,
 * read from `details.code` (#3020). `undefined` when the error carries no known
 * code, so the caller keeps its own handling and the server's English text is
 * never the thing that gets mapped.
 */
export function importFileErrorKey(error: unknown): string | undefined {
  const code = (error as { details?: { code?: unknown } } | null)?.details?.code;
  return typeof code === 'string' && Object.hasOwn(KEY, code)
    ? KEY[code as ImportFileErrorCode]
    : undefined;
}
