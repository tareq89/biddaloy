import { apiClient } from '@biddaloy/ui/api';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

export interface FeeProofAttachment {
  status: 'loading' | 'ready' | 'error';
  url?: string;
  /** MIME type of the stored file; decides image vs PDF. */
  type?: string;
}

/** `GET /admission/fee-proofs/:id/attachment` as an object URL, revoked when the proof changes or the dialog closes. */
export function useFeeProofAttachment(id: string): FeeProofAttachment {
  const query = useQuery({
    queryKey: ['admission-fee-proof-attachment', id],
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<Blob>(`/admission/fee-proofs/${id}/attachment`, {
          responseType: 'blob',
          signal,
        })
      ).data,
    gcTime: 0, // a private file: never kept in the cache after the dialog closes
    retry: false,
  });
  const blob = query.data;
  const [url, setUrl] = React.useState<string | undefined>();
  React.useEffect(() => {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [blob]);
  if (query.isError) return { status: 'error' };
  if (!blob || !url) return { status: 'loading' };
  return { status: 'ready', url, type: blob.type };
}
