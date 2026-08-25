import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { studentKeys } from './students';

export type BulkUploadError = components['schemas']['BulkUploadErrorDto'];
export type BulkUploadResult = components['schemas']['BulkUploadResultDto'];

export interface BulkUploadStudentsInput {
  file: File;
  /** 0–100, driven by axios `onUploadProgress` — feeds `FileUpload`'s
   * per-item progress display and its `aria-live` announcement. */
  onProgress?: (percent: number) => void;
}

/**
 * [8.11.7] — `POST /students/bulk-upload`, multipart field name exactly
 * `file` (multer's `FileInterceptor('file')` silently ignores any other
 * name and the server answers "No file uploaded").
 *
 * **`retry: false`**, deliberately *not* `shouldRetryQuery` — same two
 * reasons `useGenerateFees` spells out: the endpoint carries
 * STRICT_RATE_LIMIT (5/min), and a batch write that timed out may already
 * have committed rows, so a blind client retry both burns a throttle slot
 * and can double-create students whose first attempt's outcome is unknown.
 */
export function useBulkUploadStudents() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, onProgress }: BulkUploadStudentsInput) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<BulkUploadResult>('/students/bulk-upload', formData, {
        onUploadProgress: (event) => {
          if (onProgress && event.total) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        },
      });
      return res.data;
    },
    retry: false,
    onSuccess: (result) => {
      // Any successfully created row changes what the students list shows.
      // Whole `lists()` branch, not one filter variant — same convention
      // as `useCreateStudent`.
      if (result.success_count > 0) {
        void queryClient.invalidateQueries({ queryKey: studentKeys.lists() });
      }
    },
  });
}
