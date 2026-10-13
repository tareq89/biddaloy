import { readFileSync } from 'fs';
import { join } from 'path';
import { ATTACHMENT_LIMITS } from '@biddaloy/shared';
import { MAX_DOCUMENT_FILE_SIZE } from './modules/admission/public-admission.controller';
import {
  HOMEWORK_SUBMISSION_MAX_FILES,
  HOMEWORK_SUBMISSION_MAX_FILE_SIZE,
} from './modules/homework/homework-submission.service';
import { PRINT_ASSET_UPLOAD_LIMIT } from './modules/print/assets/print-assets.service';
import { MAX_UPLOAD_BYTES } from './modules/workbook/import/import.controller';

// [PUB-04] nginx rejects oversize bodies with a bare 413 before the app sees
// them, so its cap must never fall below the largest legal upload.
describe('nginx client_max_body_size', () => {
  const template = readFileSync(
    join(__dirname, '../../nginx/templates/default.conf.template'),
    'utf8',
  );
  const match = /client_max_body_size\s+(\d+)M;/.exec(template);

  it('is set in whole megabytes', () => {
    expect(match).not.toBeNull();
  });

  it('covers the largest legal multipart request', () => {
    const cap = Number(match![1]) * 1024 * 1024;
    const largest = Math.max(
      HOMEWORK_SUBMISSION_MAX_FILES * HOMEWORK_SUBMISSION_MAX_FILE_SIZE,
      3 * MAX_DOCUMENT_FILE_SIZE, // admission, files: 3
      ATTACHMENT_LIMITS.maxFiles * ATTACHMENT_LIMITS.maxBytes,
      MAX_UPLOAD_BYTES,
      PRINT_ASSET_UPLOAD_LIMIT,
      // One bulk-photo chunk; mirrors STUDENT_PHOTO_CHUNK_BYTES in ui/src/hooks/students.ts.
      40 * 1024 * 1024,
    );
    expect(cap).toBeGreaterThanOrEqual(largest * 1.05); // multipart overhead
  });
});
