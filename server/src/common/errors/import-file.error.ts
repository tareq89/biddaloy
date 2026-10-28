import type { ImportFileErrorCode } from '@biddaloy/shared';

/**
 * A whole import file was refused. The message is a fixed, server-written sentence and
 * never holds input; `known-errors.ts` turns it into a 400 with `details.code`.
 */
export class ImportFileError extends Error {
  constructor(
    readonly code: ImportFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
